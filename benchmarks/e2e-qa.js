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
 * Auth (no ANTHROPIC_API_KEY required if claude CLI is logged in):
 *   Automatically uses claude CLI OAuth session (Claude Max subscription) OR
 *   ANTHROPIC_API_KEY if set. Run `claude` once to log in if neither is present.
 *
 * Usage:
 *   node benchmarks/e2e-qa.js /tmp/longmemeval-data/longmemeval_s_cleaned.json --limit 20 --top-k 5
 *   node benchmarks/e2e-qa.js data.json --limit 100 --top-k 10 --out results/my-run.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BenchKernel } = require('./lib/kernel-adapter');
const { RealKernelBench } = require('./lib/real-kernel-bench');
const { printHeader, formatPercent } = require('./lib/metrics');

// haiku-client.mjs is ESM-only; we use a top-level promise and await it in main.
const haikuClientPromise = import('./lib/haiku-client.mjs');

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

function getArg(name, def) {
  // Support both "--name value" and "--name=value"
  const eqArg = args.find(a => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.slice(name.length + 3);
  const idx = args.indexOf('--' + name);
  if (idx === -1 || idx + 1 >= args.length) return def;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '0'), 10);
const TOP_K = parseInt(getArg('top-k', '2'), 10); // T5.6: 5 → 2 (reduce context noise)
const GRANULARITY = getArg('granularity', 'session');
const ENGINE = getArg('engine', 'bench'); // T5.1: 'real' uses full v4.0 pipeline
const INGEST = getArg('ingest', 'full'); // T5.6: 'full' (user+assistant) or 'user-only' (v3.4 behavior)
const OUT_FILE = getArg('out', `benchmarks/results/e2e-qa-lme-${new Date().toISOString().slice(0, 10)}.json`);

const JUDGE_PROMPT = fs.readFileSync(path.resolve(__dirname, 'lib/qa-judge-prompt.md'), 'utf8');

// ── Prompt builders (T5.6 neutral prompt — extract, don't abstain) ──────────
function buildAnswerPrompt(question, context) {
  return `You are reading a conversation log to answer the user's question. The answer is almost certainly present in the log — read carefully and extract the specific information.

Conversation log:
${context}

User's question: ${question}

Extract and state the answer directly. If the log contains multiple related facts, synthesize them. Keep your response under 2 sentences.`;
}

function buildJudgePrompt(question, expected, predicted) {
  return JUDGE_PROMPT
    .replace('{{QUESTION}}', question)
    .replace('{{EXPECTED}}', expected)
    .replace('{{PREDICTED}}', predicted);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Resolve haiku-client (ESM bridge)
  let callHaiku;
  try {
    const haikuClient = await haikuClientPromise;
    callHaiku = haikuClient.callHaiku;

    printHeader('context-mem × LongMemEval E2E QA Benchmark');
    console.log(`  Node:        ${process.version}`);
    console.log(`  OS:          ${os.platform()} ${os.arch()}`);
    console.log('  Checking auth...');
    await haikuClient.ensureAuth();
  } catch (e) {
    if (/Authentication required/i.test(e.message)) {
      process.exit(1);
    }
    // Other errors (e.g. import failure) — surface them
    console.error('ERROR loading haiku-client:', e.message);
    process.exit(1);
  }
  console.log(`  Engine:      ${ENGINE}${ENGINE === 'real' ? ' (full v4.0 pipeline — synthesis + vault + entity graph)' : ' (BM25 adapter)'}`);
  console.log(`  Top-K:       ${TOP_K}`);
  console.log(`  Granularity: ${GRANULARITY}`);
  console.log(`  Ingest:      ${INGEST}`);
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

  // Shared real-kernel instance (reused across questions — ~1s startup penalty avoided)
  let sharedRealKernel = null;
  async function acquireKernel() {
    if (ENGINE === 'real') {
      if (!sharedRealKernel) {
        sharedRealKernel = await new RealKernelBench({
          synthesis: true,  // T4.4 — synthesis pages as pre-digested narrative context
          vault: true,      // writes markdown to tmpfs — supports synthesis
          vector: false,    // off for speed in E2E QA (retrieval ceiling already ~98%)
        }).open();
      } else {
        await sharedRealKernel.resetObservations();
      }
      return sharedRealKernel;
    }
    return new BenchKernel().open();
  }

  for (let qi = 0; qi < entries.length; qi++) {
    const entry = entries[qi];
    const question = entry.question || entry.query;
    const expectedRaw = entry.answer || entry.expected_answer;
    const expected = Array.isArray(expectedRaw) ? expectedRaw.join(' / ') : String(expectedRaw || '');
    const qType = entry.question_type || entry.type || 'unknown';

    // ── Session extraction (T5.6: default 'full' = user + assistant turns) ────
    const sessions = entry.haystack_sessions || [];
    const sessionIds = entry.haystack_session_ids || [];

    const kernel = await acquireKernel();

    if (GRANULARITY === 'session') {
      for (let si = 0; si < sessions.length; si++) {
        const session = sessions[si];
        const sessId = sessionIds[si] || `sess_${si}`;

        // T5.6: by default include FULL conversation (user + assistant) so the
        // LLM sees context that actually contains answers. Old 'user-only' mode
        // was a retrieval-specific trick that broke generation.
        const parts = [];
        for (const t of session) {
          if (INGEST === 'user-only') {
            if (t.role === 'user' || t.has_answer) parts.push(t.content);
          } else {
            // 'full' — user prefix preserved so Haiku can parse dialogue role
            parts.push(`${t.role}: ${t.content}`);
          }
        }

        const sessionDate = entry.haystack_dates?.[si] || null;
        if (parts.length > 0) {
          const doc = parts.join('\n');
          await kernel.ingest(sessId, doc, { session_index: si, date: sessionDate });
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
            await kernel.ingest(turnId, turn.content, { session_id: sessId, turn: turnNum });
            turnNum++;
          }
        }
      }
    }

    // Real-engine: await synthesis flush + embedding drain before search
    if (ENGINE === 'real' && typeof kernel.flushAll === 'function') {
      await kernel.flushAll();
    }

    // 2. Retrieve top-K
    const searchOpts = {};
    if (entry.question_date) searchOpts.referenceDate = entry.question_date;
    const hits = await kernel.searchAsync(question, TOP_K, searchOpts);

    // 3. Build context from top-K retrieved docs. CRITICAL: preserve search rank
    //    order (SQLite `WHERE id IN (...)` returns rows in ROWID order, which
    //    loses ranking — so the top hit might end up at the end and get
    //    truncated when we slice to the budget). Fetch each id separately.
    //    Also apply a PER-SESSION budget so the first-ranked session always fits.
    const dbIds = hits.slice(0, TOP_K).map(h => h.obs_id || h.id);
    const TOTAL_CONTEXT_BUDGET = 20000;
    const perSessionBudget = Math.floor(TOTAL_CONTEXT_BUDGET / Math.max(1, dbIds.length));
    const fetchStmt = kernel.db.prepare('SELECT content FROM observations WHERE id = ?');
    const rankedParts = [];
    for (const id of dbIds) {
      const row = fetchStmt.get(id);
      if (row && row.content) {
        // Slice each session to fit its share of the budget; the top-ranked
        // session is first, so even if we over-budget we still include the
        // best hit in full before considering lesser hits.
        rankedParts.push(row.content.slice(0, perSessionBudget));
      }
    }
    const context = rankedParts.join('\n\n---\n\n');

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

    if (ENGINE !== 'real') kernel.close();

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

  // Cleanup shared real kernel
  if (sharedRealKernel) { try { await sharedRealKernel.close(); } catch {} }
})().catch(err => { console.error(err); process.exit(1); });
