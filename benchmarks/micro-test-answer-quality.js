#!/usr/bin/env node
/**
 * CRITICAL TEST: Can Claude actually ANSWER LoCoMo inference questions?
 * If YES, the benchmark's "retrieval failure" is a labeling artifact, not a real gap.
 * We give Claude the top-20 sessions and ask it to ANSWER, then compare to ground truth.
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const results = JSON.parse(fs.readFileSync('benchmarks/results/locomo_session_top10_2026-04-09.json', 'utf8'));
const conversations = JSON.parse(fs.readFileSync('/tmp/locomo/data/locomo10.json', 'utf8'));
const convArray = Array.isArray(conversations) ? conversations : Object.values(conversations);

const failures = results.details.filter(r => r.recall === 0);

// Find ground-truth answers from the QA data
function findQA(convIdx, question) {
  const conv = convArray[convIdx];
  const qas = conv.qa || [];
  return qas.find(qa => qa.question === question);
}

let lastReq = 0;
async function rateLimit() {
  const elapsed = Date.now() - lastReq;
  if (elapsed < 2500) await new Promise(r => setTimeout(r, 2500 - elapsed));
  lastReq = Date.now();
}

async function llmAnswer(query, sessions) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const numbered = sessions.map((s, i) => `[Session ${i}]\n${s.content.slice(0, 800)}`).join('\n\n');
  const prompt = `Answer this question based on the conversation sessions below. Provide a short, direct answer.

Question: "${query}"

Sessions:
${numbered}

Answer (be concise, 1-2 sentences):`;

  await rateLimit();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data?.error) return { error: data.error.message };
  return { answer: data?.content?.[0]?.text || '' };
}

// Semantic answer match — fuzzy match normalized strings
function answersMatch(predicted, truth) {
  if (!predicted || !truth) return false;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const p = norm(predicted);
  const t = norm(truth);
  // Direct substring match either way
  if (p.includes(t) || t.includes(p)) return true;
  // Word overlap
  const pWords = new Set(p.split(' ').filter(w => w.length > 2));
  const tWords = new Set(t.split(' ').filter(w => w.length > 2));
  if (tWords.size === 0) return false;
  let overlap = 0;
  for (const w of tWords) if (pWords.has(w)) overlap++;
  return overlap / tWords.size >= 0.6;
}

(async () => {
  console.log('═'.repeat(70));
  console.log('  ANSWER QUALITY TEST: Can Claude answer LoCoMo failures?');
  console.log('═'.repeat(70));
  console.log(`  Total failures: ${failures.length}\n`);

  let answerCorrect = 0;
  let answerWrong = 0;
  let noGroundTruth = 0;
  const wrongExamples = [];
  const kernelCache = new Map();

  // Test first 20 failures to save time
  const sample = failures.slice(0, 20);

  for (let fi = 0; fi < sample.length; fi++) {
    const fail = sample[fi];
    const qa = findQA(fail.conversation, fail.question);
    if (!qa || !qa.answer) {
      noGroundTruth++;
      console.log(`  [${fi + 1}/${sample.length}] ⚠️  no ground truth`);
      continue;
    }

    // Get top 20 sessions from hybrid
    let kernel, sessionContentMap;
    if (kernelCache.has(fail.conversation)) {
      ({ kernel, sessionContentMap } = kernelCache.get(fail.conversation));
    } else {
      const conv = convArray[fail.conversation];
      const conversation = conv.conversation || conv;
      sessionContentMap = new Map();
      let sessIdx = 0;
      while (conversation[`session_${sessIdx + 1}`]) {
        const turns = conversation[`session_${sessIdx + 1}`];
        const parts = turns.map(t => `${t.speaker}: ${t.text || ''}`).join('\n');
        sessionContentMap.set(`sess_${sessIdx + 1}`, parts);
        sessIdx++;
      }
      kernel = new BenchKernel({ vector: true }).open();
      for (const [sid, content] of sessionContentMap) {
        kernel.ingest(sid, content, {});
      }
      await kernel.embedAll();
      kernelCache.set(fail.conversation, { kernel, sessionContentMap });
    }

    const searchResults = await kernel.hybridSearch(fail.question, 20);
    const sessions = searchResults.map(r => ({
      content: sessionContentMap.get(kernel.resolveId(r.id)) || '',
    }));

    const result = await llmAnswer(fail.question, sessions);
    if (result.error) {
      console.log(`  [${fi + 1}/${sample.length}] ⚠️  LLM error: ${result.error.slice(0, 60)}`);
      continue;
    }

    const match = answersMatch(result.answer, qa.answer);
    if (match) {
      answerCorrect++;
      console.log(`  [${fi + 1}/${sample.length}] ✅ Q: "${fail.question.slice(0, 50)}..."`);
      console.log(`       Truth: ${qa.answer.slice(0, 80)}`);
      console.log(`       Claude: ${result.answer.slice(0, 80)}`);
    } else {
      answerWrong++;
      wrongExamples.push({ q: fail.question, truth: qa.answer, claude: result.answer });
      console.log(`  [${fi + 1}/${sample.length}] ❌ Q: "${fail.question.slice(0, 50)}..."`);
      console.log(`       Truth: ${qa.answer.slice(0, 80)}`);
      console.log(`       Claude: ${result.answer.slice(0, 80)}`);
    }
  }

  for (const { kernel } of kernelCache.values()) {
    try { kernel.close(); } catch {}
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${answerCorrect}/${sample.length - noGroundTruth} Claude answered correctly`);
  console.log(`  (${(answerCorrect / (sample.length - noGroundTruth) * 100).toFixed(1)}% semantic match)`);
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
