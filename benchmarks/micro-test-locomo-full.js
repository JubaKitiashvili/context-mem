#!/usr/bin/env node
/**
 * Micro-test: LoCoMo 36 failures from full run
 * Tests the hybrid + LLM judge strategy on ALL 36 failing questions.
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const results = JSON.parse(fs.readFileSync('benchmarks/results/locomo_session_top10_2026-04-09.json', 'utf8'));
const conversations = JSON.parse(fs.readFileSync('/tmp/locomo/data/locomo10.json', 'utf8'));
const convArray = Array.isArray(conversations) ? conversations : Object.values(conversations);

const failures = results.details.filter(r => r.recall === 0);
console.log(`Total failures: ${failures.length}`);

async function llmJudge(query, candidates, topK = 5) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (candidates.length === 0) return [];
  const numbered = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 1000)}`).join('\n\n');
  const prompt = `You are ranking documents by relevance to a user query. Read all documents carefully and return a JSON array of the ${topK} most relevant indices, ordered most to least relevant. Pay close attention to semantic meaning, entities, dates, and context. Return ONLY the JSON array.

Query: "${query}"

Documents:
${numbered}

Return ONLY a JSON array of ${topK} indices.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return null;
  return JSON.parse(match[0]).filter(i => typeof i === 'number' && i >= 0 && i < candidates.length);
}

(async () => {
  console.log('═'.repeat(70));
  console.log('  MICRO-TEST: LoCoMo 36 Failures → Hybrid + LLM Judge');
  console.log('═'.repeat(70));

  let passed = 0;
  let retrievalMisses = 0;
  let rankMisses = 0;
  const byCategory = {};
  const llmLatencies = [];

  // Cache kernels by conversation index — reuse if possible
  const kernelCache = new Map();

  for (let fi = 0; fi < failures.length; fi++) {
    const fail = failures[fi];
    const convIdx = fail.conversation;

    // Build kernel for this conversation
    let kernel, sessionContentMap;
    if (kernelCache.has(convIdx)) {
      ({ kernel, sessionContentMap } = kernelCache.get(convIdx));
    } else {
      const conv = convArray[convIdx];
      if (!conv) continue;

      const conversation = conv.conversation || conv;
      sessionContentMap = new Map();

      let sessIdx = 0;
      while (conversation[`session_${sessIdx + 1}`]) {
        const sessKey = `session_${sessIdx + 1}`;
        const turns = conversation[sessKey];
        const sessId = `sess_${sessIdx + 1}`;

        const parts = [];
        for (const turn of turns) {
          parts.push(`${turn.speaker}: ${turn.text || ''}`);
        }
        sessionContentMap.set(sessId, parts.join('\n'));
        sessIdx++;
      }

      kernel = new BenchKernel({ vector: true }).open();
      for (const [sid, content] of sessionContentMap) {
        kernel.ingest(sid, content, {});
      }
      await kernel.embedAll();

      kernelCache.set(convIdx, { kernel, sessionContentMap });
    }

    // Hybrid search — top 30
    const searchResults = await kernel.hybridSearch(fail.question, 30);

    // Check if correct doc is in wide pool
    const correctInPool = fail.correct.filter(cid =>
      searchResults.some(r => kernel.resolveId(r.id) === cid)
    );
    if (correctInPool.length === 0) {
      retrievalMisses++;
      byCategory[fail.category] = byCategory[fail.category] || { pass: 0, fail: 0, retrievalMiss: 0 };
      byCategory[fail.category].retrievalMiss++;
      byCategory[fail.category].fail++;
      console.log(`  [${fi + 1}/${failures.length}] ⚠️  RETRIEVAL MISS (${fail.category}): "${fail.question.slice(0, 55)}..."`);
      continue;
    }
    rankMisses++;

    // Build candidates
    const candidates = searchResults.map(r => ({
      id: kernel.resolveId(r.id),
      content: sessionContentMap.get(kernel.resolveId(r.id)) || '',
    }));

    // LLM judge
    const start = Date.now();
    const llmPicks = await llmJudge(fail.question, candidates, 5);
    llmLatencies.push(Date.now() - start);

    if (!llmPicks) {
      console.log(`  [${fi + 1}/${failures.length}] ❌ LLM failed (${fail.category})`);
      continue;
    }

    const topIds = llmPicks.map(i => candidates[i].id);
    const correctInTop = fail.correct.some(cid => topIds.includes(cid));

    byCategory[fail.category] = byCategory[fail.category] || { pass: 0, fail: 0, retrievalMiss: 0 };
    if (correctInTop) {
      passed++;
      byCategory[fail.category].pass++;
      console.log(`  [${fi + 1}/${failures.length}] ✅ (${fail.category}): "${fail.question.slice(0, 55)}..."`);
    } else {
      byCategory[fail.category].fail++;
      console.log(`  [${fi + 1}/${failures.length}] ❌ (${fail.category}): "${fail.question.slice(0, 55)}..."`);
    }
  }

  // Clean up kernels
  for (const { kernel } of kernelCache.values()) {
    try { kernel.close(); } catch {}
  }

  const avgLatency = llmLatencies.length > 0 ? llmLatencies.reduce((a, b) => a + b, 0) / llmLatencies.length : 0;
  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${passed}/${failures.length} passed`);
  console.log(`  Retrieval misses: ${retrievalMisses} (correct doc NOT in top 30)`);
  console.log(`  Rank misses tested: ${rankMisses}`);
  console.log(`  Avg LLM latency: ${avgLatency.toFixed(0)}ms`);
  console.log(`\n  By category:`);
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(15)} pass=${stats.pass} fail=${stats.fail} retrieval_miss=${stats.retrievalMiss}`);
  }
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
