#!/usr/bin/env node
/**
 * Micro-test v2: LoCoMo failures with FULL-CONTEXT LLM judge.
 * Give Claude ALL sessions from the conversation, ask it to pick the relevant one.
 * No BM25 intermediate — just direct reasoning over the full conversation.
 */
'use strict';

const fs = require('fs');

const results = JSON.parse(fs.readFileSync('benchmarks/results/locomo_session_top10_2026-04-09.json', 'utf8'));
const conversations = JSON.parse(fs.readFileSync('/tmp/locomo/data/locomo10.json', 'utf8'));
const convArray = Array.isArray(conversations) ? conversations : Object.values(conversations);

const failures = results.details.filter(r => r.recall === 0);
console.log(`Total failures: ${failures.length}`);

async function llmReason(query, sessions, topK = 5) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const sessionList = sessions.map((s, i) => `[${i}] (${s.id})\n${s.content.slice(0, 2000)}`).join('\n\n');
  const prompt = `You are analyzing a conversation history to answer a question. Read ALL sessions carefully and identify which ones contain clues (even indirect ones) that would help answer the question. Consider preferences, past activities, expressed interests, and inferable traits.

Question: "${query}"

Conversation sessions:
${sessionList}

Return ONLY a JSON array of the ${topK} session indices most relevant to answering the question, ordered most to least useful. Include sessions even if they contain indirect clues, not just literal keyword matches.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return null;
  return JSON.parse(match[0]).filter(i => typeof i === 'number' && i >= 0 && i < sessions.length);
}

(async () => {
  console.log('═'.repeat(70));
  console.log('  LoCoMo Full-Context LLM Reasoning');
  console.log('═'.repeat(70));

  // Build session maps per conversation (cached)
  const convCache = new Map();
  for (let i = 0; i < convArray.length; i++) {
    const conv = convArray[i];
    const conversation = conv.conversation || conv;
    const sessions = [];
    let sessIdx = 0;
    while (conversation[`session_${sessIdx + 1}`]) {
      const turns = conversation[`session_${sessIdx + 1}`];
      const parts = turns.map(t => `${t.speaker}: ${t.text || ''}`).join('\n');
      sessions.push({ id: `sess_${sessIdx + 1}`, content: parts });
      sessIdx++;
    }
    convCache.set(i, sessions);
  }

  let passed = 0;
  const byCategory = {};
  const latencies = [];

  for (let fi = 0; fi < failures.length; fi++) {
    const fail = failures[fi];
    const sessions = convCache.get(fail.conversation);
    if (!sessions || sessions.length === 0) continue;

    const start = Date.now();
    const llmPicks = await llmReason(fail.question, sessions, 5);
    latencies.push(Date.now() - start);

    if (!llmPicks) {
      console.log(`  [${fi + 1}/${failures.length}] ❌ LLM failed`);
      continue;
    }

    const topIds = llmPicks.map(i => sessions[i].id);
    const correctInTop = fail.correct.some(cid => topIds.includes(cid));

    byCategory[fail.category] = byCategory[fail.category] || { pass: 0, fail: 0 };
    if (correctInTop) {
      passed++;
      byCategory[fail.category].pass++;
      console.log(`  [${fi + 1}/${failures.length}] ✅ (${fail.category}): "${fail.question.slice(0, 55)}..."`);
    } else {
      byCategory[fail.category].fail++;
      console.log(`  [${fi + 1}/${failures.length}] ❌ (${fail.category}): "${fail.question.slice(0, 55)}..."`);
    }
  }

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${passed}/${failures.length} passed`);
  console.log(`  Avg latency: ${avgLatency.toFixed(0)}ms`);
  console.log('  By category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(15)} ${stats.pass}/${stats.pass + stats.fail}`);
  }
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
