/**
 * Time-Travel Debugging — view and compare project state at any point in time.
 */
import type { StoragePlugin } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeSnapshot {
  target_date: number;
  target_date_iso: string;
  scope: string;
  observations: { total: number; by_type: Record<string, number> };
  knowledge: { total: number; by_category: Record<string, number> };
  events: { total: number; by_type: Record<string, number> };
}

export interface TimeDelta {
  target_date: number;
  target_date_iso: string;
  current_date: number;
  knowledge: { added: number; total_then: number; total_now: number };
  observations: { added: number; total_then: number; total_now: number };
  events: { between: number; total_then: number; total_now: number; types_between: Record<string, number> };
}

// ---------------------------------------------------------------------------
// TimeTraveler
// ---------------------------------------------------------------------------

export class TimeTraveler {
  constructor(private storage: StoragePlugin) {}

  /**
   * Parse a date string — supports ISO dates and relative expressions:
   *   "3 days ago", "2 hours ago", "last week", "yesterday", ISO 8601
   * Returns a unix timestamp (ms).
   */
  parseDate(input: string): number {
    const trimmed = input.trim().toLowerCase();

    // "yesterday"
    if (trimmed === 'yesterday') {
      return Date.now() - 24 * 60 * 60 * 1000;
    }

    // "last week"
    if (trimmed === 'last week') {
      return Date.now() - 7 * 24 * 60 * 60 * 1000;
    }

    // "last month"
    if (trimmed === 'last month') {
      return Date.now() - 30 * 24 * 60 * 60 * 1000;
    }

    // "N <unit> ago"
    const relativeMatch = trimmed.match(/^(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago$/);
    if (relativeMatch) {
      const count = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2];
      const multipliers: Record<string, number> = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
      };
      return Date.now() - count * multipliers[unit];
    }

    // ISO date or date-time
    const parsed = new Date(input.trim());
    if (!isNaN(parsed.getTime())) {
      return parsed.getTime();
    }

    throw new Error(`Cannot parse date: "${input}"`);
  }

  /**
   * Build a snapshot of the project state at `targetDate`.
   * Scope can be "knowledge", "observations", "events", or "all".
   */
  snapshot(targetDate: number, scope: string = 'all'): TimeSnapshot {
    const result: TimeSnapshot = {
      target_date: targetDate,
      target_date_iso: new Date(targetDate).toISOString(),
      scope,
      observations: { total: 0, by_type: {} },
      knowledge: { total: 0, by_category: {} },
      events: { total: 0, by_type: {} },
    };

    if (scope === 'all' || scope === 'observations') {
      const rows = this.storage.prepare(
        'SELECT type, COUNT(*) as cnt FROM observations WHERE indexed_at <= ? GROUP BY type',
      ).all(targetDate) as Array<{ type: string; cnt: number }>;
      for (const row of rows) {
        result.observations.by_type[row.type] = row.cnt;
        result.observations.total += row.cnt;
      }
    }

    if (scope === 'all' || scope === 'knowledge') {
      const rows = this.storage.prepare(
        'SELECT category, COUNT(*) as cnt FROM knowledge WHERE created_at <= ? GROUP BY category',
      ).all(targetDate) as Array<{ category: string; cnt: number }>;
      for (const row of rows) {
        result.knowledge.by_category[row.category] = row.cnt;
        result.knowledge.total += row.cnt;
      }
    }

    if (scope === 'all' || scope === 'events') {
      const rows = this.storage.prepare(
        'SELECT event_type, COUNT(*) as cnt FROM events WHERE timestamp <= ? GROUP BY event_type',
      ).all(targetDate) as Array<{ event_type: string; cnt: number }>;
      for (const row of rows) {
        result.events.by_type[row.event_type] = row.cnt;
        result.events.total += row.cnt;
      }
    }

    return result;
  }

  /**
   * Diff between two date strings — returns entry-level changes in knowledge,
   * observations by type, and events within the window.
   */
  diff(fromDate: string, toDate: string): {
    knowledge: {
      added: Array<{ id: string; title: string; category: string; created_at: number }>;
      archived: Array<{ id: string; title: string; category: string }>;
    };
    observations: {
      count: number;
      by_type: Record<string, number>;
    };
    events: Array<{ event_type: string; count: number }>;
  } {
    const from = this.parseDate(fromDate);
    const to = this.parseDate(toDate);

    // Knowledge added in range
    const added = this.storage.prepare(
      'SELECT id, title, category, created_at FROM knowledge WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 50',
    ).all(from, to) as Array<{ id: string; title: string; category: string; created_at: number }>;

    // Knowledge archived in period (approximation: archived=1 and last_accessed in range)
    const archived = this.storage.prepare(
      'SELECT id, title, category FROM knowledge WHERE archived = 1 AND last_accessed >= ? AND last_accessed <= ? LIMIT 50',
    ).all(from, to) as Array<{ id: string; title: string; category: string }>;

    // Observations summary
    const obsRows = this.storage.prepare(
      'SELECT type, COUNT(*) as cnt FROM observations WHERE indexed_at >= ? AND indexed_at <= ? GROUP BY type',
    ).all(from, to) as Array<{ type: string; cnt: number }>;

    const by_type: Record<string, number> = {};
    let obsCount = 0;
    for (const r of obsRows) {
      by_type[r.type] = r.cnt;
      obsCount += r.cnt;
    }

    // Events summary
    const eventRows = this.storage.prepare(
      'SELECT event_type, COUNT(*) as cnt FROM events WHERE timestamp >= ? AND timestamp <= ? GROUP BY event_type',
    ).all(from, to) as Array<{ event_type: string; cnt: number }>;

    return {
      knowledge: { added, archived },
      observations: { count: obsCount, by_type },
      events: eventRows.map(r => ({ event_type: r.event_type, count: r.cnt })),
    };
  }

  /**
   * Compare the project state at `targetDate` with the current state.
   * Returns deltas: knowledge added, observation delta, events between.
   */
  compare(targetDate: number): TimeDelta {
    const now = Date.now();

    // Observations
    const obsThen = (this.storage.prepare(
      'SELECT COUNT(*) as cnt FROM observations WHERE indexed_at <= ?',
    ).get(targetDate) as { cnt: number }).cnt;
    const obsNow = (this.storage.prepare(
      'SELECT COUNT(*) as cnt FROM observations',
    ).get() as { cnt: number }).cnt;

    // Knowledge
    const knThen = (this.storage.prepare(
      'SELECT COUNT(*) as cnt FROM knowledge WHERE created_at <= ?',
    ).get(targetDate) as { cnt: number }).cnt;
    const knNow = (this.storage.prepare(
      'SELECT COUNT(*) as cnt FROM knowledge',
    ).get() as { cnt: number }).cnt;

    // Events between targetDate and now
    const eventsBetween = this.storage.prepare(
      'SELECT event_type, COUNT(*) as cnt FROM events WHERE timestamp > ? AND timestamp <= ? GROUP BY event_type',
    ).all(targetDate, now) as Array<{ event_type: string; cnt: number }>;

    const eventsThen = (this.storage.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE timestamp <= ?',
    ).get(targetDate) as { cnt: number }).cnt;
    const eventsNow = (this.storage.prepare(
      'SELECT COUNT(*) as cnt FROM events',
    ).get() as { cnt: number }).cnt;

    const typesBetween: Record<string, number> = {};
    let totalBetween = 0;
    for (const row of eventsBetween) {
      typesBetween[row.event_type] = row.cnt;
      totalBetween += row.cnt;
    }

    return {
      target_date: targetDate,
      target_date_iso: new Date(targetDate).toISOString(),
      current_date: now,
      knowledge: { added: knNow - knThen, total_then: knThen, total_now: knNow },
      observations: { added: obsNow - obsThen, total_then: obsThen, total_now: obsNow },
      events: { between: totalBetween, total_then: eventsThen, total_now: eventsNow, types_between: typesBetween },
    };
  }
}
