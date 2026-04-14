#!/usr/bin/env node
/**
 * Micro-test #4: LLM judge on top-N BM25 candidates for non-temporal failures.
 * Tests #1-5: abstain, preferences, counting.
 *
 * Strategy: get top-30 from BM25, let Claude pick top-5 with full content.
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const failures = JSON.parse(fs.readFileSync('./benchmarks/results/lme-failures.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);

async function llmJudge(query, candidates, topK = 5) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const numbered = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 800)}`).join('\n\n');
  const prompt = `You are ranking documents by relevance to a user query. Read all documents carefully and return a JSON array of the ${topK} most relevant indices, ordered most to least relevant. Pay attention to semantic meaning, not just keyword matching. Consider context — a document about "stand-up comedy Netflix specials" is relevant to "recommend a show to watch". Return ONLY the JSON array.

Query: "${query}"

Documents:
${numbered}

Return ONLY a JSON array of ${topK} indices, e.g. [3, 7, 1, 4, 9]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
  });
  const dataResp = await res.json();
  const text = dataResp?.content?.[0]?.text || '';
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return null;
  return JSON.parse(match[0]).filter(i => typeof i === 'number' && i >= 0 && i < candidates.length);
}

(async () => {
  const nonTemporalIds = [1, 2, 3, 4, 5];
  const nonTemporalFailures = failures.failures
    .map((f, i) => ({ ...f, idx: i + 1 }))
    .filter(f => nonTemporalIds.includes(f.idx));

  console.log('═'.repeat(70));
  console.log('  MICRO-TEST: Non-temporal failures with LLM Judge');
  console.log('═'.repeat(70));

  let passed = 0;

  for (const fail of nonTemporalFailures) {
    const entry = entries.find(e => e.question === fail.question);
    if (!entry) continue;

    console.log(`\n[${fail.idx}] (${fail.type}) "${fail.question.slice(0, 60)}..."`);
    console.log(`    Answer: ${(entry.answer || '').slice(0, 100)}`);

    const kernel = new BenchKernel({ vector: true }).open();
    const sessionContentMap = new Map();

    const sessions = entry.haystack_sessions || [];
    const sessionIds = entry.haystack_session_ids || [];

    for (let si = 0; si < sessions.length; si++) {
      const session = sessions[si];
      const sessId = sessionIds[si] || `sess_${si}`;
      const parts = [];
      for (const t of session) {
        if (t.role === 'user') parts.push(t.content);
      }
      const content = parts.join(' ');
      sessionContentMap.set(sessId, content);
      if (content) kernel.ingest(sessId, content, {});
    }

    // Embed corpus for hybrid search
    await kernel.embedAll();
    // Get top 30 from hybrid (BM25 + vector)
    const bm25Results = await kernel.hybridSearch(fail.question, 30);
    console.log(`    Hybrid top-30 retrieved`);

    // Check where correct docs are in BM25 results
    const bm25CorrectRanks = fail.correct.map(cid => {
      const idx = bm25Results.findIndex(r => kernel.resolveId(r.id) === cid);
      return idx >= 0 ? idx + 1 : null;
    }).filter(r => r !== null);
    console.log(`    Correct doc ranks in BM25 top-30: ${bm25CorrectRanks.join(', ')}`);

    if (bm25CorrectRanks.length === 0) {
      console.log(`    ⚠️  Correct doc NOT in top 30 — cannot be recovered`);
      kernel.close();
      continue;
    }

    // Build candidates for LLM
    const candidates = bm25Results.map(r => ({
      id: kernel.resolveId(r.id),
      content: sessionContentMap.get(kernel.resolveId(r.id)) || '',
    }));

    const startTime = Date.now();
    const llmPicks = await llmJudge(fail.question, candidates, 5);
    const llmTime = Date.now() - startTime;

    if (!llmPicks) {
      console.log(`    ❌ LLM returned no result`);
      kernel.close();
      continue;
    }

    const topIds = llmPicks.map(i => candidates[i].id);
    console.log(`    LLM picks: ${llmPicks.join(', ')} (${llmTime}ms)`);

    const correctInTop = fail.correct.some(cid => topIds.includes(cid));
    const firstCorrect = fail.correct.find(cid => topIds.includes(cid));
    const pickRank = firstCorrect ? topIds.indexOf(firstCorrect) + 1 : 'not found';

    console.log(`    Correct IDs: ${fail.correct.join(', ')}`);
    console.log(`    Result: ${correctInTop ? '✅ PASS' : '❌ FAIL'} (rank: ${pickRank})`);

    if (correctInTop) passed++;
    kernel.close();
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`  FINAL: ${passed}/${nonTemporalFailures.length} passed`);
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
