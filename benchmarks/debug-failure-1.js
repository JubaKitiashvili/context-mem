#!/usr/bin/env node
// Debug #1 - "recommend show or movie"
const fs = require('fs');
const { BenchKernel, resolveTemporalRange } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);
const entry = entries.find(e => e.question === 'Can you recommend a show or movie for me to watch tonight?');

console.log('Q:', entry.question);
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

  const results = await kernel.hybridSearch(entry.question, 30);

  // Fetch content for each
  const ids = results.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = kernel.db.prepare(`SELECT id, content FROM observations WHERE id IN (${placeholders})`).all(...ids);
  const contentMap = new Map(rows.map(r => [r.id, r.content]));

  const candidates = results.map((r, i) => ({
    idx: i,
    id: r.id,
    origId: kernel.resolveId(r.id),
    score: r.score,
    isCorrect: entry.answer_session_ids.includes(kernel.resolveId(r.id)),
    content: contentMap.get(r.id) || '',
  }));

  console.log('\nCorrect doc in top 30?', candidates.some(c => c.isCorrect));
  const correct = candidates.find(c => c.isCorrect);
  if (correct) {
    console.log(`\nCorrect doc at index ${correct.idx}, score ${correct.score.toFixed(3)}`);
    console.log(`Content preview: ${correct.content.slice(0, 300)}`);
  }

  // Call LLM directly to see scores
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const numbered = candidates.slice(0, 30).map(c => `[${c.idx}] ${c.content.slice(0, 1500)}`).join('\n\n');
  const prompt = `You are helping retrieve past conversations that contain information to answer a question. Score each session from 0 to 10.

Consider indirect evidence. A question about "movie recommendations" is answered by sessions about the user's entertainment preferences, genres, streaming services, specific shows they've enjoyed.

Return ONLY a JSON object mapping each index to a score.

Question: "${entry.question}"

Sessions:
${numbered}

Return ONLY JSON like {"0": 8, "1": 3, ...}.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  const dd = await res.json();
  const text = dd?.content?.[0]?.text || '';
  console.log('\nLLM response (first 500 chars):', text.slice(0, 500));

  const match = text.match(/\{[^{}]+\}/);
  if (match) {
    const scores = JSON.parse(match[0]);
    console.log('\nLLM scores:');
    Object.entries(scores).sort(([,a],[,b]) => b-a).slice(0, 10).forEach(([idx, score]) => {
      const c = candidates[parseInt(idx)];
      if (!c) return;
      console.log(`  [${idx}] score=${score} ${c.isCorrect ? '⭐ CORRECT' : ''} "${c.content.slice(0, 80)}"`);
    });
    if (correct) {
      console.log(`\n⭐ Correct doc score: ${scores[correct.idx]}`);
    }
  }

  kernel.close();
})().catch(e => { console.error(e); process.exit(1); });
