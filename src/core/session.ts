import type { StoragePlugin, TokenEconomics } from './types.js';
import type { EventTracker } from './events.js';

const MAX_SNAPSHOT_BYTES = 2048;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day

export class SessionManager {
  constructor(
    private storage: StoragePlugin,
    private events?: EventTracker,
  ) {}

  saveSnapshot(sessionId: string, stats: TokenEconomics): void {
    const snapshot = this.buildSnapshot(sessionId, stats);
    let snapshotStr = JSON.stringify(snapshot);

    // If over budget, progressively trim content until it fits as valid JSON
    if (snapshotStr.length > MAX_SNAPSHOT_BYTES) {
      // Remove events first (lowest value), then errors, then decisions
      delete snapshot.events;
      snapshotStr = JSON.stringify(snapshot);
    }
    if (snapshotStr.length > MAX_SNAPSHOT_BYTES) {
      delete snapshot.errors;
      snapshotStr = JSON.stringify(snapshot);
    }
    if (snapshotStr.length > MAX_SNAPSHOT_BYTES) {
      // Trim decisions to first 2
      if (Array.isArray(snapshot.decisions)) {
        snapshot.decisions = (snapshot.decisions as string[]).slice(0, 2);
      }
      snapshotStr = JSON.stringify(snapshot);
    }

    this.storage.exec(
      'INSERT OR REPLACE INTO snapshots (session_id, snapshot, created_at) VALUES (?, ?, ?)',
      [sessionId, snapshotStr, Date.now()],
    );
  }

  restoreSnapshot(
    sessionId: string,
  ): { snapshot: Record<string, unknown>; condensed: boolean } | null {
    const row = this.storage
      .prepare('SELECT session_id, snapshot, created_at FROM snapshots WHERE session_id = ?')
      .get(sessionId) as
      | { session_id: string; snapshot: string; created_at: number }
      | undefined;

    if (!row) return null;

    const age = Date.now() - row.created_at;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.snapshot) as Record<string, unknown>;
    } catch {
      return null; // corrupted snapshot
    }

    if (age > STALE_THRESHOLD_MS) {
      return {
        snapshot: {
          task: data.task,
          decisions: data.decisions,
          stats: data.stats,
          condensed: true,
          original_session: sessionId,
        },
        condensed: true,
      };
    }

    return { snapshot: data, condensed: false };
  }

  private buildSnapshot(
    sessionId: string,
    stats: TokenEconomics,
  ): Record<string, unknown> {
    const decisions = this.storage
      .prepare(
        "SELECT summary FROM observations WHERE session_id = ? AND type = 'decision' ORDER BY indexed_at DESC LIMIT 5",
      )
      .all(sessionId) as Array<{ summary: string }>;

    const errors = this.storage
      .prepare(
        "SELECT summary FROM observations WHERE session_id = ? AND type = 'error' ORDER BY indexed_at DESC LIMIT 3",
      )
      .all(sessionId) as Array<{ summary: string }>;

    let recentEvents: Array<Record<string, unknown>> = [];
    if (this.events) {
      recentEvents = this.events
        .query(sessionId, { priority: 1, limit: 5 })
        .map((e) => ({
          type: e.event_type,
          data: e.data,
          time: e.timestamp,
        }));
    }

    return {
      session_id: sessionId,
      stats: {
        observations: stats.observations_stored,
        tokens_saved: stats.tokens_saved,
        savings_pct: stats.savings_percentage,
      },
      decisions: decisions.map((d) => d.summary),
      errors: errors.map((e) => e.summary),
      events: recentEvents,
      snapshot_at: Date.now(),
    };
  }
}
