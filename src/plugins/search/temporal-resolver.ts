/**
 * Temporal expression resolver for search queries.
 *
 * Parses relative time expressions ("N days ago", "last Saturday", etc.)
 * into absolute date ranges that can be used to filter search candidates.
 *
 * Pure deterministic logic — no LLM calls.
 */

export interface TemporalRange {
  /** Start of range (inclusive) */
  start: Date;
  /** End of range (inclusive) */
  end: Date;
  /** Confidence level for the resolution */
  confidence: 'high' | 'medium' | 'low';
  /** The matched temporal expression */
  matched: string;
}

const DAY_MS = 86_400_000;

const WORD_TO_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function parseNum(token: string): number | null {
  const lower = token.toLowerCase();
  if (lower in WORD_TO_NUM) return WORD_TO_NUM[lower];
  const n = parseInt(lower, 10);
  return isNaN(n) ? null : n;
}

function rangeAround(targetDate: Date, toleranceDays: number, matched: string, confidence: TemporalRange['confidence']): TemporalRange {
  return {
    start: new Date(targetDate.getTime() - toleranceDays * DAY_MS),
    end: new Date(targetDate.getTime() + toleranceDays * DAY_MS),
    confidence,
    matched,
  };
}

/**
 * Resolve a relative temporal expression in a query to an absolute date range.
 * Returns null if no temporal expression is found.
 *
 * @param query The search query that may contain temporal expressions
 * @param referenceDate The anchor date (typically the query/session date)
 */
export function resolveTemporalRange(query: string, referenceDate: Date | string | number): TemporalRange | null {
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (isNaN(ref.getTime())) return null;
  const q = query.toLowerCase();

  // "N days ago" (digits or words) — exact to ±1 day
  let m = q.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+days?\s+ago\b/);
  if (m) {
    const n = parseNum(m[1]);
    if (n !== null) return rangeAround(new Date(ref.getTime() - n * DAY_MS), 1, m[0], 'high');
  }

  // "a couple of days ago" = 2 days ±2
  if (/\ba?\s*couple\s+of?\s*days?\s+ago\b/.test(q)) {
    const match = q.match(/\ba?\s*couple\s+of?\s*days?\s+ago\b/)![0];
    return rangeAround(new Date(ref.getTime() - 2 * DAY_MS), 2, match, 'medium');
  }

  // "a few days ago" = 3 days ±2
  if (/\b(a\s+)?few\s+days?\s+ago\b/.test(q)) {
    const match = q.match(/\b(a\s+)?few\s+days?\s+ago\b/)![0];
    return rangeAround(new Date(ref.getTime() - 3 * DAY_MS), 2, match, 'medium');
  }

  // "N weeks ago" — ±3 days tolerance
  m = q.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+weeks?\s+ago\b/);
  if (m) {
    const n = parseNum(m[1]);
    if (n !== null) return rangeAround(new Date(ref.getTime() - n * 7 * DAY_MS), 3, m[0], 'high');
  }

  // "last week" = any time in the previous 7 days — wider tolerance covers
  // the full Mon-Sun calendar week relative to the reference date
  m = q.match(/\blast\s+week\b/);
  if (m) return rangeAround(new Date(ref.getTime() - 7 * DAY_MS), 4, m[0], 'high');

  // "a week ago" = exactly 7 days ago (±2)
  m = q.match(/\b(a\s+)?week\s+ago\b/);
  if (m) return rangeAround(new Date(ref.getTime() - 7 * DAY_MS), 2, m[0], 'high');

  // "N months ago" — ±5 days tolerance
  m = q.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\s+ago\b/);
  if (m) {
    const n = parseNum(m[1]);
    if (n !== null) return rangeAround(new Date(ref.getTime() - n * 30 * DAY_MS), 5, m[0], 'medium');
  }

  // "last month" — ±5 days around 30 days back
  if (/\blast\s+month\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 30 * DAY_MS), 5, 'last month', 'medium');
  }

  // "last Saturday" / "last Monday" etc. — exact date
  m = q.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const targetDow = WEEKDAYS[m[1]];
    const refDow = ref.getDay();
    let daysBack = (refDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7; // "last X" never means today
    return rangeAround(new Date(ref.getTime() - daysBack * DAY_MS), 0, m[0], 'high');
  }

  // "yesterday" — exact
  if (/\byesterday\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - DAY_MS), 0, 'yesterday', 'high');
  }

  // "today" — exact
  if (/\btoday\b/.test(q)) {
    return rangeAround(new Date(ref.getTime()), 0, 'today', 'high');
  }

  return null;
}

/**
 * Strip temporal expressions from a query string so downstream BM25/vector
 * search focuses on the content keywords rather than date noise.
 *
 * Example: "jewelry from my aunt last Saturday" → "jewelry from my aunt"
 */
export function stripTemporalExpressions(query: string): string {
  return query
    .replace(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+days?\s+ago\b/gi, ' ')
    .replace(/\ba?\s*couple\s+of?\s*days?\s+ago\b/gi, ' ')
    .replace(/\b(a\s+)?few\s+days?\s+ago\b/gi, ' ')
    .replace(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+weeks?\s+ago\b/gi, ' ')
    .replace(/\b(a\s+)?week\s+ago\b|\blast\s+week\b/gi, ' ')
    .replace(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\s+ago\b/gi, ' ')
    .replace(/\blast\s+month\b/gi, ' ')
    .replace(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ')
    .replace(/\byesterday\b/gi, ' ')
    .replace(/\btoday\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check whether a date falls within a temporal range.
 */
export function inTemporalRange(date: Date | string | number, range: TemporalRange): boolean {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  return d >= range.start && d <= range.end;
}
