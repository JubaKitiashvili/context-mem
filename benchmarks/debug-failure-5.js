#!/usr/bin/env node
// Debug why #5 fails — print candidates and LLM picks

const fs = require('fs');
const { BenchKernel, llmRerank, resolveTemporalRange } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);
const entry = entries.find(e => e.question === 'I mentioned cooking something for my friend a couple of days ago. What was it?');

console.log('Q:', entry.question);
console.log('Date:', entry.question_date);
console.log('Correct:', entry.answer_session_ids);

(async () => {
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

  const range = resolveTemporalRange(entry.question, entry.question_date);
  console.log('\nRange:', range.start.toISOString(), 'to', range.end.toISOString());

  // Get in-range IDs
  const inRangeRows = kernel.db.prepare(
    'SELECT id, indexed_at FROM observations WHERE indexed_at >= ? AND indexed_at <= ?'
  ).all(range.start.getTime(), range.end.getTime());
  console.log(`\nIn-range sessions: ${inRangeRows.length}`);
  inRangeRows.forEach(r => {
    const isCorrect = entry.answer_session_ids.some(cid => kernel.resolveId(r.id) === cid);
    console.log(`  ${kernel.resolveId(r.id)} at ${new Date(r.indexed_at).toISOString().slice(0,10)}${isCorrect ? ' ⭐ CORRECT' : ''}`);
  });

  // Hybrid search first
  const searchResults = await kernel.hybridSearch(entry.question, 30);
  console.log(`\nHybrid top-30 includes correct:`, searchResults.some(r => entry.answer_session_ids.includes(kernel.resolveId(r.id))));

  // Run LLM rerank
  const reranked = await llmRerank(kernel, entry.question, searchResults, 10, entry.question_date);
  console.log(`\nAfter LLM rerank, top 10:`);
  reranked.slice(0, 10).forEach((r, i) => {
    const origId = kernel.resolveId(r.id);
    const isCorrect = entry.answer_session_ids.includes(origId);
    console.log(`  ${i + 1}. ${origId}${isCorrect ? ' ⭐' : ''}`);
  });

  kernel.close();
})().catch(e => { console.error(e); process.exit(1); });
