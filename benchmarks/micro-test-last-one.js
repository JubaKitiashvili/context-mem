#!/usr/bin/env node
// Micro-test: the ONE remaining failure — "recommend show/movie"
// Test with expanded synonyms + vector + LLM
'use strict';

const fs = require('fs');
const { BenchKernel, llmRerank } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);
const entry = entries.find(e => e.question === 'Can you recommend a show or movie for me to watch tonight?');

console.log('Q:', entry.question);
console.log('Correct:', entry.answer_session_ids);

(async () => {
  // Run 5 times to check consistency
  let passes = 0;
  for (let run = 0; run < 5; run++) {
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

    // Hybrid search
    const searchResults = await kernel.hybridSearch(entry.question, 30);

    // Check if correct doc is even in hybrid top 30
    const correctInPool = entry.answer_session_ids.some(cid =>
      searchResults.some(r => kernel.resolveId(r.id) === cid)
    );
    const correctRank = searchResults.findIndex(r =>
      entry.answer_session_ids.includes(kernel.resolveId(r.id))
    );

    // LLM rerank
    const reranked = await llmRerank(kernel, entry.question, searchResults, 10, entry.question_date);
    const topIds = reranked.slice(0, 5).map(r => kernel.resolveId(r.id));
    const pass = entry.answer_session_ids.some(cid => topIds.includes(cid));

    if (pass) passes++;
    console.log(`  Run ${run + 1}: ${pass ? '✅' : '❌'} | correct in pool: ${correctInPool} (rank ${correctRank + 1}) | top5: ${topIds.slice(0, 3).join(', ')}`);

    kernel.close();
  }

  console.log(`\n  Consistency: ${passes}/5 passes`);
})().catch(e => { console.error(e); process.exit(1); });
