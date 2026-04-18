/**
 * smoke-e2e-qa.mjs
 * ================
 * Smoke test for the haiku-client.mjs SDK auth path.
 * Runs 2 synthetic questions end-to-end: ingest → retrieve → answer → judge.
 *
 * Usage:
 *   node benchmarks/smoke-e2e-qa.mjs
 *
 * Expected output:
 *   Auth path: <claude-code OR api-key>
 *   [1/2] sky color → scored X (expected: blue)
 *   [2/2] spider legs → scored X (expected: eight)
 *   Accuracy: N/2
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { BenchKernel } = require('./lib/kernel-adapter.js');
const { callHaiku, ensureAuth } = await import('./lib/haiku-client.mjs');

// ── Synthetic dataset ─────────────────────────────────────────────────────────
const SMOKE_DATA = [
  {
    id: 'smoke-1',
    question: 'What color is the sky on a sunny day?',
    answer: 'blue',
    question_type: 'smoke',
    haystack_sessions: [{
      session_id: 's1',
      turns: [
        { role: 'user', content: 'I was looking up at the sky this afternoon.' },
        { role: 'assistant', content: 'The sky looks blue on a clear sunny day because of Rayleigh scattering.', has_answer: true },
      ],
    }],
  },
  {
    id: 'smoke-2',
    question: 'How many legs does a spider have?',
    answer: 'eight',
    question_type: 'smoke',
    haystack_sessions: [{
      session_id: 's2',
      turns: [
        { role: 'user', content: 'I saw a spider in the garden yesterday.' },
        { role: 'assistant', content: 'Spiders are arachnids with eight legs, unlike insects which have six.', has_answer: true },
      ],
    }],
  },
];

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildAnswerPrompt(question, context) {
  return `Answer this question using only the provided context. If the context does not contain the answer, say "I don't know."

Context:
${context}

Question: ${question}

Answer (concise, 1-3 sentences):`;
}

function buildJudgePrompt(question, expected, predicted) {
  return `You are a strict judge evaluating whether a predicted answer matches the expected answer.

Question: ${question}
Expected answer: ${expected}
Predicted answer: ${predicted}

Rules:
- Score 1 if the predicted answer correctly contains the key information from the expected answer.
- Score 0 if the predicted answer is wrong, incomplete on the key fact, or says "I don't know."
- Minor wording differences are fine — judge the semantic content.

Reply with exactly one line: SCORE: 1 or SCORE: 0`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('context-mem smoke test — SDK auth path');
console.log('─'.repeat(50));
console.log(`  Node: ${process.version}  OS: ${os.platform()} ${os.arch()}`);
console.log('  Checking auth...');

const startTime = Date.now();

try {
  await ensureAuth();
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}

let correct = 0;
const results = [];

for (let qi = 0; qi < SMOKE_DATA.length; qi++) {
  const entry = SMOKE_DATA[qi];
  const question = entry.question;
  const expected = entry.answer;

  // Ingest
  const kernel = new BenchKernel().open();
  for (const session of entry.haystack_sessions) {
    const parts = [];
    for (const t of session.turns) {
      if (t.role === 'user') parts.push(t.content);
      else if (t.has_answer) parts.push(t.content);
    }
    if (parts.length > 0) {
      kernel.ingest(session.session_id, parts.join('\n'));
    }
  }

  // Retrieve
  const hits = await kernel.searchAsync(question, 5, {});
  const contextIds = hits.slice(0, 5).map(h => h.id);
  let context = '';
  if (contextIds.length > 0) {
    const placeholders = contextIds.map(() => '?').join(',');
    const rows = kernel.db.prepare(
      `SELECT content FROM observations WHERE id IN (${placeholders})`
    ).all(...contextIds);
    context = rows.map(r => r.content).join('\n\n---\n\n');
  }

  // Generate answer
  let predicted = "I don't know.";
  if (context.length > 0) {
    try {
      predicted = await callHaiku(buildAnswerPrompt(question, context), 150);
    } catch (e) {
      predicted = '[ERROR: answer generation failed]';
    }
  }

  // Judge
  let score = 0;
  try {
    const judgment = await callHaiku(buildJudgePrompt(question, expected, predicted), 50);
    score = /SCORE:\s*1/i.test(judgment) ? 1 : 0;
  } catch (e) {
    score = 0;
  }

  correct += score;
  results.push({ id: entry.id, question, expected, predicted, score });

  console.log(`  [${qi + 1}/${SMOKE_DATA.length}] ${question.slice(0, 40).padEnd(42)} → score ${score}  (expected: "${expected}")`);
  console.log(`           predicted: "${predicted.slice(0, 80)}"`);

  kernel.close();
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('─'.repeat(50));
console.log(`  Accuracy: ${correct}/${SMOKE_DATA.length}  |  Wall time: ${elapsed}s`);
console.log(correct === SMOKE_DATA.length ? '  SMOKE PASS' : '  SMOKE PARTIAL (check predicted answers above)');
