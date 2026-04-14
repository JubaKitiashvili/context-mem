#!/usr/bin/env node
// Try different prompts to find one that recognizes stand-up comedy as movie/show preference
const fs = require('fs');
const { BenchKernel } = require('./lib/kernel-adapter');

const data = JSON.parse(fs.readFileSync('/tmp/longmemeval-data/longmemeval_s_cleaned.json', 'utf8'));
const entries = Array.isArray(data) ? data : Object.values(data);
const entry = entries.find(e => e.question === 'Can you recommend a show or movie for me to watch tonight?');

async function tryPrompt(name, makePrompt, candidates) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt = makePrompt(candidates);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  const dd = await res.json();
  const text = dd?.content?.[0]?.text || '';
  const match = text.match(/\{[^{}]+\}/);
  if (!match) {
    console.log(`${name}: FAILED to parse`, text.slice(0, 200));
    return;
  }
  const scores = JSON.parse(match[0]);
  const correct = candidates.find(c => c.isCorrect);
  const sortedEntries = Object.entries(scores).sort(([,a],[,b]) => b-a).slice(0, 5);
  const topIdxs = sortedEntries.map(([k]) => parseInt(k));
  const correctInTop5 = topIdxs.includes(correct.idx);
  const correctScore = scores[correct.idx] || 0;

  console.log(`\n=== ${name} ===`);
  console.log(`Correct doc score: ${correctScore} | Top 5 includes correct: ${correctInTop5 ? '✅' : '❌'}`);
  console.log('Top 5:');
  sortedEntries.forEach(([idx, s]) => {
    const c = candidates[parseInt(idx)];
    console.log(`  [${idx}] ${s} ${c.isCorrect ? '⭐' : ''} "${c.content.slice(0, 70)}"`);
  });
}

(async () => {
  const kernel = new BenchKernel({ vector: true }).open();
  for (let si = 0; si < entry.haystack_sessions.length; si++) {
    const session = entry.haystack_sessions[si];
    const sessId = entry.haystack_session_ids[si] || `sess_${si}`;
    const parts = [];
    for (const t of session) {
      if (t.role === 'user') parts.push(t.content);
      else if (t.has_answer) parts.push(t.content);
    }
    if (parts.length > 0) kernel.ingest(sessId, parts.join('\n'), { date: entry.haystack_dates?.[si] });
  }
  await kernel.embedAll();

  const results = await kernel.hybridSearch(entry.question, 30);
  const ids = results.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = kernel.db.prepare(`SELECT id, content FROM observations WHERE id IN (${placeholders})`).all(...ids);
  const contentMap = new Map(rows.map(r => [r.id, r.content]));

  const candidates = results.map((r, i) => ({
    idx: i,
    id: r.id,
    isCorrect: entry.answer_session_ids.includes(kernel.resolveId(r.id)),
    content: contentMap.get(r.id) || '',
  }));

  const correct = candidates.find(c => c.isCorrect);
  console.log(`Total candidates: ${candidates.length}, correct at idx ${correct.idx}`);

  // Prompt 1: Explicit preference inference
  await tryPrompt('v1: preference-focused', (cs) => {
    const numbered = cs.map(c => `[${c.idx}] ${c.content.slice(0, 1500)}`).join('\n\n');
    return `A user is asking: "${entry.question}"

To answer this question well, you need to find past sessions where the user expressed preferences about ENTERTAINMENT CONTENT: movies, TV shows, streaming services, stand-up comedy specials, documentaries, actors, directors, genres, or any video/streaming content they've liked or discussed.

Even if a session is about "learning comedy craft" or "discussing a specific special" — if it mentions specific shows or actors the user enjoyed, it reveals entertainment preferences.

Score each session from 0-10 based on how much it reveals the user's entertainment/movie/show preferences.

${numbered}

Return ONLY JSON: {"0": score, "1": score, ...}`;
  }, candidates);

  // Prompt 2: Chain-of-thought
  await tryPrompt('v2: think first', (cs) => {
    const numbered = cs.map(c => `[${c.idx}] ${c.content.slice(0, 1500)}`).join('\n\n');
    return `Question: "${entry.question}"

To answer this question, you need to find sessions mentioning the user's preferences for shows, movies, actors, comedy, drama, streaming platforms, or specific titles they've enjoyed.

IMPORTANT: Sessions where the user asks about specific comedy specials, actors, genres, or mentions titles they like (even if about "learning craft") are HIGHLY relevant because they reveal preferences.

Score each session 0-10:

${numbered}

Return ONLY JSON object.`;
  }, candidates);

  // Prompt 3: Direct question answering
  await tryPrompt('v3: direct answer', (cs) => {
    const numbered = cs.map(c => `[${c.idx}] ${c.content.slice(0, 1500)}`).join('\n\n');
    return `Given these sessions, which ones contain ANY information about the user's taste in shows/movies/TV/comedy/streaming content?

Sessions:
${numbered}

Question we're trying to answer: "${entry.question}"

Rate each session 0-10 based on whether it contains preference hints (specific titles mentioned, genres discussed, streaming services, actors liked, shows watched). Give 10 if it directly mentions a show/movie/comedy special, 5 if it's indirect, 0 if unrelated.

Return ONLY JSON like {"0": 10, "1": 3, ...}`;
  }, candidates);

  kernel.close();
})().catch(e => { console.error(e); process.exit(1); });
