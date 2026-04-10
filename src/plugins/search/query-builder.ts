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

/**
 * General-purpose synonym expansions for OR-mode query broadening.
 * Keep this focused on universally useful vocabulary — no benchmark-specific patches.
 * Benchmark-specific expansions go in benchmarks/lib/expansions.js.
 */
let _expansions: Record<string, string[]> = {
  // Recommendation / preference
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
  // Common relationships
  sibling: ['brother', 'sister', 'family'],
  // Commerce
  buy: ['purchase', 'bought', 'order', 'shop'],
  bought: ['purchase', 'buy', 'ordered'],
  travel: ['trip', 'visit', 'vacation', 'went'],
  // Person attributes (general vocabulary)
  hometown: ['city', 'town', 'lives', 'born', 'from', 'home'],
  location: ['city', 'town', 'place', 'address', 'lives'],
  education: ['degree', 'university', 'college', 'school', 'studied'],
  position: ['role', 'title', 'job', 'work', 'occupation'],
  workplace: ['company', 'office', 'employer', 'firm'],
  occupation: ['job', 'work', 'career', 'profession'],
  career: ['job', 'work', 'profession'],
  company: ['firm', 'business', 'organization', 'employer'],
};

/** Current active expansions (core + any injected extras). */
export const EXPANSIONS: Record<string, string[]> = _expansions;

/** Merge additional expansions into the active set. Used by benchmarks to add domain-specific synonyms. */
export function mergeExpansions(extra: Record<string, string[]>): void {
  for (const [key, values] of Object.entries(extra)) {
    if (_expansions[key]) {
      // Merge unique values
      const existing = new Set(_expansions[key]);
      for (const v of values) existing.add(v);
      _expansions[key] = [...existing];
    } else {
      _expansions[key] = [...values];
    }
  }
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Resolve relative temporal references to absolute date keywords.
 * E.g., "10 days ago" with referenceDate → ["march", "29", "2026"]
 */
export function resolveTemporalKeywords(query: string, referenceDate?: Date): string[] {
  if (!referenceDate) return [];
  const q = query.toLowerCase();
  const resolved: string[] = [];

  // "N days/weeks/months ago"
  const agoMatch = q.match(/(\d+)\s+(days?|weeks?|months?)\s+ago/);
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const d = new Date(referenceDate);
    if (unit.startsWith('day')) d.setDate(d.getDate() - n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
    resolved.push(MONTH_NAMES[d.getMonth()], String(d.getDate()), String(d.getFullYear()));
    resolved.push(MONTH_ABBR[d.getMonth()]);
  }

  // "last Saturday/Monday/etc."
  const lastDayMatch = q.match(/last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (lastDayMatch) {
    const targetDay = DAY_NAMES.indexOf(lastDayMatch[1]);
    const d = new Date(referenceDate);
    const currentDay = d.getDay();
    let diff = currentDay - targetDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() - diff);
    resolved.push(MONTH_NAMES[d.getMonth()], String(d.getDate()), String(d.getFullYear()));
  }

  // "a couple of days ago" = ~2 days
  if (q.includes('couple of days ago') || q.includes('couple days ago')) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 2);
    resolved.push(MONTH_NAMES[d.getMonth()], String(d.getDate()));
  }

  // "a week ago"
  if (q.match(/\ba\s+week\s+ago\b/)) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 7);
    resolved.push(MONTH_NAMES[d.getMonth()], String(d.getDate()));
  }

  // "four/three/two weeks ago" (word form)
  const wordWeeks = q.match(/\b(two|three|four|five|six|seven|eight)\s+weeks?\s+ago\b/);
  if (wordWeeks) {
    const map: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    const n = map[wordWeeks[1]] || 2;
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - n * 7);
    resolved.push(MONTH_NAMES[d.getMonth()], String(d.getDate()));
  }

  return resolved;
}

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
