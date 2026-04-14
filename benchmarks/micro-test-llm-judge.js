#!/usr/bin/env node
/**
 * Micro-test #3: LLM judge on narrow date-filtered candidate sets.
 * For #8 (41 cands) and #10 (13 cands), ask Claude which doc is most relevant.
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const failures = JSON.parse(fs.readFileSync('./benchmarks/results/lme-failures.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);

// Temporal resolver (copied from previous test)
function resolveTemporalRange(query, referenceDate) {
  const ref = new Date(referenceDate);
  const q = query.toLowerCase();
  const day = 86400000;
  const rangeAround = (targetDate, toleranceDays, conf = 'high') => ({
    start: new Date(targetDate.getTime() - toleranceDays * day),
    end: new Date(targetDate.getTime() + toleranceDays * day),
    confidence: conf,
  });

  let m = q.match(/(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * day), 1, 'high');
  }
  if (/couple\s+of?\s*days?\s+ago/.test(q)) return rangeAround(new Date(ref.getTime() - 2 * day), 2, 'medium');
  m = q.match(/(\d+|a|an|one|two|three|four|five|six)\s+weeks?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * 7 * day), 3, 'high');
  }
  if (/\b(a\s+)?week\s+ago\b|\blast\s+week\b/.test(q)) return rangeAround(new Date(ref.getTime() - 7 * day), 2, 'high');
  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  m = q.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const targetDow = weekdays[m[1]];
    const refDow = ref.getDay();
    let daysBack = (refDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    return rangeAround(new Date(ref.getTime() - daysBack * day), 0, 'high');
  }
  if (/\byesterday\b/.test(q)) return rangeAround(new Date(ref.getTime() - day), 0, 'high');
  return null;
}

function parseLmeDate(dateStr) {
  const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
}

// Call Claude to pick top-K relevant docs from a small candidate pool
async function llmJudge(query, candidates, topK = 5) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');

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

  const dataResp = await res.json();
  const text = dataResp?.content?.[0]?.text || '';
  const match = text.match(/\[[\d\s,]+\]/);
  if (!match) return null;
  const indices = JSON.parse(match[0]);
  return indices.filter(i => typeof i === 'number' && i >= 0 && i < candidates.length);
}

// ─── Main test ───────────────────────────────────────────────────────────────

(async () => {
  const temporalFailureIds = [6, 7, 8, 9, 10];
  const temporalFailures = failures.failures
    .map((f, i) => ({ ...f, idx: i + 1 }))
    .filter(f => temporalFailureIds.includes(f.idx));

  console.log('═'.repeat(70));
  console.log('  MICRO-TEST: Temporal Filter + LLM Judge');
  console.log('═'.repeat(70));

  let passed = 0;

  for (const fail of temporalFailures) {
    const entry = entries.find(e => e.question === fail.question);
    if (!entry) continue;

    const qDate = parseLmeDate(entry.question_date);
    const range = resolveTemporalRange(fail.question, qDate);

    console.log(`\n[${fail.idx}] "${fail.question.slice(0, 60)}..."`);

    const kernel = new BenchKernel({ vector: false }).open();
    const sessionDateMap = new Map();
    const sessionContentMap = new Map();

    const sessions = entry.haystack_sessions || [];
    const sessionIds = entry.haystack_session_ids || [];
    const haystackDates = entry.haystack_dates || [];

    for (let si = 0; si < sessions.length; si++) {
      const session = sessions[si];
      const sessId = sessionIds[si] || `sess_${si}`;
      const dateStr = haystackDates[si];
      sessionDateMap.set(sessId, parseLmeDate(dateStr));

      const parts = [];
      for (const t of session) {
        if (t.role === 'user') parts.push(t.content);
      }
      const content = parts.join(' ');
      sessionContentMap.set(sessId, content);
      if (content) kernel.ingest(sessId, content, { date: dateStr });
    }

    // Get in-range candidates
    const inRangeIds = [...sessionDateMap.entries()]
      .filter(([id, d]) => d && d >= range.start && d <= range.end)
      .map(([id]) => id);

    console.log(`    Date range: ${range.start.toISOString().slice(0,10)} to ${range.end.toISOString().slice(0,10)}`);
    console.log(`    In-range candidates: ${inRangeIds.length}`);

    // Build candidate pool (limit to max 30 for LLM)
    const candidates = inRangeIds.slice(0, 30).map(id => ({
      id,
      content: sessionContentMap.get(id) || '',
    }));

    // Ask Claude
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
    console.log(`    Top IDs: ${topIds.slice(0, 5).join(', ')}`);

    const correctInTop = fail.correct.some(cid => topIds.includes(cid));
    const firstCorrect = fail.correct.find(cid => topIds.includes(cid));
    const pickRank = firstCorrect ? topIds.indexOf(firstCorrect) + 1 : 'not found';

    console.log(`    Correct IDs: ${fail.correct.join(', ')}`);
    console.log(`    Result: ${correctInTop ? '✅ PASS' : '❌ FAIL'} (rank: ${pickRank})`);

    if (correctInTop) passed++;

    kernel.close();
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`  FINAL: ${passed}/${temporalFailures.length} passed`);
  console.log('═'.repeat(70));

  process.exit(passed === temporalFailures.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
