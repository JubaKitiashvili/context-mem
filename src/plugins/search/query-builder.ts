/**
 * Multi-strategy FTS5 query builder.
 * Generates OR-mode, AND-mode, and entity-focused queries from natural language.
 */

const STOP_WORDS = new Set([
  'what', 'when', 'where', 'who', 'how', 'which', 'did', 'do', 'does',
  'was', 'were', 'have', 'has', 'had', 'is', 'are', 'the', 'a', 'an',
  'my', 'me', 'i', 'you', 'your', 'their', 'it', 'its', 'in', 'on',
  'at', 'to', 'for', 'of', 'with', 'by', 'from', 'ago', 'last', 'that',
  'this', 'there', 'about', 'get', 'got', 'can', 'will', 'would',
  'could', 'should', 'might', 'some', 'any', 'much', 'many', 'more',
  'been', 'being', 'also', 'just', 'than', 'then', 'very', 'too',
]);

const EXPANSIONS: Record<string, string[]> = {
  recommend: ['suggest', 'prefer', 'favorite', 'enjoy'],
  suggest: ['recommend', 'prefer', 'favorite'],
  movie: ['film', 'show', 'series', 'watch'],
  show: ['movie', 'series', 'watch', 'program'],
  dinner: ['food', 'meal', 'cook', 'recipe', 'restaurant'],
  activity: ['hobby', 'sport', 'exercise', 'game'],
  exercise: ['workout', 'gym', 'fitness', 'sport'],
  tool: ['app', 'software', 'platform', 'service'],
  email: ['message', 'outreach', 'send', 'follow'],
  performance: ['review', 'metrics', 'results', 'goals'],
  hobby: ['interest', 'activity', 'passion', 'enjoy'],
  schedule: ['time', 'meeting', 'calendar', 'plan'],
  organize: ['manage', 'arrange', 'structure', 'sort'],
};

/** Extract meaningful keywords from a query, filtering stop words. */
export function extractKeywords(query: string): string[] {
  return query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Extract entities: proper nouns, dates, numbers. */
export function extractEntities(query: string): string[] {
  const entities: string[] = [];
  // Proper nouns (capitalized words not at sentence start)
  const properNouns = query.match(/(?<=\s)[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || [];
  entities.push(...properNouns);
  // Also get first word if capitalized and not a stop word
  const firstWord = query.match(/^[A-Z][a-z]+/);
  if (firstWord && !STOP_WORDS.has(firstWord[0].toLowerCase())) {
    entities.push(firstWord[0]);
  }
  // Dates
  const dates = query.match(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*,?\s*\d{0,4}\b/gi) || [];
  entities.push(...dates);
  // Year patterns
  const years = query.match(/\b(?:19|20)\d{2}\b/g) || [];
  entities.push(...years);
  return entities.filter(e => e.length >= 2);
}

/** Build OR-joined FTS5 query with synonym expansion. Best for broad recall. */
export function buildORQuery(query: string): string | null {
  const words = extractKeywords(query);
  if (words.length === 0) return null;
  const expanded = new Set(words);
  for (const w of words) {
    if (Object.prototype.hasOwnProperty.call(EXPANSIONS, w)) {
      EXPANSIONS[w].forEach(s => expanded.add(s));
    }
  }
  return [...expanded].map(w => `"${w}"`).join(' OR ');
}

/** Build AND-joined FTS5 query. Best for precision when multiple terms matter. */
export function buildANDQuery(query: string): string | null {
  const words = extractKeywords(query);
  if (words.length < 2) return null;
  // Use top 8 keywords to avoid overly restrictive queries
  return words.slice(0, 8).map(w => `"${w}"`).join(' AND ');
}

/** Build entity-focused FTS5 query. Searches for proper nouns and specific terms. */
export function buildEntityQuery(query: string): string | null {
  const entities = extractEntities(query);
  if (entities.length === 0) return null;
  return entities.map(e => `"${e.toLowerCase().replace(/"/g, '')}"`).join(' AND ');
}
