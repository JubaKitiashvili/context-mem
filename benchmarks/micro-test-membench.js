#!/usr/bin/env node
/**
 * Micro-test: MemBench 18 failures with hybrid + LLM judge
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BenchKernel } = require('./lib/kernel-adapter');

const DATA_DIR = '/tmp/membench-data/MemData/FirstAgent';
const failures = JSON.parse(fs.readFileSync('benchmarks/results/membench-failures.json', 'utf8'));

console.log('═'.repeat(70));
console.log('  MICRO-TEST: MemBench 18 Failures → Hybrid + LLM Judge');
console.log('═'.repeat(70));

// Load items same way membench.js does
function loadItems() {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'simple.json'), 'utf8'));
  const items = [];
  for (const [topic, topicItems] of Object.entries(raw)) {
    for (const item of topicItems) {
      const turns = item.message_list || [];
      const qa = item.QA || {};
      if (!turns.length || !qa.question) continue;
      items.push({
        category: 'simple',
        topic,
        tid: item.tid || 0,
        turns,
        question: qa.question,
      });
    }
  }
  return items;
}

function turnText(turn) {
  const user = turn.user || turn.user_message || '';
  const asst = turn.assistant || turn.assistant_message || '';
  const time = turn.time || '';
  let text = `[User] ${user} [Assistant] ${asst}`;
  if (time) text = `[${time}] ` + text;
  return text;
}

async function llmJudge(query, candidates, topK = 5) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (candidates.length === 0) return [];
  const numbered = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 600)}`).join('\n\n');
  const prompt = `Rank documents by relevance to the query. Pay attention to entity relationships (my mother, my coworker, etc). Return ONLY a JSON array of the ${topK} most relevant indices.

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
  const items = loadItems();
  console.log(`  Loaded ${items.length} items from simple.json\n`);

  let passed = 0;
  const llmLatencies = [];

  for (let fi = 0; fi < failures.failures.length; fi++) {
    const fail = failures.failures[fi];

    // Find the item by question match
    const item = items.find(i => i.question === fail.question && i.topic === fail.topic);
    if (!item) {
      console.log(`  [${fi + 1}/18] ⚠️  SKIP: item not found for "${fail.question}"`);
      continue;
    }

    // Ingest this item's corpus
    const kernel = new BenchKernel({ vector: true }).open();
    let sessions = item.turns;
    if (sessions.length > 0 && !Array.isArray(sessions[0])) {
      sessions = [sessions];
    }

    const turnMap = new Map(); // docId → { sid, text }
    let globalIdx = 0;
    for (let si = 0; si < sessions.length; si++) {
      const session = sessions[si];
      if (!Array.isArray(session)) continue;
      for (let ti = 0; ti < session.length; ti++) {
        const turn = session[ti];
        if (typeof turn !== 'object') continue;
        const sid = turn.sid != null ? turn.sid : globalIdx;
        const text = turnText(turn);
        const docId = `t_${globalIdx}`;
        kernel.ingest(docId, text, {});
        turnMap.set(docId, { sid: Number(sid), text });
        globalIdx++;
      }
    }
    await kernel.embedAll();

    // Hybrid search top 50 (wider pool)
    const searchResults = await kernel.hybridSearch(fail.question, 50);

    const candidates = searchResults.map(r => {
      const origId = kernel.resolveId(r.id);
      const entry = turnMap.get(origId);
      return {
        id: origId,
        sid: entry?.sid ?? -1,
        content: entry?.text || '',
      };
    });

    // Check if correct sid is in pool
    const targetSids = fail.target_sids || [];
    const correctInPool = candidates.some(c => targetSids.includes(c.sid));
    if (!correctInPool) {
      console.log(`  [${fi + 1}/18] ⚠️  RETRIEVAL MISS: "${fail.question}"`);
      kernel.close();
      continue;
    }

    // LLM judge
    const start = Date.now();
    const llmPicks = await llmJudge(fail.question, candidates, 5);
    llmLatencies.push(Date.now() - start);

    if (!llmPicks) {
      console.log(`  [${fi + 1}/18] ❌ LLM failed`);
      kernel.close();
      continue;
    }

    const topSids = llmPicks.map(i => candidates[i].sid);
    const correctInTop = targetSids.some(sid => topSids.includes(sid));

    if (correctInTop) {
      passed++;
      console.log(`  [${fi + 1}/18] ✅ "${fail.question.slice(0, 60)}"`);
    } else {
      console.log(`  [${fi + 1}/18] ❌ "${fail.question.slice(0, 60)}" (top: ${topSids.join(',')}, want: ${targetSids.join(',')})`);
    }

    kernel.close();
  }

  const avgLatency = llmLatencies.length > 0 ? llmLatencies.reduce((a, b) => a + b, 0) / llmLatencies.length : 0;
  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${passed}/${failures.failures.length} passed`);
  console.log(`  Avg LLM latency: ${avgLatency.toFixed(0)}ms`);
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
