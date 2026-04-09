#!/usr/bin/env node
/**
 * context-mem × LoCoMo Benchmark
 * ================================
 *
 * Same benchmark as mempalace. Tests multi-hop reasoning across
 * 10 long conversations (19-32 sessions each, 400-600 dialog turns).
 *
 * LoCoMo data format:
 *   - conversation object has session_1, session_2, ... keys
 *   - Each session is an array of { speaker, dia_id, text }
 *   - Evidence references are dia_ids like "D1:3"
 *   - dia_id format: "D{session_num}:{turn_num}"
 *   - QA categories: 1=single-hop, 2=multi-hop, 3=temporal, 4=open, 5=adversarial
 *
 * Data: https://github.com/snap-research/locomo
 *
 * Usage:
 *   git clone https://github.com/snap-research/locomo.git /tmp/locomo
 *   node benchmarks/locomo.js /tmp/locomo/data/locomo10.json
 *   node benchmarks/locomo.js /tmp/locomo/data/locomo10.json --limit 1
 *   node benchmarks/locomo.js /tmp/locomo/data/locomo10.json --granularity dialog
 *   node benchmarks/locomo.js /tmp/locomo/data/locomo10.json --top-k 50
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BenchKernel } = require('./lib/kernel-adapter');
const { formatPercent, printHeader } = require('./lib/metrics');

const CATEGORY_NAMES = { 1: 'single-hop', 2: 'multi-hop', 3: 'temporal', 4: 'open-domain', 5: 'adversarial' };

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataFile = args.find(a => !a.startsWith('--'));
if (!dataFile) {
  console.log('Usage: node benchmarks/locomo.js <locomo10.json> [--limit N] [--granularity session|dialog] [--top-k N]');
  console.log('\nSetup:');
  console.log('  git clone https://github.com/snap-research/locomo.git /tmp/locomo');
  process.exit(1);
}

function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '0'), 10);
const GRANULARITY = getArg('granularity', 'session');
const TOP_K = parseInt(getArg('top-k', '10'), 10);
const OUT_FILE = getArg('out', null);

// ── Load data ───────────────────────────────────────────────────────────────
printHeader('context-mem × LoCoMo Benchmark');
console.log(`  Node:        ${process.version}`);
console.log(`  Granularity: ${GRANULARITY}`);
console.log(`  Top-K:       ${TOP_K}`);
console.log(`  Data:        ${dataFile}`);

const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
let conversations = Array.isArray(raw) ? raw : Object.values(raw);
if (LIMIT > 0) conversations = conversations.slice(0, LIMIT);
console.log(`  Conversations: ${conversations.length}`);
console.log('─'.repeat(60));

// ── Extract sessions from LoCoMo conversation format ────────────────────────
function extractSessions(convObj) {
  const sessions = [];
  // Keys are session_1, session_2, ... up to session_N
  for (let i = 1; ; i++) {
    const key = `session_${i}`;
    if (!convObj[key]) break;
    const dateKey = `session_${i}_date_time`;
    sessions.push({
      index: i,
      date: convObj[dateKey] || '',
      dialogs: convObj[key], // array of { speaker, dia_id, text }
    });
  }
  return sessions;
}

// Map evidence dia_id (e.g. "D1:3") to session index
function diaIdToSessionIndex(diaId) {
  // Format: D{session}:{turn}
  const match = diaId.match(/^D(\d+):(\d+)$/);
  if (match) return parseInt(match[1], 10);
  return null;
}

// ── Run benchmark ───────────────────────────────────────────────────────────
const allRecall = [];
const perCategory = {};
const resultsLog = [];
const startTime = Date.now();
let totalQuestions = 0;

for (let ci = 0; ci < conversations.length; ci++) {
  const conv = conversations[ci];
  const convData = conv.conversation || conv;
  const qaPairs = conv.qa || [];
  const sessions = extractSessions(convData);

  if (!sessions.length || !qaPairs.length) continue;

  // Build a kernel for this conversation
  const kernel = new BenchKernel().open();
  const diaIdToSessId = new Map(); // dia_id → sess_id

  // Pre-extract summaries, observations, and events for enrichment
  const summaries = conv.session_summary || {};
  const observations = conv.observation || {};
  const events = conv.event_summary || {};

  for (const session of sessions) {
    const sessId = `sess_${session.index}`;

    if (GRANULARITY === 'session') {
      // One document per session: join all dialog turns
      const texts = session.dialogs.map(d => `${d.speaker}: ${d.text}`);

      // Enrich with session summary (better keywords than raw dialog)
      const summaryKey = `session_${session.index}_summary`;
      if (summaries[summaryKey]) {
        texts.push(`Summary: ${summaries[summaryKey]}`);
      }

      // Enrich with observations (structured facts)
      const obsKey = `session_${session.index}_observation`;
      if (observations[obsKey]) {
        const obs = observations[obsKey];
        for (const [speaker, facts] of Object.entries(obs)) {
          if (Array.isArray(facts)) {
            for (const fact of facts) {
              const text = Array.isArray(fact) ? fact[0] : fact;
              if (text) texts.push(`${speaker}: ${text}`);
            }
          }
        }
      }

      // Enrich with event summaries (key events with dates)
      const evtKey = `events_session_${session.index}`;
      if (events[evtKey]) {
        const evt = events[evtKey];
        if (evt.date) texts.push(`Date: ${evt.date}`);
        for (const [speaker, evtList] of Object.entries(evt)) {
          if (speaker === 'date') continue;
          if (Array.isArray(evtList)) {
            for (const e of evtList) {
              if (e) texts.push(`Event: ${e}`);
            }
          }
        }
      }

      if (texts.length > 0) {
        kernel.ingest(sessId, texts.join('\n'), { session_index: session.index, date: session.date });
      }
      // Map all dialog IDs in this session
      for (const d of session.dialogs) {
        diaIdToSessId.set(d.dia_id, sessId);
      }
    } else {
      // Dialog-level: one doc per dialog turn
      for (const d of session.dialogs) {
        kernel.ingest(d.dia_id, `${d.speaker}: ${d.text}`, { session_id: sessId });
        diaIdToSessId.set(d.dia_id, sessId);
      }
    }
  }

  // Run each QA pair
  for (const qa of qaPairs) {
    const question = qa.question;
    if (!question) continue;

    // Evidence is array of dia_ids like ["D1:3", "D5:7"]
    const evidenceDiaIds = qa.evidence || [];
    if (!evidenceDiaIds.length) continue;

    // Determine correct session IDs from evidence
    let correctIds;
    if (GRANULARITY === 'session') {
      correctIds = [...new Set(evidenceDiaIds.map(id => diaIdToSessId.get(id)).filter(Boolean))];
    } else {
      correctIds = evidenceDiaIds;
    }

    if (!correctIds.length) continue;

    const results = kernel.search(question, TOP_K);
    const retrievedIds = results.map(r => r.id);

    const recall = correctIds.some(cid => retrievedIds.includes(cid)) ? 1.0 : 0.0;
    allRecall.push(recall);

    const catName = CATEGORY_NAMES[qa.category] || `cat_${qa.category}`;
    if (!perCategory[catName]) perCategory[catName] = { hits: 0, total: 0 };
    perCategory[catName].total++;
    if (recall > 0) perCategory[catName].hits++;
    totalQuestions++;

    resultsLog.push({
      conversation: ci,
      category: catName,
      question,
      correct: correctIds,
      retrieved: retrievedIds.slice(0, TOP_K),
      recall,
    });
  }

  kernel.close();

  const avgSoFar = allRecall.reduce((a, b) => a + b, 0) / allRecall.length;
  console.log(`  Conv ${ci + 1}/${conversations.length}: ${qaPairs.length} QA pairs, running avg=${formatPercent(avgSoFar)}`);
}

const elapsed = (Date.now() - startTime) / 1000;
const avgRecall = allRecall.length > 0 ? allRecall.reduce((a, b) => a + b, 0) / allRecall.length : 0;

// ── Results ─────────────────────────────────────────────────────────────────
printHeader(`RESULTS — context-mem (${GRANULARITY}, top-${TOP_K})`);
console.log(`  Time:        ${elapsed.toFixed(1)}s`);
console.log(`  Questions:   ${totalQuestions}`);
console.log(`  Avg Recall:  ${formatPercent(avgRecall)}`);

console.log('\n  PER-CATEGORY:');
for (const [cat, data] of Object.entries(perCategory).sort()) {
  const pct = data.total > 0 ? data.hits / data.total : 0;
  console.log(`    ${cat.padEnd(20)} ${formatPercent(pct)}  (${data.hits}/${data.total})`);
}

// ── vs MemPalace ────────────────────────────────────────────────────────────
console.log('\n  HEAD-TO-HEAD vs MemPalace (session, top-10):');
console.log('  ┌────────────────┬──────────────┬──────────────┐');
console.log('  │ Metric         │ MemPalace    │ context-mem  │');
console.log('  ├────────────────┼──────────────┼──────────────┤');
console.log(`  │ Avg Recall     │ 60.3%        │ ${formatPercent(avgRecall).padStart(12)} │`);
console.log('  └────────────────┴──────────────┴──────────────┘');
console.log('='.repeat(60) + '\n');

// ── Save ────────────────────────────────────────────────────────────────────
const outPath = OUT_FILE || `benchmarks/results/locomo_${GRANULARITY}_top${TOP_K}_${new Date().toISOString().slice(0, 10)}.json`;
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  benchmark: 'LoCoMo',
  system: 'context-mem',
  granularity: GRANULARITY,
  top_k: TOP_K,
  questions: totalQuestions,
  avg_recall: avgRecall,
  elapsed_seconds: elapsed,
  per_category: perCategory,
  details: resultsLog,
}, null, 2));
console.log(`  Results saved: ${outPath}`);
