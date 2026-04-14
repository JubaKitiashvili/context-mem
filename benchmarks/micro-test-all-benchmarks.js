#!/usr/bin/env node
/**
 * Micro-test for LoCoMo, MemBench, ConvoMem using existing results.
 * Finds failing questions from last benchmark runs and tests:
 * 1. Hybrid → LLM judge strategy
 * 2. Checks if correct docs get into top-5
 *
 * Only ingests haystacks for the failing questions — fast, targeted.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BenchKernel } = require('./lib/kernel-adapter');

// ── LLM Judge ──────────────────────────────────────────────────────────────

async function llmJudge(query, candidates, topK = 5) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
  if (candidates.length === 0) return [];

  const numbered = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 800)}`).join('\n\n');
  const prompt = `You are ranking documents by relevance to a user query. Read all documents carefully and return a JSON array of the ${topK} most relevant indices, ordered most to least relevant. Pay attention to semantic meaning, not just keyword matching. Return ONLY the JSON array.

Query: "${query}"

Documents:
${numbered}

Return ONLY a JSON array of ${topK} indices, e.g. [3, 7, 1, 4, 9]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return null;
  return JSON.parse(match[0]).filter(i => typeof i === 'number' && i >= 0 && i < candidates.length);
}

// ── Temporal resolver (reused from LME test) ──────────────────────────────

function resolveTemporalRange(query, referenceDate) {
  if (!referenceDate) return null;
  const ref = new Date(referenceDate);
  const q = query.toLowerCase();
  const day = 86400000;
  const rangeAround = (targetDate, toleranceDays) => ({
    start: new Date(targetDate.getTime() - toleranceDays * day),
    end: new Date(targetDate.getTime() + toleranceDays * day),
  });

  let m = q.match(/(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * day), 1);
  }
  if (/couple\s+of?\s*days?\s+ago/.test(q)) return rangeAround(new Date(ref.getTime() - 2 * day), 2);
  m = q.match(/(\d+|a|an|one|two|three|four|five|six)\s+weeks?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * 7 * day), 3);
  }
  if (/\b(a\s+)?week\s+ago\b|\blast\s+week\b/.test(q)) return rangeAround(new Date(ref.getTime() - 7 * day), 2);
  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  m = q.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const targetDow = weekdays[m[1]];
    const refDow = ref.getDay();
    let daysBack = (refDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    return rangeAround(new Date(ref.getTime() - daysBack * day), 0);
  }
  if (/\byesterday\b/.test(q)) return rangeAround(new Date(ref.getTime() - day), 0);
  return null;
}

// ── LoCoMo ────────────────────────────────────────────────────────────────

async function testLoCoMo() {
  console.log('\n' + '═'.repeat(70));
  console.log('  LoCoMo Failure Analysis');
  console.log('═'.repeat(70));

  const resultsFile = 'benchmarks/results/locomo_session_top10_2026-04-10.json';
  const dataFile = '/tmp/locomo/data/locomo10.json';

  if (!fs.existsSync(resultsFile)) { console.log('  no results file'); return; }

  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const failures = results.details.filter(r => r.recall === 0);
  console.log(`  Total failures: ${failures.length}/${results.details.length}`);

  if (failures.length === 0) return;

  const conversations = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const convArray = Array.isArray(conversations) ? conversations : Object.values(conversations);

  let passed = 0;
  let skipped = 0;
  const llmCosts = [];

  // Sample: test first 15 failures (enough to validate pattern)
  const sample = failures.slice(0, 15);

  for (let fi = 0; fi < sample.length; fi++) {
    const fail = sample[fi];
    const conv = convArray[fail.conversation];
    if (!conv) { skipped++; continue; }

    // Build session content map from conversation
    const sessionContentMap = new Map();
    const sessionDateMap = new Map();
    const conversation = conv.conversation || conv;
    const speakerA = conversation.speaker_a || 'user_a';
    const speakerB = conversation.speaker_b || 'user_b';

    let sessIdx = 0;
    while (conversation[`session_${sessIdx + 1}`]) {
      const sessKey = `session_${sessIdx + 1}`;
      const sessDateKey = `session_${sessIdx + 1}_date_time`;
      const turns = conversation[sessKey];
      const dateStr = conversation[sessDateKey];
      const sessId = `sess_${sessIdx + 1}`;

      const parts = [];
      for (const turn of turns) {
        parts.push(`${turn.speaker}: ${turn.text || ''}`);
      }
      sessionContentMap.set(sessId, parts.join('\n'));
      sessionDateMap.set(sessId, dateStr ? new Date(dateStr) : null);
      sessIdx++;
    }

    // Ingest into fresh kernel
    const kernel = new BenchKernel({ vector: true }).open();
    for (const [sid, content] of sessionContentMap) {
      kernel.ingest(sid, content, {});
    }
    await kernel.embedAll();

    // Hybrid search — top 30
    const results = await kernel.hybridSearch(fail.question, 30);

    // Build candidates
    const candidates = results.map(r => ({
      id: kernel.resolveId(r.id),
      content: sessionContentMap.get(kernel.resolveId(r.id)) || '',
    }));

    // LLM judge
    const start = Date.now();
    const llmPicks = await llmJudge(fail.question, candidates, 5);
    const elapsed = Date.now() - start;
    llmCosts.push(elapsed);

    if (!llmPicks) { kernel.close(); skipped++; continue; }

    const topIds = llmPicks.map(i => candidates[i].id);
    const correctInTop = fail.correct.some(cid => topIds.includes(cid));

    if (correctInTop) passed++;
    console.log(`  [${fi + 1}/${sample.length}] ${correctInTop ? '✅' : '❌'} "${fail.question.slice(0, 60)}..." (${elapsed}ms)`);

    kernel.close();
  }

  const avgLatency = llmCosts.length > 0 ? llmCosts.reduce((a, b) => a + b, 0) / llmCosts.length : 0;
  console.log(`\n  Results: ${passed}/${sample.length - skipped} passed (avg LLM latency: ${avgLatency.toFixed(0)}ms)`);
}

// ── MemBench ──────────────────────────────────────────────────────────────

async function testMemBench() {
  console.log('\n' + '═'.repeat(70));
  console.log('  MemBench Failure Analysis');
  console.log('═'.repeat(70));

  const resultsFile = 'benchmarks/results/membench_hybrid_top5_2026-04-10.json';
  if (!fs.existsSync(resultsFile)) { console.log('  no results file'); return; }

  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const failures = results.details.filter(r => r.hit === false);
  console.log(`  Total failures: ${failures.length}/${results.details.length}`);

  if (failures.length === 0) return;

  // MemBench has 500 items, each failure has category/topic/question/ground_truth/target_sids/retrieved_sids
  // We need the original corpus data to re-ingest
  // For now, just show the failures
  console.log('\n  Sample failures:');
  failures.slice(0, 5).forEach((f, i) => {
    console.log(`    [${i + 1}] ${f.category}/${f.topic}: ${f.question}`);
    console.log(`        Expected: ${JSON.stringify(f.target_sids)} | Retrieved: ${JSON.stringify(f.retrieved_sids.slice(0, 5))}`);
  });

  console.log('\n  ⚠️  Full MemBench test requires corpus re-ingestion. Failures show pattern only.');
}

// ── ConvoMem ──────────────────────────────────────────────────────────────

async function testConvoMem() {
  console.log('\n' + '═'.repeat(70));
  console.log('  ConvoMem Failure Analysis');
  console.log('═'.repeat(70));

  const resultsFile = 'benchmarks/results/convomem_top10_2026-04-10.json';
  if (!fs.existsSync(resultsFile)) { console.log('  no results file'); return; }

  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const failures = results.details.filter(r => r.recall < 1.0);
  console.log(`  Total failures: ${failures.length}/${results.details.length}`);

  if (failures.length === 0) return;

  console.log('\n  Sample failures:');
  failures.slice(0, 5).forEach((f, i) => {
    console.log(`    [${i + 1}] (${f.category}) ${f.question.slice(0, 80)}`);
    console.log(`        Recall: ${f.recall} | Found: ${f.found}/${f.evidence_count}`);
  });

  console.log('\n  ⚠️  Full ConvoMem test requires corpus re-ingestion. Failures show pattern only.');
}

(async () => {
  await testLoCoMo();
  await testMemBench();
  await testConvoMem();
})().catch(e => { console.error(e); process.exit(1); });
