#!/usr/bin/env node
/**
 * context-mem × BEAM Benchmark (ICLR 2026)
 * ==========================================
 *
 * Tests 10 memory dimensions: information extraction, knowledge update,
 * contradiction resolution, temporal reasoning, multi-hop reasoning,
 * event ordering, preference following, instruction following,
 * summarization, and abstention.
 *
 * Uses source_chat_ids as retrieval ground truth (no LLM judge needed).
 *
 * Data: https://github.com/mohammadtavakoli78/BEAM
 *
 * Usage:
 *   git clone https://github.com/mohammadtavakoli78/BEAM.git /tmp/beam
 *   node benchmarks/beam.js /tmp/beam/chats/100K
 *   node benchmarks/beam.js /tmp/beam/chats/100K --limit 5
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BenchKernel } = require('./lib/kernel-adapter');
const { recallAtK, ndcg, formatPercent, printHeader } = require('./lib/metrics');

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataDir = args.find(a => !a.startsWith('--'));
if (!dataDir) {
  console.log('Usage: node benchmarks/beam.js <chats/100K> [--limit N] [--top-k 10]');
  console.log('\nSetup: git clone https://github.com/mohammadtavakoli78/BEAM.git /tmp/beam');
  process.exit(1);
}

function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '0'), 10);
const TOP_K = parseInt(getArg('top-k', '20'), 10);
const OUT_FILE = getArg('out', null);

// ── Load conversations ──────────────────────────────────────────────────────
printHeader('context-mem × BEAM Benchmark (ICLR 2026)');

// Find all conversation directories
const convDirs = fs.readdirSync(dataDir)
  .filter(d => fs.statSync(path.join(dataDir, d)).isDirectory() && d !== '.git')
  .sort((a, b) => parseInt(a) - parseInt(b));

let conversations = convDirs.map(d => ({
  id: d,
  chatPath: path.join(dataDir, d, 'chat.json'),
  questionsPath: path.join(dataDir, d, 'probing_questions', 'probing_questions.json'),
})).filter(c => fs.existsSync(c.chatPath) && fs.existsSync(c.questionsPath));

if (LIMIT > 0) conversations = conversations.slice(0, LIMIT);
console.log(`  Conversations: ${conversations.length}`);
console.log(`  Top-K:         ${TOP_K}`);
console.log('─'.repeat(60));

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractMessages(chatData) {
  const messages = [];
  for (const batch of chatData) {
    if (!batch.turns) continue;
    for (const turn of batch.turns) {
      for (const msg of turn) {
        if (msg.role === 'user' && msg.content) {
          messages.push({ id: msg.id, content: msg.content.replace(/->->\s*\d+,\d+\s*$/, '').trim() });
        }
      }
    }
  }
  return messages;
}

function extractSourceIds(question) {
  const ids = question.source_chat_ids;
  if (!ids) return [];
  if (Array.isArray(ids)) return ids.map(Number);
  if (typeof ids === 'object') {
    // { "first_statement": [58], "second_statement": [24] } or similar
    return Object.values(ids).flat().map(Number);
  }
  return [Number(ids)];
}

// ── Run benchmark ───────────────────────────────────────────────────────────
const allRecall = [];
const perAbility = {};
const resultsLog = [];
const startTime = Date.now();
let totalQuestions = 0;

(async () => {
for (let ci = 0; ci < conversations.length; ci++) {
  const conv = conversations[ci];
  const chatData = JSON.parse(fs.readFileSync(conv.chatPath, 'utf8'));
  const questionsData = JSON.parse(fs.readFileSync(conv.questionsPath, 'utf8'));
  const messages = extractMessages(chatData);

  if (!messages.length) continue;

  // Build kernel with user messages
  const kernel = new BenchKernel().open();
  for (const msg of messages) {
    kernel.ingest(`msg_${msg.id}`, msg.content, { chat_id: msg.id });
  }

  let convQuestions = 0;
  let convHits = 0;

  for (const [ability, questions] of Object.entries(questionsData)) {
    for (const q of questions) {
      const sourceIds = extractSourceIds(q);
      if (!sourceIds.length) continue; // skip questions without retrieval ground truth

      const correctDocIds = sourceIds.map(id => `msg_${id}`);

      // Search with 3x oversampling for multi-source queries (summarization needs many hits)
      const searchK = Math.max(TOP_K, sourceIds.length * 2);
      const results = kernel.search(q.question, searchK);
      const retrievedIds = results.map(r => r.id);

      const r5 = recallAtK(retrievedIds, correctDocIds, 5);
      const r10 = recallAtK(retrievedIds, correctDocIds, TOP_K);

      allRecall.push(r10);
      totalQuestions++;
      convQuestions++;
      if (r10 > 0) convHits++;

      if (!perAbility[ability]) perAbility[ability] = { hits: 0, total: 0, r5_sum: 0 };
      perAbility[ability].total++;
      perAbility[ability].r5_sum += r5;
      if (r10 > 0) perAbility[ability].hits++;

      resultsLog.push({
        conversation: conv.id,
        ability,
        question: q.question.slice(0, 120),
        correct: sourceIds,
        retrieved: retrievedIds.slice(0, 5).map(id => parseInt(id.replace('msg_', ''), 10)),
        recall_10: r10,
      });
    }
  }

  kernel.close();
  const convRecall = convQuestions > 0 ? convHits / convQuestions : 0;
  console.log(`  Conv ${conv.id}: ${convQuestions} Q, R@${TOP_K}=${formatPercent(convRecall)}`);
}

const elapsed = (Date.now() - startTime) / 1000;
const avgRecall = allRecall.length > 0 ? allRecall.reduce((a, b) => a + b, 0) / allRecall.length : 0;

// ── Results ─────────────────────────────────────────────────────────────────
printHeader(`RESULTS — context-mem on BEAM (top-${TOP_K})`);
console.log(`  Time:       ${elapsed.toFixed(1)}s`);
console.log(`  Questions:  ${totalQuestions}`);
console.log(`  Avg R@${TOP_K}:  ${formatPercent(avgRecall)}`);

console.log('\n  PER-ABILITY:');
for (const [ability, data] of Object.entries(perAbility).sort()) {
  const pct = data.total > 0 ? data.hits / data.total : 0;
  const r5avg = data.total > 0 ? data.r5_sum / data.total : 0;
  console.log(`    ${ability.padEnd(28)} R@${TOP_K}=${formatPercent(pct).padStart(6)}  R@5=${formatPercent(r5avg).padStart(6)}  (n=${data.total})`);
}
console.log('\n' + '='.repeat(60));

// ── Save ────────────────────────────────────────────────────────────────────
const outPath = OUT_FILE || `benchmarks/results/beam_top${TOP_K}_${new Date().toISOString().slice(0, 10)}.json`;
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  benchmark: 'BEAM',
  system: 'context-mem',
  top_k: TOP_K,
  questions: totalQuestions,
  avg_recall: avgRecall,
  elapsed_seconds: elapsed,
  per_ability: perAbility,
  details: resultsLog,
}, null, 2));
console.log(`\n  Results saved: ${outPath}`);

})().catch(e => { console.error(e); process.exit(1); });
