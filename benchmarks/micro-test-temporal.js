#!/usr/bin/env node
/**
 * Micro-test for temporal date resolution.
 * Tests the 5 temporal failures from LME in isolation.
 * NO core changes yet — just validates the approach works.
 */
'use strict';

const fs = require('fs');

// ─── Temporal resolver prototype ─────────────────────────────────────────────

/**
 * Resolve relative temporal expressions in a query to an absolute date range.
 * Returns { start: Date, end: Date, confidence: 'high'|'medium'|'low' } or null.
 */
function resolveTemporalRange(query, referenceDate) {
  const ref = new Date(referenceDate);
  const q = query.toLowerCase();
  const day = 86400000; // ms

  // Helper: create range around a target date
  const rangeAround = (targetDate, toleranceDays, conf = 'high') => ({
    start: new Date(targetDate.getTime() - toleranceDays * day),
    end: new Date(targetDate.getTime() + toleranceDays * day),
    confidence: conf,
  });

  // "N days ago" — exact to 1 day
  let m = q.match(/(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * day), 1, 'high');
  }

  // "couple of days ago" = 2 days ± 1
  if (/couple\s+of?\s*days?\s+ago/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 2 * day), 2, 'medium');
  }

  // "a few days ago" = 3 days ± 2
  if (/(a\s+)?few\s+days?\s+ago/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 3 * day), 2, 'medium');
  }

  // "N weeks ago"
  m = q.match(/(\d+|a|an|one|two|three|four|five|six)\s+weeks?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * 7 * day), 3, 'high');
  }

  // "a week ago" / "last week"
  if (/\b(a\s+)?week\s+ago\b|\blast\s+week\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 7 * day), 2, 'high');
  }

  // "N months ago"
  m = q.match(/(\d+|a|an|one|two|three|four|five|six)\s+months?\s+ago/);
  if (m) {
    const word2num = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = word2num[m[1]] ?? parseInt(m[1], 10);
    if (!isNaN(n)) return rangeAround(new Date(ref.getTime() - n * 30 * day), 5, 'medium');
  }

  // "last Saturday" / "last Monday" etc.
  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  m = q.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const targetDow = weekdays[m[1]];
    const refDow = ref.getDay();
    // Go back to the most recent past occurrence of that weekday
    let daysBack = (refDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7; // "last X" never means today
    return rangeAround(new Date(ref.getTime() - daysBack * day), 0, 'high');
  }

  // "yesterday"
  if (/\byesterday\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - day), 0, 'high');
  }

  // "X days/weeks/months before" — similar to "ago"
  // (skipping for now — not in our failure set)

  return null;
}

// ─── Test cases: the 5 temporal failures from LME ────────────────────────────

const testCases = [
  {
    id: 6,
    question: "I received a piece of jewelry last Saturday from whom?",
    questionDate: "2023/03/09 (Thu) 15:47",
    correctSessionDates: ["2023/03/04 (Sat) 16:45"],
    expectedMatch: true,
  },
  {
    id: 7,
    question: "What was the the life event of one of my relatives that I participated in a week ago?",
    questionDate: "2023/06/22 (Thu) 18:33",
    correctSessionDates: ["2023/05/06 (Sat) 18:10", "2023/06/15 (Thu) 10:02"],
    expectedMatch: true, // at least one should match (06/15)
  },
  {
    id: 8,
    question: "I mentioned cooking something for my friend a couple of days ago. What was it?",
    questionDate: "2022/04/12 (Tue) 22:57",
    correctSessionDates: ["2022/03/21 (Mon) 21:37", "2022/04/10 (Sun) 23:24"],
    expectedMatch: true, // 04/10 should match
  },
  {
    id: 9,
    question: "What was the significant buisiness milestone I mentioned four weeks ago?",
    questionDate: "2023/03/28 (Tue) 20:35",
    correctSessionDates: ["2023/02/10 (Fri) 02:03", "2023/03/01 (Wed) 02:43"],
    expectedMatch: true, // 03/01 = ~27 days back, should match with tolerance
  },
  {
    id: 10,
    question: "What kitchen appliance did I buy 10 days ago?",
    questionDate: "2023/03/25 (Sat) 18:26",
    correctSessionDates: ["2023/03/15 (Wed) 11:56"],
    expectedMatch: true,
  },
];

// Parse LME date format "YYYY/MM/DD (Day) HH:MM"
function parseLmeDate(dateStr) {
  const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
}

// ─── Run tests ───────────────────────────────────────────────────────────────

console.log('═'.repeat(70));
console.log('  MICRO-TEST: Temporal Date Resolution');
console.log('═'.repeat(70));

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const qDate = parseLmeDate(tc.questionDate);
  const range = resolveTemporalRange(tc.question, qDate);

  console.log(`\n[${tc.id}] "${tc.question.slice(0, 70)}..."`);
  console.log(`    Question date: ${tc.questionDate}`);

  if (!range) {
    console.log(`    ❌ FAIL: Could not resolve temporal expression`);
    failed++;
    continue;
  }

  const startStr = range.start.toISOString().slice(0, 10);
  const endStr = range.end.toISOString().slice(0, 10);
  console.log(`    Resolved range: ${startStr} to ${endStr} (confidence: ${range.confidence})`);

  // Check if any correct session date falls in the range
  const matches = tc.correctSessionDates.map(ds => {
    const sDate = parseLmeDate(ds);
    const inRange = sDate >= range.start && sDate <= range.end;
    return { date: ds, sDate, inRange };
  });

  const matchCount = matches.filter(m => m.inRange).length;
  const matchStr = matches.map(m => `${m.date.slice(0, 10)}:${m.inRange ? '✓' : '✗'}`).join(', ');
  console.log(`    Correct dates: ${matchStr}`);

  if (matchCount > 0) {
    console.log(`    ✅ PASS: ${matchCount}/${matches.length} correct sessions fall in resolved range`);
    passed++;
  } else {
    console.log(`    ❌ FAIL: No correct sessions fell in resolved range`);
    failed++;
  }
}

console.log('\n' + '═'.repeat(70));
console.log(`  Results: ${passed}/${testCases.length} passed, ${failed} failed`);
console.log('═'.repeat(70));

process.exit(failed > 0 ? 1 : 0);
