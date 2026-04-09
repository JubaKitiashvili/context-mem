#!/usr/bin/env node
/**
 * context-mem × LMEB Benchmark (Long-horizon Memory Embedding Benchmark)
 * =========================================================================
 *
 * 22 datasets, 193 retrieval tasks across 4 memory types:
 * Episodic, Dialogue, Semantic, Procedural.
 *
 * Standard MTEB-style evaluation: queries, corpus, qrels (binary relevance).
 * Primary metric: NDCG@10 + R_cap@k.
 *
 * Data: huggingface-cli download KaLM-Embedding/LMEB --local-dir ./eval_data
 *
 * Usage:
 *   node benchmarks/lmeb.js /tmp/lmeb/eval_data
 *   node benchmarks/lmeb.js /tmp/lmeb/eval_data --task LoCoMo
 *   node benchmarks/lmeb.js /tmp/lmeb/eval_data --task LongMemEval --subset single-session-user
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { BenchKernel } = require('./lib/kernel-adapter');
const { ndcg, formatPercent, printHeader } = require('./lib/metrics');

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataDir = args.find(a => !a.startsWith('--'));
if (!dataDir) {
  console.log('Usage: node benchmarks/lmeb.js <eval_data_dir> [--task NAME] [--subset NAME] [--top-k 10]');
  console.log('\nSetup:');
  console.log('  pip install huggingface_hub');
  console.log('  huggingface-cli download --repo-type dataset KaLM-Embedding/LMEB --local-dir /tmp/lmeb/eval_data');
  process.exit(1);
}

function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const TASK_FILTER = getArg('task', null);
const SUBSET_FILTER = getArg('subset', null);
const TOP_K = parseInt(getArg('top-k', '10'), 10);
const OUT_FILE = getArg('out', null);

// ── JSONL reader ────────────────────────────────────────────────────────────
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function readQrels(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const qrels = {}; // queryId → Set of relevant docIds
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const [queryId, corpusId, score] = parts;
      if (parseInt(score) > 0) {
        if (!qrels[queryId]) qrels[queryId] = new Set();
        qrels[queryId].add(corpusId);
      }
    }
  }
  return qrels;
}

// ── Discover tasks ──────────────────────────────────────────────────────────
function discoverTasks(baseDir) {
  const memTypes = ['Dialogue', 'Episodic', 'Semantic', 'Procedural'];
  const tasks = [];

  for (const memType of memTypes) {
    const typeDir = path.join(baseDir, memType);
    if (!fs.existsSync(typeDir)) continue;

    for (const taskName of fs.readdirSync(typeDir)) {
      if (TASK_FILTER && taskName !== TASK_FILTER) continue;
      const taskDir = path.join(typeDir, taskName);
      if (!fs.statSync(taskDir).isDirectory()) continue;

      // Corpus can be at task root or per-subset
      const rootCorpus = path.join(taskDir, 'corpus.jsonl');
      const hasRootCorpus = fs.existsSync(rootCorpus);

      // Find subsets (directories with queries.jsonl)
      const subsets = [];
      for (const item of fs.readdirSync(taskDir)) {
        const subDir = path.join(taskDir, item);
        if (!fs.statSync(subDir).isDirectory()) continue;
        if (!fs.existsSync(path.join(subDir, 'queries.jsonl'))) continue;
        if (SUBSET_FILTER && item !== SUBSET_FILTER) continue;
        // Per-subset corpus takes precedence, fall back to root
        const subCorpus = path.join(subDir, 'corpus.jsonl');
        const corpusPath = fs.existsSync(subCorpus) ? subCorpus : (hasRootCorpus ? rootCorpus : null);
        if (!corpusPath) continue;
        subsets.push({ name: item, corpusFile: corpusPath });
      }

      // Also check if queries.jsonl is at task root level
      if (hasRootCorpus && fs.existsSync(path.join(taskDir, 'queries.jsonl')) && fs.existsSync(path.join(taskDir, 'qrels.tsv'))) {
        if (!SUBSET_FILTER || SUBSET_FILTER === 'default') {
          subsets.push({ name: '_root', corpusFile: rootCorpus });
        }
      }

      if (subsets.length > 0) {
        tasks.push({ memType, taskName, taskDir, subsets });
      }
    }
  }

  return tasks;
}

// ── NDCG computation ────────────────────────────────────────────────────────
function computeNDCG(retrievedIds, relevantIds, k) {
  const relevant = new Set(relevantIds);
  const relevances = retrievedIds.slice(0, k).map(id => relevant.has(id) ? 1.0 : 0.0);
  const ideal = [...relevances].sort((a, b) => b - a);

  function dcg(rels, n) {
    let s = 0;
    for (let i = 0; i < Math.min(rels.length, n); i++) {
      s += rels[i] / Math.log2(i + 2);
    }
    return s;
  }

  const idcg = dcg(ideal, k);
  return idcg === 0 ? 0 : dcg(relevances, k) / idcg;
}

function recallCap(retrievedIds, relevantIds, k) {
  const topK = new Set(retrievedIds.slice(0, k));
  const hits = [...relevantIds].filter(id => topK.has(id)).length;
  const cap = Math.min(relevantIds.length, k);
  return cap === 0 ? 0 : hits / cap;
}

// ── Run benchmark ───────────────────────────────────────────────────────────
printHeader('context-mem × LMEB Benchmark');

const tasks = discoverTasks(dataDir);
console.log(`  Tasks found: ${tasks.length}`);
console.log(`  Top-K:       ${TOP_K}`);
console.log('─'.repeat(60));

if (tasks.length === 0) {
  console.log('  No tasks found. Check data directory structure.');
  console.log('  Expected: <dir>/<MemType>/<TaskName>/corpus.jsonl');
  process.exit(1);
}

const allTaskResults = [];
const startTime = Date.now();

for (const task of tasks) {
  for (const subset of task.subsets) {
    const subDir = subset.name === '_root' ? task.taskDir : path.join(task.taskDir, subset.name);
    const queries = readJsonl(path.join(subDir, 'queries.jsonl'));
    const qrels = readQrels(path.join(subDir, 'qrels.tsv'));

    // Load corpus for this subset
    const corpus = readJsonl(subset.corpusFile);

    // Skip huge corpuses (>50K docs) — too slow for FTS5 per-query rebuild
    if (corpus.length > 50000) {
      console.log(`  ${task.taskName}/${subset.name}: SKIPPED (corpus ${corpus.length} docs too large)`);
      continue;
    }

    // Load candidates if available
    const candidatesFile = path.join(subDir, 'candidates.jsonl');
    const rootCandidates = path.join(task.taskDir, 'candidates.jsonl');
    const candFile = fs.existsSync(candidatesFile) ? candidatesFile : (fs.existsSync(rootCandidates) ? rootCandidates : null);
    const candidatesByScene = new Map();
    if (candFile) {
      const candidates = readJsonl(candFile);
      candidates.forEach(c => candidatesByScene.set(c.scene_id, new Set(c.candidate_doc_ids)));
    }

    {

    if (!queries.length) continue;

    // Build kernel with corpus docs
    const kernel = new BenchKernel().open();
    for (const doc of corpus) {
      const text = [doc.title, doc.text].filter(Boolean).join('\n');
      kernel.ingest(doc.id, text);
    }

    let ndcgSum = 0;
    let rcapSum = 0;
    let queryCount = 0;

    for (const query of queries) {
      const relevantIds = qrels[query.id];
      if (!relevantIds || relevantIds.size === 0) continue;

      // Get scene_id for candidate filtering
      const qid = String(query.id);
      const sceneId = qid.split('_').slice(0, 2).join('_');
      const candidateSet = candidatesByScene.get(sceneId);

      let results = kernel.search(query.text, TOP_K * 5); // over-fetch for filtering
      let retrievedIds = results.map(r => r.id);

      // Filter to candidate set if available
      if (candidateSet) {
        retrievedIds = retrievedIds.filter(id => candidateSet.has(id));
      }

      const ndcgScore = computeNDCG(retrievedIds, [...relevantIds], TOP_K);
      const rcap = recallCap(retrievedIds, [...relevantIds], TOP_K);

      ndcgSum += ndcgScore;
      rcapSum += rcap;
      queryCount++;
    }

    kernel.close();

    if (queryCount > 0) {
      const avgNdcg = ndcgSum / queryCount;
      const avgRcap = rcapSum / queryCount;
      const subsetName = subset.name === '_root' ? 'default' : subset.name;
      console.log(`  ${task.taskName}/${subsetName}: NDCG@${TOP_K}=${avgNdcg.toFixed(3)}  R_cap@${TOP_K}=${formatPercent(avgRcap)}  (${queryCount} queries)`);

      allTaskResults.push({
        memType: task.memType,
        task: task.taskName,
        subset: subsetName,
        ndcg_at_k: avgNdcg,
        rcap_at_k: avgRcap,
        queries: queryCount,
      });
    }
    }
  }
}

const elapsed = (Date.now() - startTime) / 1000;

// ── Aggregate results ───────────────────────────────────────────────────────
printHeader(`RESULTS — context-mem on LMEB (top-${TOP_K})`);
console.log(`  Time:     ${elapsed.toFixed(1)}s`);
console.log(`  Tasks:    ${allTaskResults.length} subtasks`);

// Per memory type
const byType = {};
for (const r of allTaskResults) {
  if (!byType[r.memType]) byType[r.memType] = { ndcg: 0, rcap: 0, n: 0 };
  byType[r.memType].ndcg += r.ndcg_at_k;
  byType[r.memType].rcap += r.rcap_at_k;
  byType[r.memType].n++;
}

console.log('\n  BY MEMORY TYPE:');
let totalNdcg = 0, totalN = 0;
for (const [type, data] of Object.entries(byType).sort()) {
  const avgN = data.ndcg / data.n;
  const avgR = data.rcap / data.n;
  console.log(`    ${type.padEnd(15)} NDCG@${TOP_K}=${avgN.toFixed(3)}  R_cap@${TOP_K}=${formatPercent(avgR)}  (${data.n} subtasks)`);
  totalNdcg += data.ndcg;
  totalN += data.n;
}

const overallNdcg = totalN > 0 ? totalNdcg / totalN : 0;
console.log(`\n  OVERALL NDCG@${TOP_K}: ${overallNdcg.toFixed(3)}`);
console.log('='.repeat(60));

// ── Save ────────────────────────────────────────────────────────────────────
const outPath = OUT_FILE || `benchmarks/results/lmeb_top${TOP_K}_${new Date().toISOString().slice(0, 10)}.json`;
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  benchmark: 'LMEB',
  system: 'context-mem',
  top_k: TOP_K,
  subtasks: allTaskResults.length,
  overall_ndcg: overallNdcg,
  by_memory_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, {
    avg_ndcg: v.ndcg / v.n, avg_rcap: v.rcap / v.n, subtasks: v.n
  }])),
  details: allTaskResults,
  elapsed_seconds: elapsed,
}, null, 2));
console.log(`  Results saved: ${outPath}`);
