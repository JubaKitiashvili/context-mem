/**
 * Query-aware snippet extraction for search results.
 * Finds the most relevant sentence/region in a text given a search query.
 */

export function extractBestSnippet(text: string, query: string, maxLen = 300): string {
  if (!text || text.length <= maxLen) return text || '';

  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) return text.slice(0, maxLen);

  // Split into sentences
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return text.slice(0, maxLen);

  let best = sentences[0];
  let bestScore = 0;

  for (const s of sentences) {
    const lower = s.toLowerCase();
    const score = queryTerms.filter(t => lower.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return best.trim().slice(0, maxLen);
}
