#!/usr/bin/env node
/**
 * context-mem × LongMemEval Benchmark
 * ====================================
 *
 * Same benchmark as mempalace. Tests retrieval across ~53 conversation sessions.
 * For each of the 500 questions:
 *   1. Ingest all haystack sessions into a fresh context-mem DB
 *   2. Query with the question
 *   3. Score against ground-truth answer sessions
 *
 * Data: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 *
 * Usage:
 *   node benchmarks/longmemeval.js /tmp/longmemeval-data/longmemeval_s_cleaned.json
 *   node benchmarks/longmemeval.js data.json --limit 20
 *   node benchmarks/longmemeval.js data.json --granularity turn
 *   node benchmarks/longmemeval.js data.json --top-k 5
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BenchKernel, llmRerank } = require('./lib/kernel-adapter');
const { RealKernelBench } = require('./lib/real-kernel-bench');
const { recallAtK, ndcg, formatPercent, printHeader, printResults } = require('./lib/metrics');

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataFile = args.find(a => !a.startsWith('--'));
if (!dataFile) {
  console.log('Usage: node benchmarks/longmemeval.js <data.json> [--limit N] [--granularity session|turn] [--top-k N]');
  console.log('\nDownload data:');
  console.log('  mkdir -p /tmp/longmemeval-data');
  console.log('  curl -fsSL -o /tmp/longmemeval-data/longmemeval_s_cleaned.json \\');
  console.log('    https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json');
  process.exit(1);
}

function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '0'), 10);
const GRANULARITY = getArg('granularity', 'session');
const USE_VECTOR = args.includes('--vector');
const USE_LLM = args.includes('--llm');
const DUMP_FAILURES = args.includes('--dump-failures');
const TOP_K = parseInt(getArg('top-k', '10'), 10);
const OUT_FILE = getArg('out', null);
const FAILURES_FILE = getArg('failures-out', 'benchmarks/results/lme-failures.json');
const ENGINE = getArg('engine', 'bench'); // 'bench' (stripped BM25-only) or 'real' (full v4.0 product)
const USE_SYNTHESIS = !args.includes('--no-synthesis');
const USE_VAULT = !args.includes('--no-vault');

// ── Load data ───────────────────────────────────────────────────────────────
printHeader('context-mem × LongMemEval Benchmark');
console.log(`  Node:        ${process.version}`);
console.log(`  OS:          ${os.platform()} ${os.arch()}`);
console.log(`  Engine:      ${ENGINE}${ENGINE === 'real' ? ` (synthesis=${USE_SYNTHESIS}, vault=${USE_VAULT}, vector=${USE_VECTOR})` : ' (BM25 adapter)'}`);
console.log(`  Granularity: ${GRANULARITY}`);
console.log(`  Top-K:       ${TOP_K}`);
console.log(`  Data:        ${dataFile}`);

const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
let entries = Array.isArray(raw) ? raw : Object.values(raw);
if (LIMIT > 0) entries = entries.slice(0, LIMIT);
console.log(`  Questions:   ${entries.length}`);
console.log('─'.repeat(60));

// ── Run benchmark ───────────────────────────────────────────────────────────
const allRecall5 = [];
const allRecall10 = [];
const allNdcg10 = [];
const perType = {};
const resultsLog = [];
const startTime = Date.now();

// Shared real-kernel instance (reused across questions — expensive to start)
let sharedRealKernel = null;
async function acquireKernel() {
  if (ENGINE === 'real') {
    if (!sharedRealKernel) {
      sharedRealKernel = await new RealKernelBench({
        synthesis: USE_SYNTHESIS,
        vault: USE_VAULT,
        vector: USE_VECTOR,
      }).open();
    } else {
      await sharedRealKernel.resetObservations();
    }
    return sharedRealKernel;
  }
  return new BenchKernel().open();
}

(async () => {
for (let qi = 0; qi < entries.length; qi++) {
  const entry = entries[qi];
  const question = entry.question || entry.query;
  const qType = entry.question_type || entry.type || 'unknown';
  const correctSessionIds = entry.answer_session_ids || entry.gold_session_ids || [];

  if (!correctSessionIds.length) continue;

  // Build corpus from haystack sessions
  const kernel = await acquireKernel();
  const corpusIds = [];

  const sessions = entry.haystack_sessions || [];
  const sessionIds = entry.haystack_session_ids || [];

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];
    const sessId = sessionIds[si] || `sess_${si}`;

    if (GRANULARITY === 'session') {
      // User turns in full + answer-bearing assistant turns (selective enrichment)
      const parts = [];
      for (const t of session) {
        if (t.role === 'user') {
          parts.push(t.content);
        } else if (t.has_answer) {
          // Only include assistant turns that are marked as containing answer info
          parts.push(t.content);
        }
      }
      // Pass session date as metadata so temporal filtering works against indexed_at.
      const sessionDate = entry.haystack_dates?.[si] || null;
      if (parts.length > 0) {
        const doc = parts.join('\n');
        await kernel.ingest(sessId, doc, { session_index: si, date: sessionDate });
        corpusIds.push(sessId);
      }
    } else {
      // Turn-level granularity
      let turnNum = 0;
      for (const turn of session) {
        if (turn.role === 'user') {
          const turnId = `${sessId}_turn_${turnNum}`;
          await kernel.ingest(turnId, turn.content, { session_id: sessId, turn: turnNum });
          corpusIds.push(turnId);
          turnNum++;
        }
      }
    }
  }

  // Embed corpus for hybrid search (per-question, ~50 docs — manageable)
  if (USE_VECTOR) {
    await kernel.embedAll();
  }

  // Real-engine: await synthesis flush + embedding queue drain before search
  if (ENGINE === 'real' && typeof kernel.flushAll === 'function') {
    await kernel.flushAll();
  }

  // Query — BM25 or hybrid parallel (BM25 + vector independent retrieval)
  const searchOpts = {};
  if (entry.question_date) searchOpts.referenceDate = entry.question_date;

  let results;
  const fetchLimit = USE_LLM ? 30 : Math.max(TOP_K, 10);
  // For failure dumps, also fetch a wider pool (top-100) to diagnose retrieval vs rank miss
  const diagnosticLimit = DUMP_FAILURES ? 100 : fetchLimit;
  if (USE_VECTOR) {
    // Hybrid parallel: BM25 and vector find candidates independently, then merge
    results = await kernel.hybridSearch(question, diagnosticLimit, searchOpts);
  } else {
    results = kernel.search(question, diagnosticLimit, searchOpts);
  }
  // Keep the wide pool for diagnostics before any rerank/trimming
  const widePool = DUMP_FAILURES ? results.map((r, i) => ({ id: kernel.resolveId(r.id), rank: i + 1, score: r.score })) : null;
  // Trim to actual retrieval limit for scoring
  if (DUMP_FAILURES && results.length > fetchLimit) results = results.slice(0, fetchLimit);
  // LLM rerank: blend Claude scores with retrieval scores
  if (USE_LLM) {
    results = await llmRerank(kernel, question, results, Math.max(TOP_K, 10), entry.question_date || null);
  }
  const retrievedIds = results.map(r => kernel.resolveId(r.id));

  // For turn granularity, map back to session IDs for scoring
  const retrievedSessionIds = GRANULARITY === 'turn'
    ? retrievedIds.map(id => id.includes('_turn_') ? id.split('_turn_')[0] : id)
    : retrievedIds;

  // Score
  const r5 = recallAtK(retrievedSessionIds, correctSessionIds, 5);
  const r10 = recallAtK(retrievedSessionIds, correctSessionIds, 10);
  const n10 = ndcg(retrievedSessionIds, correctSessionIds, 10);

  allRecall5.push(r5);
  allRecall10.push(r10);
  allNdcg10.push(n10);

  if (!perType[qType]) perType[qType] = { r5: [], r10: [], n10: [], count: 0 };
  perType[qType].r5.push(r5);
  perType[qType].r10.push(r10);
  perType[qType].n10.push(n10);
  perType[qType].count++;

  // For failure diagnostics: check where the correct doc sits in the wide pool
  let diagnostics = null;
  if (DUMP_FAILURES && r5 === 0 && widePool) {
    const correctInPool = widePool.filter(r => correctSessionIds.includes(r.id));
    diagnostics = {
      failure_type: correctInPool.length === 0 ? 'retrieval_miss' : 'rank_miss',
      correct_doc_ranks: correctInPool.map(r => ({ id: r.id, rank: r.rank, score: r.score })),
      top_5_retrieved: retrievedSessionIds.slice(0, 5),
    };
  }

  resultsLog.push({
    question, type: qType,
    correct: correctSessionIds,
    retrieved: retrievedSessionIds.slice(0, TOP_K),
    recall_5: r5, recall_10: r10, ndcg_10: n10,
    diagnostics,
  });

  // Real-engine: reset state (keep kernel hot) instead of closing between questions
  if (ENGINE !== 'real') {
    kernel.close();
  }

  if ((qi + 1) % 50 === 0 || qi === entries.length - 1) {
    const avgR5 = allRecall5.reduce((a, b) => a + b, 0) / allRecall5.length;
    console.log(`  [${String(qi + 1).padStart(4)}/${entries.length}] R@5=${formatPercent(avgR5)}  R@10=${formatPercent(allRecall10.reduce((a, b) => a + b, 0) / allRecall10.length)}`);
  }
}

// Cleanup shared real kernel at end
if (sharedRealKernel) {
  try { await sharedRealKernel.close(); } catch {}
}

const elapsed = (Date.now() - startTime) / 1000;
const avgR5 = allRecall5.reduce((a, b) => a + b, 0) / allRecall5.length;
const avgR10 = allRecall10.reduce((a, b) => a + b, 0) / allRecall10.length;
const avgN10 = allNdcg10.reduce((a, b) => a + b, 0) / allNdcg10.length;

// ── Results ─────────────────────────────────────────────────────────────────
printHeader(`RESULTS — context-mem (${GRANULARITY}, top-${TOP_K})`);
console.log(`  Time:      ${elapsed.toFixed(1)}s (${(elapsed / entries.length).toFixed(2)}s per question)`);
console.log(`  Questions: ${entries.length}`);
console.log(`  Recall@5:  ${formatPercent(avgR5)}`);
console.log(`  Recall@10: ${formatPercent(avgR10)}`);
console.log(`  NDCG@10:   ${avgN10.toFixed(3)}`);

console.log('\n  PER-TYPE BREAKDOWN:');
for (const [type, data] of Object.entries(perType).sort()) {
  const tr5 = data.r5.reduce((a, b) => a + b, 0) / data.count;
  console.log(`    ${type.padEnd(30)} R@5=${formatPercent(tr5)}  (n=${data.count})`);
}

// ── vs MemPalace comparison ─────────────────────────────────────────────────
console.log('\n  HEAD-TO-HEAD vs MemPalace (raw mode, session granularity):');
console.log('  ┌────────────────┬──────────────┬──────────────┐');
console.log('  │ Metric         │ MemPalace    │ context-mem  │');
console.log('  ├────────────────┼──────────────┼──────────────┤');
console.log(`  │ Recall@5       │ 96.6%        │ ${formatPercent(avgR5).padStart(12)} │`);
console.log(`  │ Recall@10      │ 98.2%        │ ${formatPercent(avgR10).padStart(12)} │`);
console.log(`  │ NDCG@10        │ 0.889        │ ${avgN10.toFixed(3).padStart(12)} │`);
console.log('  └────────────────┴──────────────┴──────────────┘');
console.log('='.repeat(60) + '\n');

// ── Save results ────────────────────────────────────────────────────────────
const outPath = OUT_FILE || `benchmarks/results/longmemeval_${GRANULARITY}_top${TOP_K}_${new Date().toISOString().slice(0, 10)}.json`;
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  benchmark: 'LongMemEval',
  system: 'context-mem',
  granularity: GRANULARITY,
  top_k: TOP_K,
  questions: entries.length,
  recall_5: avgR5,
  recall_10: avgR10,
  ndcg_10: avgN10,
  elapsed_seconds: elapsed,
  per_type: Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, {
    recall_5: v.r5.reduce((a, b) => a + b, 0) / v.count,
    recall_10: v.r10.reduce((a, b) => a + b, 0) / v.count,
    count: v.count,
  }])),
  details: resultsLog,
}, null, 2));
console.log(`  Results saved: ${outPath}`);

// Dump failures separately for analysis
if (DUMP_FAILURES) {
  const failures = resultsLog.filter(r => r.recall_5 === 0);
  const retrievalMisses = failures.filter(r => r.diagnostics?.failure_type === 'retrieval_miss');
  const rankMisses = failures.filter(r => r.diagnostics?.failure_type === 'rank_miss');
  const failuresOut = {
    total_questions: entries.length,
    total_failures: failures.length,
    retrieval_misses: retrievalMisses.length,
    rank_misses: rankMisses.length,
    by_type: Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, {
      failures: v.r5.filter(r => r === 0).length,
      total: v.count,
    }])),
    failures,
  };
  fs.writeFileSync(FAILURES_FILE, JSON.stringify(failuresOut, null, 2));
  console.log(`\n  Failure analysis: ${FAILURES_FILE}`);
  console.log(`  ${failures.length} failures: ${retrievalMisses.length} retrieval misses (correct doc NOT in top 100), ${rankMisses.length} rank misses (in top 100 but not top 5)`);
}

})().catch(e => { console.error(e); process.exit(1); });
