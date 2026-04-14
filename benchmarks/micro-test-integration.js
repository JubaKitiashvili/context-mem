#!/usr/bin/env node
/**
 * Integration micro-test: verify that temporal filtering on actual LME data
 * pushes the 5 temporal failures into top-5.
 *
 * Strategy: Load the 5 failing questions from LME, ingest their haystacks into
 * a fresh BenchKernel, then search with AND without temporal filtering.
 * Compare ranks.
 */
'use strict';

const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const failures = JSON.parse(fs.readFileSync('./benchmarks/results/lme-failures.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);

// ─── Temporal resolver (same as micro-test-temporal.js) ──────────────────────

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

  if (/couple\s+of?\s*days?\s+ago/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 2 * day), 2, 'medium');
  }

  m = q.match(/(\d+|a|an|one|two|three|four|five|six)\s+weeks?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * 7 * day), 3, 'high');
  }

  if (/\b(a\s+)?week\s+ago\b|\blast\s+week\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 7 * day), 2, 'high');
  }

  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  m = q.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const targetDow = weekdays[m[1]];
    const refDow = ref.getDay();
    let daysBack = (refDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    return rangeAround(new Date(ref.getTime() - daysBack * day), 0, 'high');
  }

  if (/\byesterday\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - day), 0, 'high');
  }

  return null;
}

function parseLmeDate(dateStr) {
  const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
}

// Strip temporal words from query so BM25 focuses on content
function stripTemporal(query) {
  return query
    .replace(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\s+ago\b/gi, '')
    .replace(/couple\s+of?\s*days?\s+ago/gi, '')
    .replace(/\b(\d+|a|an|one|two|three|four|five|six)\s+weeks?\s+ago\b/gi, '')
    .replace(/\b(a\s+)?week\s+ago\b|\blast\s+week\b/gi, '')
    .replace(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, '')
    .replace(/\byesterday\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Only temporal failures ──────────────────────────────────────────────────

const temporalFailureIds = [6, 7, 8, 9, 10];
const temporalFailures = failures.failures
  .map((f, i) => ({ ...f, idx: i + 1 }))
  .filter(f => temporalFailureIds.includes(f.idx));

console.log('═'.repeat(70));
console.log('  INTEGRATION MICRO-TEST: Temporal Filter on Real LME Data');
console.log('═'.repeat(70));
console.log(`\n  Testing ${temporalFailures.length} temporal failures\n`);

let baselineWins = 0;
let fixedWins = 0;

for (const fail of temporalFailures) {
  const entry = entries.find(e => e.question === fail.question);
  if (!entry) {
    console.log(`  [${fail.idx}] SKIP — entry not found`);
    continue;
  }

  const qDate = parseLmeDate(entry.question_date);
  const range = resolveTemporalRange(fail.question, qDate);

  console.log(`\n[${fail.idx}] "${fail.question.slice(0, 60)}..."`);
  console.log(`    Correct session IDs: ${fail.correct.join(', ')}`);
  console.log(`    Baseline rank (from full benchmark): ${fail.diagnostics?.correct_doc_ranks?.map(r => '#' + r.rank).join(', ')}`);

  // Ingest haystack into fresh kernel
  const kernel = new BenchKernel({ vector: false }).open();
  const sessionDateMap = new Map();

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
    if (content) {
      kernel.ingest(sessId, content, { date: dateStr });
    }
  }

  // ─── Baseline search ────────
  const baseline = kernel.search(fail.question, 100);
  const baselineRanks = fail.correct.map(cid => {
    const idx = baseline.findIndex(r => kernel.resolveId(r.id) === cid);
    return { id: cid, rank: idx >= 0 ? idx + 1 : 'not found' };
  });
  const baselineBestRank = Math.min(...baselineRanks.map(r => typeof r.rank === 'number' ? r.rank : 999));
  const baselineR5 = baselineBestRank <= 5 ? 1 : 0;

  console.log(`    BASELINE: ranks ${baselineRanks.map(r => '#' + r.rank).join(', ')} | R@5=${baselineR5 ? 'PASS' : 'FAIL'}`);

  // ─── Fixed search: PRIMARY temporal filter, SECONDARY BM25 ────────
  const cleanQuery = stripTemporal(fail.question);

  let filtered;
  if (range) {
    // Step 1: Get ALL session IDs in the date range (primary filter)
    // Use resolveId to get original ID (not _dup variants)
    const inRangeIds = new Set(
      [...sessionDateMap.entries()]
        .filter(([id, d]) => d && d >= range.start && d <= range.end)
        .map(([id]) => id)
    );

    // Step 2: BM25 search across full corpus for ranking
    const widePool = kernel.search(cleanQuery, 300);

    // Step 3: Take BM25 matches whose ORIGINAL id is in range
    const bm25InRange = widePool.filter(r => {
      const origId = kernel.resolveId(r.id);
      return inRangeIds.has(origId);
    });

    // Step 4: If we're missing any in-range sessions from BM25, include them at the end
    const bm25OrigIds = new Set(bm25InRange.map(r => kernel.resolveId(r.id)));
    const missingInRange = [...inRangeIds].filter(id => !bm25OrigIds.has(id))
      .map(id => ({ id, score: 0 }));

    filtered = [...bm25InRange, ...missingInRange];
  } else {
    filtered = kernel.search(cleanQuery, 100);
  }

  const fixedRanks = fail.correct.map(cid => {
    const idx = filtered.findIndex(r => kernel.resolveId(r.id) === cid);
    return { id: cid, rank: idx >= 0 ? idx + 1 : 'not found' };
  });
  const fixedBestRank = Math.min(...fixedRanks.map(r => typeof r.rank === 'number' ? r.rank : 999));
  const fixedR5 = fixedBestRank <= 5 ? 1 : 0;

  console.log(`    FIXED:    ranks ${fixedRanks.map(r => '#' + r.rank).join(', ')} | R@5=${fixedR5 ? 'PASS' : 'FAIL'}`);
  console.log(`    Candidates after date filter: ${filtered.length}`);

  if (baselineR5) baselineWins++;
  if (fixedR5) fixedWins++;

  kernel.close();
}

console.log('\n' + '═'.repeat(70));
console.log(`  BASELINE: ${baselineWins}/${temporalFailures.length} passed`);
console.log(`  WITH TEMPORAL FIX: ${fixedWins}/${temporalFailures.length} passed`);
console.log('═'.repeat(70));

process.exit(fixedWins === temporalFailures.length ? 0 : 1);
