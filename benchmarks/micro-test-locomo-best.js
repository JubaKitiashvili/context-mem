#!/usr/bin/env node
/**
 * Micro-test: BEST combo for LoCoMo
 * - Top 30 candidates (v1 params)
 * - 1000 chars per candidate (rich context)
 * - Rate limiting (2.5s between requests)
 * - Inference-focused prompt
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const results = JSON.parse(fs.readFileSync('benchmarks/results/locomo_session_top10_2026-04-09.json', 'utf8'));
const conversations = JSON.parse(fs.readFileSync('/tmp/locomo/data/locomo10.json', 'utf8'));
const convArray = Array.isArray(conversations) ? conversations : Object.values(conversations);

const failures = results.details.filter(r => r.recall === 0);

let lastRequest = 0;
async function rateLimit() {
  const elapsed = Date.now() - lastRequest;
  if (elapsed < 2500) await new Promise(r => setTimeout(r, 2500 - elapsed));
  lastRequest = Date.now();
}

async function llmJudge(query, candidates, topK = 5, retries = 3) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (candidates.length === 0) return [];

  // Top 20 candidates to keep under rate limit (~5K tokens per request)
  const trimmed = candidates.slice(0, 20);
  const numbered = trimmed.map((c, i) => `[${i}] ${c.content.slice(0, 800)}`).join('\n\n');

  const prompt = `Given a question, identify which conversation sessions contain information (direct or indirect) that helps answer it. For inference questions, look for hints about preferences, habits, past activities, or interests.

Question: "${query}"

Sessions:
${numbered}

Return ONLY a JSON array of the ${topK} most relevant session indices (0-${trimmed.length - 1}), ordered by relevance.`;

  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimit();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      if (data?.error?.type === 'rate_limit_error') {
        console.log(`    rate-limited, waiting 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      const text = data?.content?.[0]?.text || '';
      const match = text.match(/\[[\d\s,]+\]/);
      if (!match) return null;
      return JSON.parse(match[0]).filter(i => typeof i === 'number' && i >= 0 && i < trimmed.length);
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return null;
}

(async () => {
  console.log('═'.repeat(70));
  console.log('  LoCoMo BEST Combo: top-30 hybrid, 800 chars, inference prompt');
  console.log('═'.repeat(70));
  console.log(`  Total failures: ${failures.length}\n`);

  let passed = 0;
  let retrievalMisses = 0;
  let llmErrors = 0;
  const byCategory = {};
  const kernelCache = new Map();

  for (let fi = 0; fi < failures.length; fi++) {
    const fail = failures[fi];
    const convIdx = fail.conversation;

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
      kernelCache.set(convIdx, { kernel, sessionContentMap });
    }

    // Top 30 hybrid
    const searchResults = await kernel.hybridSearch(fail.question, 30);

    const correctInPool = fail.correct.some(cid =>
      searchResults.some(r => kernel.resolveId(r.id) === cid)
    );

    byCategory[fail.category] = byCategory[fail.category] || { pass: 0, fail: 0 };

    if (!correctInPool) {
      retrievalMisses++;
      byCategory[fail.category].fail++;
      console.log(`  [${fi + 1}/${failures.length}] ⚠️  RETRIEVAL (${fail.category}): "${fail.question.slice(0, 55)}..."`);
      continue;
    }

    const candidates = searchResults.map(r => ({
      id: kernel.resolveId(r.id),
      content: sessionContentMap.get(kernel.resolveId(r.id)) || '',
    }));

    const llmPicks = await llmJudge(fail.question, candidates, 5);
    if (!llmPicks) {
      llmErrors++;
      byCategory[fail.category].fail++;
      console.log(`  [${fi + 1}/${failures.length}] ⚠️  LLM ERROR (${fail.category})`);
      continue;
    }

    const topIds = llmPicks.map(i => candidates[i]?.id).filter(Boolean);
    const correctInTop = fail.correct.some(cid => topIds.includes(cid));

    if (correctInTop) {
      passed++;
      byCategory[fail.category].pass++;
      console.log(`  [${fi + 1}/${failures.length}] ✅ (${fail.category}): "${fail.question.slice(0, 55)}..."`);
    } else {
      byCategory[fail.category].fail++;
      console.log(`  [${fi + 1}/${failures.length}] ❌ (${fail.category}): "${fail.question.slice(0, 55)}..."`);
    }
  }

  for (const { kernel } of kernelCache.values()) {
    try { kernel.close(); } catch {}
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${passed}/${failures.length} passed (${(passed/failures.length*100).toFixed(1)}%)`);
  console.log(`  Retrieval misses: ${retrievalMisses}`);
  console.log(`  LLM errors: ${llmErrors}`);
  console.log('  By category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(15)} ${stats.pass}/${stats.pass + stats.fail}`);
  }
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
