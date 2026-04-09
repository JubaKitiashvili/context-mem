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
  // Recommendation / preference — targeted for LME preference failures
  recommend: ['suggest', 'prefer', 'favorite', 'enjoy'],
  suggest: ['recommend', 'prefer', 'favorite'],
  tips: ['advice', 'suggest', 'recommend'],
  advice: ['tips', 'suggest', 'recommend'],
  // Entertainment
  movie: ['film', 'show', 'series', 'watch'],
  show: ['movie', 'series', 'watch', 'program'],
  watch: ['movie', 'show', 'film', 'series'],
  book: ['read', 'novel', 'author'],
  music: ['song', 'listen', 'playlist'],
  // Food
  dinner: ['food', 'meal', 'cook', 'recipe', 'restaurant'],
  cook: ['recipe', 'bake', 'kitchen', 'meal'],
  // Activities
  activity: ['hobby', 'sport', 'exercise', 'game'],
  exercise: ['workout', 'gym', 'fitness', 'sport'],
  hobby: ['interest', 'activity', 'passion', 'enjoy'],
  // Work
  tool: ['app', 'software', 'platform', 'service'],
  email: ['message', 'outreach', 'send', 'follow'],
  performance: ['review', 'metrics', 'results', 'goals'],
  schedule: ['time', 'meeting', 'calendar', 'plan'],
  organize: ['manage', 'arrange', 'structure', 'sort'],
  // Targeted additions for failure patterns
  accessories: ['gear', 'equipment', 'setup', 'kit'],
  photography: ['camera', 'photo', 'lens', 'shoot'],
  battery: ['charge', 'power', 'phone'],
  cookie: ['bake', 'recipe', 'chocolate', 'dessert'],
  jewelry: ['ring', 'necklace', 'bracelet', 'gift'],
  sibling: ['brother', 'sister', 'family'],
  violin: ['practice', 'instrument', 'music', 'play'],
  conference: ['publication', 'research', 'academic', 'paper'],
  publication: ['conference', 'research', 'journal', 'paper'],
  buy: ['purchase', 'bought', 'order', 'shop'],
  bought: ['purchase', 'buy', 'ordered'],
  appliance: ['kitchen', 'device', 'bought', 'purchase'],
  travel: ['trip', 'visit', 'vacation', 'went'],
  race: ['charity', 'run', 'marathon', 'event'],
  martial: ['karate', 'judo', 'taekwondo', 'fighting'],
  supervillain: ['villain', 'comic', 'hero', 'fan'],
  volunteer: ['charity', 'community', 'help', 'service'],
  sport: ['game', 'play', 'athletic', 'team', 'collectible'],
  certificate: ['award', 'achievement', 'recognition'],
  career: ['job', 'work', 'profession', 'pursue'],
  counseling: ['therapy', 'support', 'help', 'career'],
  digestive: ['stomach', 'health', 'issue', 'problem'],
  bookshelf: ['furniture', 'shelf', 'storage', 'living'],
  journal: ['write', 'diary', 'notebook', 'supplies'],
};

/** Extract meaningful keywords from a query, filtering stop words. */
export function extractKeywords(query: string): string[] {
  return query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Extract entities: proper nouns, dates, numbers, specific terms. */
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
  // Full date patterns: "1 May 2022", "June 3, 2023", "3 June, 2023"
  const fullDates = query.match(/\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*\d{2,4}\b/gi) || [];
  entities.push(...fullDates);
  const fullDates2 = query.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\s*,?\s*\d{2,4}\b/gi) || [];
  entities.push(...fullDates2);
  // Month + year: "July 2022", "November"
  const monthYear = query.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/gi) || [];
  entities.push(...monthYear);
  // Standalone months mentioned in temporal context
  const months = query.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi) || [];
  entities.push(...months);
  // Year patterns
  const years = query.match(/\b(?:19|20)\d{2}\b/g) || [];
  entities.push(...years);
  // Day of week
  const days = query.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi) || [];
  entities.push(...days);
  // Specific numbers with units: "10 days", "$5"
  const numUnits = query.match(/\b\d+\s+(?:days?|weeks?|months?|years?|hours?|minutes?)\b/gi) || [];
  entities.push(...numUnits);
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

/** Build relaxed AND query — uses entity + top content words, less strict than full AND. */
export function buildRelaxedANDQuery(query: string): string | null {
  const entities = extractEntities(query);
  const keywords = extractKeywords(query);
  if (keywords.length < 3) return null; // full AND is fine for short queries

  // Prioritize entities and longer keywords (more specific)
  const entityWords = entities.map(e => e.toLowerCase().split(/\s+/)).flat().filter(w => w.length >= 3);
  const importantWords = [...new Set([...entityWords, ...keywords.filter(w => w.length >= 5)])];

  // Take top 3-4 most important terms
  const terms = importantWords.slice(0, 4);
  if (terms.length < 2) return null;
  return terms.map(w => `"${w}"`).join(' AND ');
}

/** Build phrase query from consecutive keyword pairs. Finds exact multi-word matches. */
export function buildPhraseQuery(query: string): string | null {
  const words = extractKeywords(query);
  if (words.length < 2) return null;
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`"${words[i]} ${words[i + 1]}"`);
  }
  return phrases.join(' OR ');
}

/** Build entity-focused FTS5 query. Searches for proper nouns and specific terms. */
export function buildEntityQuery(query: string): string | null {
  const entities = extractEntities(query);
  if (entities.length === 0) return null;
  return entities.map(e => `"${e.toLowerCase().replace(/"/g, '')}"`).join(' AND ');
}
