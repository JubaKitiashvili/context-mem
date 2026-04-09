#!/usr/bin/env node
/**
 * context-mem × ConvoMem Benchmark
 * ==================================
 *
 * Same benchmark as mempalace. Tests six categories of conversational memory.
 * Downloads from HuggingFace automatically.
 *
 * Categories: user_evidence, assistant_facts_evidence, changing_evidence,
 *             abstention_evidence, preference_evidence, implicit_connection_evidence
 *
 * Usage:
 *   node benchmarks/convomem.js
 *   node benchmarks/convomem.js --category user_evidence --limit 100
 *   node benchmarks/convomem.js --category all --limit 50
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { BenchKernel } = require('./lib/kernel-adapter');
const { formatPercent, printHeader } = require('./lib/metrics');

// ── Constants ───────────────────────────────────────────────────────────────
const HF_BASE = 'https://huggingface.co/datasets/Salesforce/ConvoMem/resolve/main/core_benchmark/evidence_questions';
const CATEGORIES = {
  user_evidence: 'User Facts',
  assistant_facts_evidence: 'Assistant Facts',
  changing_evidence: 'Changing Facts',
  abstention_evidence: 'Abstention',
  preference_evidence: 'Preferences',
  implicit_connection_evidence: 'Implicit Connections',
};

const CACHE_DIR = path.join(os.tmpdir(), 'convomem_cache');

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '50'), 10);
const CATEGORY = getArg('category', 'all');
const TOP_K = parseInt(getArg('top-k', '10'), 10);
const OUT_FILE = getArg('out', null);

const targetCategories = CATEGORY === 'all' ? Object.keys(CATEGORIES) : [CATEGORY];

// ── HTTP helper ─────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : require('http');
      mod.get(u, { headers: { 'User-Agent': 'context-mem-bench/1.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${u}`));
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

function cachedFetch(url, cacheKey) {
  const cachePath = path.join(CACHE_DIR, cacheKey.replace(/[/\\:]/g, '_') + '.json');
  if (fs.existsSync(cachePath)) {
    return Promise.resolve(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  }
  return fetchJson(url).then(data => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data));
    return data;
  });
}

// ── File discovery ──────────────────────────────────────────────────────────
async function discoverFiles(category) {
  const apiUrl = `https://huggingface.co/api/datasets/Salesforce/ConvoMem/tree/main/core_benchmark/evidence_questions/${category}/1_evidence`;
  try {
    const files = await cachedFetch(apiUrl, `${category}_filelist`);
    return files
      .filter(f => f.path && f.path.endsWith('.json'))
      .map(f => f.path.split(`${category}/`)[1]);
  } catch (e) {
    console.log(`    Warning: could not list files for ${category}: ${e.message}`);
    return [];
  }
}

async function loadEvidenceItems(categories, limit) {
  const allItems = [];

  for (const cat of categories) {
    const files = await discoverFiles(cat);
    if (!files.length) {
      console.log(`  Skipping ${cat} — no files found`);
      continue;
    }

    let items = [];
    for (const fpath of files) {
      if (items.length >= limit) break;
      try {
        const data = await cachedFetch(`${HF_BASE}/${cat}/${fpath}`, `${cat}/${fpath}`);
        if (data && data.evidence_items) {
          for (const item of data.evidence_items) {
            item._category = cat;
            items.push(item);
          }
        }
      } catch (e) {
        console.log(`    Warning: failed ${cat}/${fpath}: ${e.message}`);
      }
    }

    items = items.slice(0, limit);
    allItems.push(...items);
    console.log(`  ${CATEGORIES[cat] || cat}: ${items.length} items loaded`);
  }

  return allItems;
}

// ── Benchmark ───────────────────────────────────────────────────────────────
async function run() {
  printHeader('context-mem × ConvoMem Benchmark');
  console.log(`  Node:      ${process.version}`);
  console.log(`  Categories: ${targetCategories.length}`);
  console.log(`  Limit/cat: ${LIMIT}`);
  console.log(`  Top-K:     ${TOP_K}`);
  console.log('─'.repeat(60));
  console.log('\n  Loading data from HuggingFace...\n');

  const items = await loadEvidenceItems(targetCategories, LIMIT);
  console.log(`\n  Total items: ${items.length}`);
  console.log('─'.repeat(60));

  const allRecall = [];
  const perCategory = {};
  const resultsLog = [];
  const startTime = Date.now();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const question = item.question;
    const cat = item._category;
    const conversations = item.conversations || [];
    const evidenceMessages = item.message_evidences || [];
    const evidenceTexts = evidenceMessages.map(e => e.text.trim().toLowerCase());

    if (!evidenceTexts.length) continue;

    // Build corpus: one doc per message
    const kernel = new BenchKernel().open();
    const corpusTexts = [];

    for (const conv of conversations) {
      const messages = conv.messages || [];
      for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi];
        const msgId = `msg_${corpusTexts.length}`;
        kernel.ingest(msgId, msg.text, { speaker: msg.speaker });
        corpusTexts.push(msg.text.trim().toLowerCase());
      }
    }

    // Query
    const results = kernel.search(question, TOP_K);
    const retrievedIndices = results.map(r => parseInt(r.id.replace('msg_', ''), 10));
    const retrievedTexts = retrievedIndices
      .filter(idx => idx < corpusTexts.length)
      .map(idx => corpusTexts[idx]);

    // Score: check if evidence text is found in retrieved texts (substring match)
    let found = 0;
    for (const evText of evidenceTexts) {
      for (const retText of retrievedTexts) {
        if (evText.includes(retText) || retText.includes(evText)) {
          found++;
          break;
        }
      }
    }

    const recall = evidenceTexts.length > 0 ? found / evidenceTexts.length : 1.0;
    allRecall.push(recall);

    if (!perCategory[cat]) perCategory[cat] = { recalls: [], perfect: 0, total: 0 };
    perCategory[cat].recalls.push(recall);
    perCategory[cat].total++;
    if (recall >= 1.0) perCategory[cat].perfect++;

    resultsLog.push({ question, category: cat, recall, found, evidence_count: evidenceTexts.length });
    kernel.close();

    if ((i + 1) % 20 === 0 || i === items.length - 1) {
      const avg = allRecall.reduce((a, b) => a + b, 0) / allRecall.length;
      console.log(`  [${String(i + 1).padStart(4)}/${items.length}] avg_recall=${formatPercent(avg)}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const avgRecall = allRecall.length > 0 ? allRecall.reduce((a, b) => a + b, 0) / allRecall.length : 0;

  // ── Results ───────────────────────────────────────────────────────────────
  printHeader(`RESULTS — context-mem (top-${TOP_K})`);
  console.log(`  Time:       ${elapsed.toFixed(1)}s (${(elapsed / Math.max(items.length, 1)).toFixed(2)}s per item)`);
  console.log(`  Items:      ${items.length}`);
  console.log(`  Avg Recall: ${formatPercent(avgRecall)}`);

  console.log('\n  PER-CATEGORY:');
  for (const [cat, data] of Object.entries(perCategory).sort()) {
    const avg = data.recalls.reduce((a, b) => a + b, 0) / data.total;
    console.log(`    ${(CATEGORIES[cat] || cat).padEnd(25)} R=${formatPercent(avg)}  perfect=${data.perfect}/${data.total}`);
  }

  const perfectTotal = allRecall.filter(r => r >= 1.0).length;
  const zeroTotal = allRecall.filter(r => r === 0).length;
  console.log('\n  DISTRIBUTION:');
  console.log(`    Perfect (1.0): ${String(perfectTotal).padStart(4)} (${formatPercent(perfectTotal / allRecall.length)})`);
  console.log(`    Zero (0.0):    ${String(zeroTotal).padStart(4)} (${formatPercent(zeroTotal / allRecall.length)})`);

  // ── vs MemPalace ──────────────────────────────────────────────────────────
  console.log('\n  HEAD-TO-HEAD vs MemPalace (all categories, 50/cat):');
  console.log('  ┌────────────────┬──────────────┬──────────────┐');
  console.log('  │ Metric         │ MemPalace    │ context-mem  │');
  console.log('  ├────────────────┼──────────────┼──────────────┤');
  console.log(`  │ Avg Recall     │ 92.9%        │ ${formatPercent(avgRecall).padStart(12)} │`);
  console.log('  └────────────────┴──────────────┴──────────────┘');
  console.log('='.repeat(60) + '\n');

  // ── Save ──────────────────────────────────────────────────────────────────
  const outPath = OUT_FILE || `benchmarks/results/convomem_top${TOP_K}_${new Date().toISOString().slice(0, 10)}.json`;
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    benchmark: 'ConvoMem',
    system: 'context-mem',
    top_k: TOP_K,
    items: items.length,
    avg_recall: avgRecall,
    elapsed_seconds: elapsed,
    per_category: Object.fromEntries(Object.entries(perCategory).map(([k, v]) => [k, {
      avg_recall: v.recalls.reduce((a, b) => a + b, 0) / v.total,
      perfect: v.perfect,
      total: v.total,
    }])),
    details: resultsLog,
  }, null, 2));
  console.log(`  Results saved: ${outPath}`);
}

run().catch(e => { console.error(e); process.exit(1); });
