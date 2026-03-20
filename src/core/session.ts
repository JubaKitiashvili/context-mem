import type { StoragePlugin, TokenEconomics } from './types.js';
import type { EventTracker } from './events.js';

const MAX_SNAPSHOT_BYTES = 2048;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day

// Budget allocation by priority tier
const P1_BUDGET_PCT = 0.50;
const P2_BUDGET_PCT = 0.35;
// P3 gets remaining 15%

type Priority = 1 | 2 | 3;

interface SessionCategory {
  name: string;
  priority: Priority;
  extract: (storage: StoragePlugin, sessionId: string, events?: EventTracker) => string | null;
}

const CATEGORIES: SessionCategory[] = [
  // P1 — Critical (50% budget)
  {
    name: 'files',
    priority: 1,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(`
        SELECT metadata FROM observations
        WHERE session_id = ? AND json_extract(metadata, '$.file_path') IS NOT NULL
        ORDER BY indexed_at DESC LIMIT 50
      `).all(sessionId) as Array<{ metadata: string }>;

      if (!rows.length) return null;

      const files = new Map<string, { reads: number; writes: number }>();
      for (const row of rows) {
        try {
          const meta = JSON.parse(row.metadata) as Record<string, unknown>;
          const fp = meta.file_path as string | undefined;
          if (!fp) continue;
          const entry = files.get(fp) || { reads: 0, writes: 0 };
          if (Array.isArray(meta.files_modified) && meta.files_modified.length > 0) {
            entry.writes++;
          } else {
            entry.reads++;
          }
          files.set(fp, entry);
        } catch {
          // skip malformed metadata
        }
      }

      if (!files.size) return null;
      return [...files.entries()].slice(0, 10)
        .map(([p, c]) => `- ${p} (read:${c.reads}, write:${c.writes})`)
        .join('\n');
    },
  },
  {
    name: 'tasks',
    priority: 1,
    extract: (_storage, sessionId, events) => {
      if (!events) return null;
      const starts = events.query(sessionId, { event_type: 'task_start', limit: 20 });
      const completes = new Set(
        events.query(sessionId, { event_type: 'task_complete', limit: 20 })
          .map(e => (e.data as Record<string, unknown>)?.task_id)
          .filter(Boolean),
      );
      const pending = starts.filter(e => !completes.has((e.data as Record<string, unknown>)?.task_id));
      if (!pending.length) return null;
      return pending.map(e => `- ${(e.data as Record<string, unknown>)?.description || e.event_type}`).join('\n');
    },
  },
  {
    name: 'rules',
    priority: 1,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(`
        SELECT DISTINCT json_extract(metadata, '$.file_path') as fp
        FROM observations
        WHERE session_id = ? AND (
          json_extract(metadata, '$.file_path') LIKE '%rules%'
          OR json_extract(metadata, '$.file_path') LIKE '%CLAUDE.md%'
          OR json_extract(metadata, '$.file_path') LIKE '%GEMINI.md%'
        )
        LIMIT 5
      `).all(sessionId) as Array<{ fp: string | null }>;
      if (!rows.length) return null;
      const lines = rows.map(r => r.fp).filter(Boolean);
      if (!lines.length) return null;
      return lines.map(fp => `- ${fp}`).join('\n');
    },
  },

  // P2 — Important (35% budget)
  {
    name: 'decisions',
    priority: 2,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(
        "SELECT summary FROM observations WHERE session_id = ? AND type = 'decision' ORDER BY indexed_at DESC LIMIT 5",
      ).all(sessionId) as Array<{ summary: string }>;
      if (!rows.length) return null;
      return rows.map(r => `- ${r.summary || '(no summary)'}`).join('\n');
    },
  },
  {
    name: 'errors',
    priority: 2,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(
        "SELECT summary FROM observations WHERE session_id = ? AND type = 'error' ORDER BY indexed_at DESC LIMIT 3",
      ).all(sessionId) as Array<{ summary: string }>;
      if (!rows.length) return null;
      return rows.map(r => `- ${r.summary || '(no summary)'}`).join('\n');
    },
  },
  {
    name: 'cwd',
    priority: 2,
    extract: (_storage, sessionId, events) => {
      if (!events) return null;
      const cwdEvents = events.query(sessionId, { event_type: 'cwd_change', limit: 1 });
      if (!cwdEvents.length) return null;
      return (cwdEvents[0].data as Record<string, unknown>)?.path as string || null;
    },
  },
  {
    name: 'git',
    priority: 2,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(
        "SELECT summary FROM observations WHERE session_id = ? AND type = 'commit' ORDER BY indexed_at DESC LIMIT 3",
      ).all(sessionId) as Array<{ summary: string }>;
      if (!rows.length) return null;
      return rows.map(r => `- ${r.summary || '(no summary)'}`).join('\n');
    },
  },
  {
    name: 'env',
    priority: 2,
    extract: (_storage, sessionId, events) => {
      if (!events) return null;
      const envEvents = events.query(sessionId, { event_type: 'dependency_change', limit: 5 });
      if (!envEvents.length) return null;
      return envEvents.map(e => `- ${(e.data as Record<string, unknown>)?.description || e.event_type}`).join('\n');
    },
  },
  {
    name: 'plan',
    priority: 2,
    extract: (_storage, sessionId, events) => {
      if (!events) return null;
      const planEvents = events.query(sessionId, { event_type: 'plan', limit: 1 });
      if (!planEvents.length) return null;
      return (planEvents[0].data as Record<string, unknown>)?.content as string || 'Active plan exists';
    },
  },

  // P3 — Context (15% budget)
  {
    name: 'mcp_tools',
    priority: 3,
    extract: (_storage, sessionId, events) => {
      if (!events) return null;
      const allEvents = events.query(sessionId, { limit: 100 });
      const counts = new Map<string, number>();
      for (const e of allEvents) {
        counts.set(e.event_type, (counts.get(e.event_type) || 0) + 1);
      }
      if (!counts.size) return null;
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([t, c]) => `${t}:${c}`)
        .join(', ');
    },
  },
  {
    name: 'intent',
    priority: 3,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(
        'SELECT type, COUNT(*) as cnt FROM observations WHERE session_id = ? GROUP BY type ORDER BY cnt DESC',
      ).all(sessionId) as Array<{ type: string; cnt: number }>;
      if (!rows.length) return null;
      const top = rows[0]?.type;
      const mode = top === 'error' ? 'investigating'
        : top === 'code' ? 'implementing'
          : top === 'decision' ? 'reviewing'
            : 'general';
      return `Mode: ${mode} (${rows.map(r => `${r.type}:${r.cnt}`).join(', ')})`;
    },
  },
  {
    name: 'knowledge',
    priority: 3,
    extract: (storage) => {
      const rows = storage.prepare(
        'SELECT title, category FROM knowledge WHERE archived = 0 ORDER BY created_at DESC LIMIT 5',
      ).all() as Array<{ title: string; category: string }>;
      if (!rows.length) return null;
      return rows.map(r => `- [${r.category}] ${r.title}`).join('\n');
    },
  },
  {
    name: 'stats',
    priority: 3,
    extract: (storage, sessionId) => {
      const row = storage.prepare(
        'SELECT COUNT(*) as obs, SUM(tokens_in) as t_in, SUM(tokens_out) as t_out FROM token_stats WHERE session_id = ?',
      ).get(sessionId) as { obs: number; t_in: number | null; t_out: number | null } | undefined;
      if (!row || !row.obs) return null;
      const saved = Math.max(0, (row.t_in || 0) - (row.t_out || 0));
      const pct = row.t_in ? Math.round((saved / row.t_in) * 100) : 0;
      return `Observations: ${row.obs}, Tokens saved: ${saved} (${pct}%)`;
    },
  },
  {
    name: 'search_history',
    priority: 3,
    extract: (_storage, sessionId, events) => {
      if (!events) return null;
      const searches = events.query(sessionId, { event_type: 'search', limit: 5 });
      if (!searches.length) return null;
      return searches.map(e => `- "${(e.data as Record<string, unknown>)?.query || '?'}"`).join('\n');
    },
  },
  {
    name: 'correlations',
    priority: 3,
    extract: (storage, sessionId) => {
      const rows = storage.prepare(
        'SELECT correlation_id, COUNT(*) as cnt FROM observations WHERE session_id = ? AND correlation_id IS NOT NULL GROUP BY correlation_id ORDER BY cnt DESC LIMIT 5',
      ).all(sessionId) as Array<{ correlation_id: string; cnt: number }>;
      if (!rows.length) return null;
      return rows.map(r => `- ${r.correlation_id} (${r.cnt} observations)`).join('\n');
    },
  },
];

const P1_CATEGORIES = CATEGORIES.filter(c => c.priority === 1).map(c => c.name);

interface ExtractedCategory {
  name: string;
  priority: Priority;
  content: string;
  bytes: number;
}

export class SessionManager {
  constructor(
    private storage: StoragePlugin,
    private events?: EventTracker,
  ) {}

  saveSnapshot(sessionId: string, _stats: TokenEconomics): void {
    const extracted = this.extractCategories(sessionId);
    const snapshot = this.trimToFit(extracted);

    const snapshotStr = JSON.stringify(snapshot);
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
      // Keep only P1 categories + stats
      const condensed: Record<string, unknown> = {
        condensed: true,
        original_session: sessionId,
      };
      for (const key of P1_CATEGORIES) {
        if (data[key] !== undefined) {
          condensed[key] = data[key];
        }
      }
      if (data.stats !== undefined) {
        condensed.stats = data.stats;
      }
      return { snapshot: condensed, condensed: true };
    }

    return { snapshot: data, condensed: false };
  }

  private extractCategories(sessionId: string): ExtractedCategory[] {
    const results: ExtractedCategory[] = [];

    for (const cat of CATEGORIES) {
      try {
        const content = cat.extract(this.storage, sessionId, this.events);
        if (content) {
          results.push({
            name: cat.name,
            priority: cat.priority,
            content,
            bytes: Buffer.byteLength(JSON.stringify({ [cat.name]: content }), 'utf8'),
          });
        }
      } catch {
        // Skip categories that fail extraction
      }
    }

    return results;
  }

  private trimToFit(extracted: ExtractedCategory[]): Record<string, string> {
    // Build initial snapshot
    let snapshot = this.buildRecord(extracted);
    let serialized = JSON.stringify(snapshot);

    if (serialized.length <= MAX_SNAPSHOT_BYTES) {
      return snapshot;
    }

    // Drop P3 categories one by one (smallest first)
    extracted = this.dropByPriority(extracted, 3);
    snapshot = this.buildRecord(extracted);
    serialized = JSON.stringify(snapshot);

    if (serialized.length <= MAX_SNAPSHOT_BYTES) {
      return snapshot;
    }

    // Drop P2 categories one by one (smallest first)
    extracted = this.dropByPriority(extracted, 2);
    snapshot = this.buildRecord(extracted);
    serialized = JSON.stringify(snapshot);

    if (serialized.length <= MAX_SNAPSHOT_BYTES) {
      return snapshot;
    }

    // Truncate remaining P1 content strings
    return this.truncateP1(extracted);
  }

  private dropByPriority(extracted: ExtractedCategory[], priority: Priority): ExtractedCategory[] {
    // Sort candidates by bytes ascending so we drop smallest first
    const toKeep: ExtractedCategory[] = [];
    const toDrop = extracted
      .filter(c => c.priority === priority)
      .sort((a, b) => a.bytes - b.bytes);

    const rest = extracted.filter(c => c.priority !== priority);

    // Try dropping one at a time until we fit
    let remaining = [...rest, ...toDrop];
    for (const candidate of toDrop) {
      remaining = remaining.filter(c => c !== candidate);
      const serialized = JSON.stringify(this.buildRecord(remaining));
      if (serialized.length <= MAX_SNAPSHOT_BYTES) {
        return remaining;
      }
    }

    // All of this priority dropped, still over budget
    return rest;
  }

  private truncateP1(extracted: ExtractedCategory[]): Record<string, string> {
    // Calculate overhead from JSON structure (braces, quotes, commas, colons)
    const overhead = 2 + extracted.length * 6; // rough estimate: {}, "":"", commas
    const budget = MAX_SNAPSHOT_BYTES - overhead;
    const perCategory = Math.max(50, Math.floor(budget / Math.max(1, extracted.length)));

    const result: Record<string, string> = {};
    for (const cat of extracted) {
      if (cat.content.length > perCategory) {
        result[cat.name] = cat.content.slice(0, perCategory - 3) + '...';
      } else {
        result[cat.name] = cat.content;
      }
    }

    return result;
  }

  private buildRecord(extracted: ExtractedCategory[]): Record<string, string> {
    const record: Record<string, string> = {};
    for (const cat of extracted) {
      record[cat.name] = cat.content;
    }
    return record;
  }
}
