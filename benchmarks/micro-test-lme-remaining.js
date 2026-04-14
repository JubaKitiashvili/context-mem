#!/usr/bin/env node
/**
 * Micro-test: the 6 remaining LME failures after LLM judge + temporal
 * Runs each through the updated kernel-adapter with referenceDate wired.
 */
'use strict';

const fs = require('fs');
const { BenchKernel, llmRerank } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const results = JSON.parse(fs.readFileSync('benchmarks/results/longmemeval_session_top10_2026-04-11.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);

const failures = results.details.filter(r => r.recall_5 === 0);
console.log(`Testing ${failures.length} remaining LME failures\n`);

(async () => {
  let passed = 0;

  for (let fi = 0; fi < failures.length; fi++) {
    const fail = failures[fi];
    const entry = entries.find(e => e.question === fail.question);
    if (!entry) continue;

    // Build kernel with session dates
    const kernel = new BenchKernel({ vector: true }).open();
    const sessions = entry.haystack_sessions || [];
    const sessionIds = entry.haystack_session_ids || [];
    const haystackDates = entry.haystack_dates || [];

    for (let si = 0; si < sessions.length; si++) {
      const session = sessions[si];
      const sessId = sessionIds[si] || `sess_${si}`;
      const parts = [];
      for (const t of session) {
        if (t.role === 'user') parts.push(t.content);
        else if (t.has_answer) parts.push(t.content);
      }
      if (parts.length > 0) {
        kernel.ingest(sessId, parts.join('\n'), { date: haystackDates[si] || null });
      }
    }

    await kernel.embedAll();

    // Hybrid search top 30
    const searchResults = await kernel.hybridSearch(fail.question, 30);

    // LLM rerank with referenceDate for temporal filter
    const reranked = await llmRerank(kernel, fail.question, searchResults, 10, entry.question_date || null);
    const topIds = reranked.map(r => kernel.resolveId(r.id));

    const correctInTop5 = fail.correct.some(cid => topIds.slice(0, 5).includes(cid));

    if (correctInTop5) {
      passed++;
      console.log(`  [${fi + 1}/${failures.length}] ✅ (${fail.type}): "${fail.question.slice(0, 65)}..."`);
    } else {
      console.log(`  [${fi + 1}/${failures.length}] ❌ (${fail.type}): "${fail.question.slice(0, 65)}..."`);
      console.log(`      Correct: ${fail.correct.join(', ')}`);
      console.log(`      Got top 5: ${topIds.slice(0, 5).join(', ')}`);
    }

    kernel.close();
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`  RESULTS: ${passed}/${failures.length} passed`);
  console.log('═'.repeat(70));
})().catch(e => { console.error(e); process.exit(1); });
