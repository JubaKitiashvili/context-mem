#!/usr/bin/env node
/**
 * context-mem × MemBench Benchmark
 * ==================================
 *
 * MemBench (ACL 2025): https://aclanthology.org/2025.findings-acl.989/
 * Data: https://github.com/import-myself/Membench
 *
 * Tests memory across multi-turn conversations in multiple categories:
 *   highlevel, simple, knowledge_update, comparative, conditional,
 *   noisy, aggregative, RecMultiSession
 *
 * Usage:
 *   git clone https://github.com/import-myself/Membench.git /tmp/membench
 *   node benchmarks/membench.js /tmp/membench/MemData/FirstAgent
 *   node benchmarks/membench.js /tmp/membench/MemData/FirstAgent --category highlevel
 *   node benchmarks/membench.js /tmp/membench/MemData/FirstAgent --limit 50
 *   node benchmarks/membench.js /tmp/membench/MemData/FirstAgent --mode hybrid
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BenchKernel } = require('./lib/kernel-adapter'); // Must load first — merges bench expansions
const { formatPercent, printHeader } = require('./lib/metrics');
const { EXPANSIONS } = require(path.join(__dirname, '..', 'dist/plugins/search/query-builder.js'));

// ── Stop words for hybrid keyword boosting ──────────────────────────────────
const STOP_WORDS = new Set([
  'what', 'when', 'where', 'who', 'how', 'which', 'did', 'do',
  'was', 'were', 'have', 'has', 'had', 'is', 'are', 'the', 'a',
  'an', 'my', 'me', 'i', 'you', 'your', 'their', 'it', 'its',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'ago', 'last', 'that', 'this', 'there', 'about', 'get', 'got',
  'give', 'gave', 'buy', 'bought', 'made', 'make', 'said',
  'would', 'could', 'should', 'might', 'can', 'will', 'shall',
  'kind', 'type', 'like', 'prefer', 'enjoy', 'think', 'feel',
]);

function extractKeywords(text) {
  return text.toLowerCase().match(/\b[a-z]{3,}\b/g)?.filter(w => !STOP_WORDS.has(w)) || [];
}

function keywordOverlap(queryKws, docText) {
  if (!queryKws.length) return 0;
  const lower = docText.toLowerCase();
  const hits = queryKws.filter(kw => lower.includes(kw)).length;
  return hits / queryKws.length;
}

// ── Category files ──────────────────────────────────────────────────────────
const CATEGORY_FILES = {
  simple: 'simple.json',
  highlevel: 'highlevel.json',
  knowledge_update: 'knowledge_update.json',
  comparative: 'comparative.json',
  conditional: 'conditional.json',
  noisy: 'noisy.json',
  aggregative: 'aggregative.json',
  highlevel_rec: 'highlevel_rec.json',
  lowlevel_rec: 'lowlevel_rec.json',
  RecMultiSession: 'RecMultiSession.json',
  post_processing: 'post_processing.json',
};

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataDir = args.find(a => !a.startsWith('--'));
if (!dataDir) {
  console.log('Usage: node benchmarks/membench.js <MemData/FirstAgent> [--category NAME] [--topic movie] [--top-k 5] [--limit N] [--mode raw|hybrid]');
  console.log('\nSetup:');
  console.log('  git clone https://github.com/import-myself/Membench.git /tmp/membench');
  process.exit(1);
}

function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const CATEGORY = getArg('category', null);
const TOPIC = getArg('topic', 'movie');
const TOP_K = parseInt(getArg('top-k', '5'), 10);
const LIMIT = parseInt(getArg('limit', '0'), 10);
const MODE = getArg('mode', 'hybrid');
const OUT_FILE = getArg('out', null);
const USE_VECTOR = args.includes('--vector');

// ── Load data ───────────────────────────────────────────────────────────────
function loadItems() {
  const categories = CATEGORY ? [CATEGORY] : Object.keys(CATEGORY_FILES);
  const items = [];

  for (const cat of categories) {
    const fname = CATEGORY_FILES[cat];
    if (!fname) continue;
    const fpath = path.join(dataDir, fname);
    if (!fs.existsSync(fpath)) continue;

    const raw = JSON.parse(fs.readFileSync(fpath, 'utf8'));

    for (const [topic, topicItems] of Object.entries(raw)) {
      if (TOPIC && topic !== TOPIC && topic !== 'roles' && topic !== 'events') continue;
      if (!Array.isArray(topicItems)) continue;

      for (const item of topicItems) {
        const turns = item.message_list || [];
        const qa = item.QA || {};
        if (!turns.length || !qa.question) continue;

        items.push({
          category: cat,
          topic,
          tid: item.tid || 0,
          turns,
          question: qa.question,
          choices: qa.choices || {},
          ground_truth: qa.ground_truth || '',
          answer_text: qa.answer || '',
          target_step_ids: qa.target_step_id || [],
        });
      }
    }
  }

  return LIMIT > 0 ? items.slice(0, LIMIT) : items;
}

function turnText(turn) {
  const user = turn.user || turn.user_message || '';
  const asst = turn.assistant || turn.assistant_message || '';
  const time = turn.time || '';
  let text = `[User] ${user} [Assistant] ${asst}`;
  if (time) text = `[${time}] ` + text;
  return text;
}

// ── Run benchmark ───────────────────────────────────────────────────────────
printHeader('context-mem × MemBench Benchmark');
console.log(`  Node:       ${process.version}`);
console.log(`  Data:       ${dataDir}`);
console.log(`  Category:   ${CATEGORY || 'all'}`);
console.log(`  Topic:      ${TOPIC || 'all'}`);
console.log(`  Top-K:      ${TOP_K}`);
console.log(`  Mode:       ${MODE}`);

const items = loadItems();
console.log(`  Items:      ${items.length}`);
console.log('─'.repeat(58));

const resultsLog = [];
const perCategory = {};
let totalHit = 0;
const startTime = Date.now();

(async () => {
for (let idx = 0; idx < items.length; idx++) {
  const item = items[idx];
  const kernel = new BenchKernel().open();

  // Normalize message_list: flat list of dicts → wrap as one session
  let sessions = item.turns;
  if (sessions.length > 0 && !Array.isArray(sessions[0])) {
    sessions = [sessions];
  }

  // Index all turns
  const turnMap = new Map(); // global_idx → { sid, text }
  let globalIdx = 0;
  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];
    if (!Array.isArray(session)) continue;
    for (let ti = 0; ti < session.length; ti++) {
      const turn = session[ti];
      if (typeof turn !== 'object') continue;
      const sid = turn.sid != null ? turn.sid : turn.mid != null ? turn.mid : globalIdx;
      const text = turnText(turn);
      const docId = `t_${globalIdx}`;
      kernel.ingest(docId, text, { sid: Number(sid), s_idx: si, t_idx: ti });
      turnMap.set(globalIdx, { sid: Number(sid), text, docId });
      globalIdx++;
    }
  }

  if (globalIdx === 0) { kernel.close(); continue; }

  // Embed for hybrid vector search
  if (USE_VECTOR) {
    await kernel.embedAll();
  }

  // Retrieve
  let results;
  if (USE_VECTOR) {
    results = await kernel.hybridSearch(item.question, MODE === 'hybrid' ? TOP_K * 3 : TOP_K);
  } else {
    const retrieveCount = MODE === 'hybrid' ? TOP_K * 3 : TOP_K;
    results = kernel.search(item.question, Math.min(retrieveCount, globalIdx));
  }

  // Hybrid re-scoring: boost results with keyword overlap
  if (MODE === 'hybrid' && results.length > 0) {
    const queryKws = extractKeywords(item.question);
    const scored = results.map(r => {
      const gidx = parseInt(r.id.replace('t_', ''), 10);
      const info = turnMap.get(gidx);
      const overlap = info ? keywordOverlap(queryKws, info.text) : 0;
      const fused = (r.score || 0) * (1.0 + 1.0 * overlap);
      return { ...r, gidx, sid: info?.sid, fused };
    });
    scored.sort((a, b) => b.fused - a.fused); // descending: higher = better
    results = scored.slice(0, TOP_K);
  } else {
    results = results.slice(0, TOP_K);
  }

  // Extract retrieved SIDs and global indices
  const retrievedSids = new Set();
  const retrievedGlobal = new Set();
  for (const r of results) {
    const gidx = parseInt(r.id.replace('t_', ''), 10);
    const info = turnMap.get(gidx);
    if (info) retrievedSids.add(info.sid);
    retrievedGlobal.add(gidx);
  }

  // Check if target turn is retrieved
  const targetSids = new Set();
  for (const step of item.target_step_ids) {
    if (Array.isArray(step) && step.length >= 1) {
      targetSids.add(step[0]);
    }
  }

  const hit = [...targetSids].some(s => retrievedSids.has(s) || retrievedGlobal.has(s));
  if (hit) totalHit++;

  const cat = item.category;
  if (!perCategory[cat]) perCategory[cat] = { hits: 0, total: 0 };
  perCategory[cat].total++;
  if (hit) perCategory[cat].hits++;

  resultsLog.push({
    category: cat, topic: item.topic, question: item.question,
    ground_truth: item.ground_truth, hit,
    target_sids: [...targetSids],
    retrieved_sids: [...retrievedSids],
  });

  kernel.close();

  if ((idx + 1) % 50 === 0 || idx === items.length - 1) {
    console.log(`  [${String(idx + 1).padStart(4)}/${items.length}]  running R@${TOP_K}: ${formatPercent(totalHit / (idx + 1))}`);
  }
}

const elapsed = (Date.now() - startTime) / 1000;
const overall = items.length > 0 ? totalHit / items.length : 0;

// ── Results ─────────────────────────────────────────────────────────────────
printHeader(`RESULTS — context-mem on MemBench (${MODE}, top-${TOP_K})`);
console.log(`\n  Overall R@${TOP_K}: ${formatPercent(overall)}  (${totalHit}/${items.length})\n`);
console.log('  By category:');
for (const [cat, v] of Object.entries(perCategory).sort()) {
  const pct = v.total > 0 ? v.hits / v.total : 0;
  console.log(`    ${cat.padEnd(20)} ${formatPercent(pct).padStart(6)}  (${v.hits}/${v.total})`);
}
console.log('\n' + '='.repeat(58) + '\n');

// ── Save ────────────────────────────────────────────────────────────────────
const outPath = OUT_FILE || `benchmarks/results/membench_${MODE}_top${TOP_K}_${new Date().toISOString().slice(0, 10)}.json`;
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  benchmark: 'MemBench',
  system: 'context-mem',
  mode: MODE,
  top_k: TOP_K,
  items: items.length,
  overall_recall: overall,
  elapsed_seconds: elapsed,
  per_category: perCategory,
  details: resultsLog,
}, null, 2));
console.log(`  Results saved: ${outPath}`);
})();
