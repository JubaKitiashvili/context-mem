#!/usr/bin/env node
/**
 * Micro-test v3: LoCoMo failures with inference-focused LLM + rate limiting
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const results = JSON.parse(fs.readFileSync('benchmarks/results/locomo_session_top10_2026-04-09.json', 'utf8'));
const conversations = JSON.parse(fs.readFileSync('/tmp/locomo/data/locomo10.json', 'utf8'));
const convArray = Array.isArray(conversations) ? conversations : Object.values(conversations);

const failures = results.details.filter(r => r.recall === 0);

// Track rate limit
let lastRequestTime = 0;
const MIN_DELAY_MS = 2200; // ~27 requests/min

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function llmJudge(query, candidates, topK = 5, retries = 3) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (candidates.length === 0) return [];

  // Keep prompt small — top 15 candidates, 600 chars each = ~3K tokens
  const trimmed = candidates.slice(0, 15);
  const numbered = trimmed.map((c, i) => `[${i}] ${c.content.slice(0, 600)}`).join('\n\n');

  const prompt = `You are answering a question using a user's conversation history. Read each session and identify which ones contain ANY clues — even indirect ones — that would help answer the question. Think about user preferences, past activities, interests, hobbies, and inferable traits. Look beyond literal keyword matches.

Question: "${query}"

Sessions:
${numbered}

Which sessions contain the most useful information to answer this question? Return ONLY a JSON array of the ${topK} most useful session indices (0 to ${trimmed.length - 1}), ordered by usefulness.`;

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
        await new Promise(r => setTimeout(r, 20000));
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
  console.log('  LoCoMo Inference Test — Rate-Limited LLM Judge');
  console.log('═'.repeat(70));
  console.log(`  Total failures: ${failures.length}\n`);

  let passed = 0;
  const byCategory = {};
  const kernelCache = new Map();

  for (let fi = 0; fi < failures.length; fi++) {
    const fail = failures[fi];
    const convIdx = fail.conversation;

    // Build kernel (cached)
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

    // Hybrid top 15
    const searchResults = await kernel.hybridSearch(fail.question, 15);

    // Check pool
    const correctInPool = fail.correct.some(cid =>
      searchResults.some(r => kernel.resolveId(r.id) === cid)
    );

    if (!correctInPool) {
      // Try wider pool
      const widerResults = await kernel.hybridSearch(fail.question, 30);
      const correctInWider = fail.correct.some(cid =>
        widerResults.some(r => kernel.resolveId(r.id) === cid)
      );
      if (!correctInWider) {
        console.log(`  [${fi + 1}/${failures.length}] ⚠️  RETRIEVAL MISS (${fail.category})`);
        byCategory[fail.category] = byCategory[fail.category] || { pass: 0, fail: 0 };
        byCategory[fail.category].fail++;
        continue;
      }
    }

    const candidates = searchResults.slice(0, 15).map(r => ({
      id: kernel.resolveId(r.id),
      content: sessionContentMap.get(kernel.resolveId(r.id)) || '',
    }));

    try {
      const llmPicks = await llmJudge(fail.question, candidates, 5);
      byCategory[fail.category] = byCategory[fail.category] || { pass: 0, fail: 0 };

      if (!llmPicks) {
        console.log(`  [${fi + 1}/${failures.length}] ⚠️  LLM parse failed`);
        byCategory[fail.category].fail++;
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
    } catch (e) {
      console.log(`  [${fi + 1}/${failures.length}] ⚠️  Error: ${e.message}`);
    }
  }

  for (const { kernel } of kernelCache.values()) {
    try { kernel.close(); } catch {}
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${passed}/${failures.length} passed (${(passed/failures.length*100).toFixed(1)}%)`);
  console.log('  By category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(15)} ${stats.pass}/${stats.pass + stats.fail}`);
  }
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
