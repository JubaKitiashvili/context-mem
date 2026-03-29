/**
 * Auto-generate titles and tags for knowledge entries using keyword extraction.
 * Zero LLM calls — deterministic TF-IDF-like scoring.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'was', 'one', 'our', 'out',
  'use', 'get', 'set', 'add', 'has', 'had', 'its', 'let', 'too', 'new', 'now', 'see', 'way',
  'may', 'who', 'did', 'got', 'try', 'run', 'will', 'been', 'have', 'from', 'this', 'that',
  'with', 'they', 'been', 'some', 'than', 'them', 'then', 'when', 'what', 'each', 'make',
  'like', 'just', 'over', 'such', 'also', 'into', 'most', 'only', 'very', 'after', 'should',
  'would', 'could', 'which', 'their', 'there', 'about', 'other', 'these', 'being', 'using',
]);

export function generateTitle(content: string, maxLength = 80): string {
  // Try first sentence
  const firstSentence = content.match(/^[^.!?\n]+[.!?]?/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= maxLength && firstSentence.length >= 10) {
    return firstSentence;
  }

  // Fall back to top keywords phrase
  const keywords = extractKeywords(content, 5);
  if (keywords.length > 0) {
    return keywords.join(' ').slice(0, maxLength);
  }

  // Last resort: truncate content
  return content.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
}

export function generateTags(content: string, maxTags = 5): string[] {
  return extractKeywords(content, maxTags);
}

function extractKeywords(text: string, count: number): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));

  // Word frequency
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Sort by frequency descending, then alphabetically for ties
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([word]) => word);
}
