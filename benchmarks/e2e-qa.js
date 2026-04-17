#!/usr/bin/env node
/**
 * context-mem × E2E QA Benchmark
 * ==============================
 *
 * Measures end-to-end QA accuracy on LongMemEval:
 *   1. Ingest haystack sessions into fresh context-mem DB.
 *   2. Retrieve top-k sessions for the question.
 *   3. Call Haiku to generate an answer from the retrieved context.
 *   4. Call Haiku-as-judge to score predicted vs expected.
 *   5. Aggregate accuracy + per-question-type breakdown.
 *
 * Requires: ANTHROPIC_API_KEY. Dataset: longmemeval_s_cleaned.json.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node benchmarks/e2e-qa.js /tmp/longmemeval-data/longmemeval_s_cleaned.json --limit 20 --top-k 5
 *   ANTHROPIC_API_KEY=sk-ant-... node benchmarks/e2e-qa.js data.json --limit 100 --top-k 10 --out results/my-run.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BenchKernel } = require('./lib/kernel-adapter');
const { printHeader, formatPercent } = require('./lib/metrics');

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dataFile = args.find(a => !a.startsWith('--'));

if (!dataFile) {
  console.log('Usage: node benchmarks/e2e-qa.js <data.json> [--limit N] [--top-k N] [--granularity session|turn] [--out FILE]');
  console.log('');
  console.log('Download data:');
  console.log('  mkdir -p /tmp/longmemeval-data');
  console.log('  curl -fsSL -o /tmp/longmemeval-data/longmemeval_s_cleaned.json \\');
  console.log('    https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY not set. This benchmark calls Claude Haiku for answer generation and judging.');
  console.error('  Set it with: export ANTHROPIC_API_KEY=sk-ant-...');
  process.exit(1);
}

function getArg(name, def) {
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return def;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '0'), 10);
const TOP_K = parseInt(getArg('top-k', '5'), 10);
const GRANULARITY = getArg('granularity', 'session');
const OUT_FILE = getArg('out', `benchmarks/results/e2e-qa-lme-${new Date().toISOString().slice(0, 10)}.json`);

const JUDGE_PROMPT = fs.readFileSync(path.resolve(__dirname, 'lib/qa-judge-prompt.md'), 'utf8');

// ── Rate limiter (mirrors kernel-adapter.js pattern) ─────────────────────────
const LLM_MIN_INTERVAL_MS = 2200;
let _lastReq = 0;

async function rateLimit() {
  const elapsed = Date.now() - _lastReq;
  if (elapsed < LLM_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, LLM_MIN_INTERVAL_MS - elapsed));
  }
  _lastReq = Date.now();
}

// ── Haiku caller ─────────────────────────────────────────────────────────────
async function callHaiku(prompt, maxTokens = 500, retries = 3) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimit();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      if (data?.error?.type === 'rate_limit_error') {
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      return data?.content?.[0]?.text ?? '';
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return '';
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildAnswerPrompt(question, context) {
  return `Answer this question using only the provided context. If the context does not contain the answer, say "I don't know."

Context:
${context}

Question: ${question}

Answer (concise, 1-3 sentences):`;
}

function buildJudgePrompt(question, expected, predicted) {
  return JUDGE_PROMPT
    .replace('{{QUESTION}}', question)
    .replace('{{EXPECTED}}', expected)
    .replace('{{PREDICTED}}', predicted);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  printHeader('context-mem × LongMemEval E2E QA Benchmark');
  console.log(`  Node:        ${process.version}`);
  console.log(`  OS:          ${os.platform()} ${os.arch()}`);
  console.log(`  Top-K:       ${TOP_K}`);
  console.log(`  Granularity: ${GRANULARITY}`);
  console.log(`  Data:        ${dataFile}`);

  // Load dataset
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Could not read dataset file: ${dataFile}`);
    console.error(`  ${e.message}`);
    console.error('');
    console.error('Download hint:');
    console.error('  mkdir -p /tmp/longmemeval-data');
    console.error('  curl -fsSL -o /tmp/longmemeval-data/longmemeval_s_cleaned.json \\');
    console.error('    https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json');
    process.exit(1);
  }

  let entries = Array.isArray(raw) ? raw : Object.values(raw);
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);
  console.log(`  Questions:   ${entries.length}`);
  console.log('─'.repeat(60));

  const results = [];
  const perType = {};
  const startTime = Date.now();

  for (let qi = 0; qi < entries.length; qi++) {
    const entry = entries[qi];
    const question = entry.question || entry.query;
    const expected = entry.answer || entry.expected_answer;
    const qType = entry.question_type || entry.type || 'unknown';

    // ── Mirror longmemeval.js session extraction exactly ──────────────────────
    const sessions = entry.haystack_sessions || [];
    const sessionIds = entry.haystack_session_ids || [];

    // 1. Fresh BenchKernel + ingest
    const kernel = new BenchKernel().open();

    if (GRANULARITY === 'session') {
      for (let si = 0; si < sessions.length; si++) {
        const session = sessions[si];
        const sessId = sessionIds[si] || `sess_${si}`;

        // Mirror longmemeval.js: user turns + answer-bearing assistant turns
        const parts = [];
        for (const t of session) {
          if (t.role === 'user') {
            parts.push(t.content);
          } else if (t.has_answer) {
            parts.push(t.content);
          }
        }

        const sessionDate = entry.haystack_dates?.[si] || null;
        if (parts.length > 0) {
          const doc = parts.join('\n');
          kernel.ingest(sessId, doc, { session_index: si, date: sessionDate });
        }
      }
    } else {
      // Turn-level granularity
      for (let si = 0; si < sessions.length; si++) {
        const session = sessions[si];
        const sessId = sessionIds[si] || `sess_${si}`;
        let turnNum = 0;
        for (const turn of session) {
          if (turn.role === 'user') {
            const turnId = `${sessId}_turn_${turnNum}`;
            kernel.ingest(turnId, turn.content, { session_id: sessId, turn: turnNum });
            turnNum++;
          }
        }
      }
    }

    // 2. Retrieve top-K
    const searchOpts = {};
    if (entry.question_date) searchOpts.referenceDate = entry.question_date;
    const hits = await kernel.searchAsync(question, TOP_K, searchOpts);

    // 3. Build context from top-K retrieved docs
    const contextIds = hits.slice(0, TOP_K).map(h => h.id);
    let context = '';
    if (contextIds.length > 0) {
      const placeholders = contextIds.map(() => '?').join(',');
      const contextRows = kernel.db.prepare(
        `SELECT content FROM observations WHERE id IN (${placeholders})`
      ).all(...contextIds);
      context = contextRows.map(r => r.content).join('\n\n---\n\n').slice(0, 20000);
    }

    // 4. Haiku answer generation — skip when retrieval returned nothing
    let predicted = '';
    if (context.length === 0) {
      predicted = "I don't know.";
    } else {
      try {
        predicted = await callHaiku(buildAnswerPrompt(question, context), 400);
      } catch (e) {
        predicted = '[ERROR: answer generation failed]';
      }
    }

    // 5. Haiku-as-judge scoring — skip when no retrieval; always wrong by definition
    let judgment = '';
    let score = 0;
    if (context.length === 0) {
      judgment = 'SCORE: 0\n[no-retrieval: top-k was empty]';
    } else {
      try {
        judgment = await callHaiku(buildJudgePrompt(question, expected, predicted), 150);
      } catch (e) {
        judgment = 'SCORE: 0\n[ERROR: judge failed]';
      }
      score = /SCORE:\s*1/i.test(judgment) ? 1 : 0;
    }

    results.push({
      q_id: entry.id || entry.question_id || `q${qi}`,
      type: qType,
      question,
      expected,
      predicted,
      score,
      judgment: judgment.split('\n').slice(0, 2).join(' '),
    });

    perType[qType] = perType[qType] || { correct: 0, total: 0 };
    perType[qType].total++;
    perType[qType].correct += score;

    kernel.close();

    if ((qi + 1) % 10 === 0 || qi === entries.length - 1) {
      const correct = results.reduce((s, r) => s + r.score, 0);
      console.log(`  [${String(qi + 1).padStart(4)}/${entries.length}] running accuracy: ${formatPercent(correct / results.length)}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const accuracy = results.reduce((s, r) => s + r.score, 0) / results.length;

  // ── Results ──────────────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`  Overall accuracy: ${formatPercent(accuracy)}  (${results.filter(r => r.score === 1).length}/${results.length})`);
  console.log(`  Time:             ${elapsed.toFixed(1)}s (${(elapsed / results.length).toFixed(2)}s per question)`);
  console.log('');
  console.log('  PER-TYPE BREAKDOWN:');
  for (const [type, data] of Object.entries(perType).sort()) {
    console.log(`    ${type.padEnd(32)} ${formatPercent(data.correct / data.total).padStart(6)}  (n=${data.total})`);
  }
  console.log('='.repeat(60) + '\n');

  // ── Save results ─────────────────────────────────────────────────────────────
  const output = {
    benchmark: 'LongMemEval E2E QA',
    system: 'context-mem',
    date: new Date().toISOString().slice(0, 10),
    top_k: TOP_K,
    granularity: GRANULARITY,
    questions: results.length,
    accuracy,
    elapsed_seconds: elapsed,
    per_type: Object.fromEntries(
      Object.entries(perType).map(([k, v]) => [k, {
        accuracy: v.correct / v.total,
        correct: v.correct,
        total: v.total,
      }])
    ),
    results,
  };

  fs.mkdirSync(path.dirname(path.resolve(OUT_FILE)), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`  Results saved: ${OUT_FILE}`);
})().catch(err => { console.error(err); process.exit(1); });
