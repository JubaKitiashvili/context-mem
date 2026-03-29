/**
 * Dreamer — background agent for knowledge validation.
 *
 * Inspired by Honcho's "Dreamer" concept, adapted for local deterministic use
 * (no LLM calls). Periodically validates old knowledge entries, marks stale
 * ones, and auto-archives entries that are likely outdated.
 */
import type { StoragePlugin, KnowledgeCategory } from './types.js';
import type { KnowledgeBase } from '../plugins/knowledge/knowledge-base.js';
import type { GlobalKnowledgeStore } from './global-store.js';

// Stopwords for contradiction word-overlap detection (same set as knowledge-base)
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out',
  'use', 'get', 'set', 'add', 'fix', 'has', 'had', 'its', 'let', 'say', 'she', 'too', 'new',
  'now', 'old', 'see', 'way', 'may', 'who', 'did', 'got', 'try', 'run', 'api', 'app',
]);

export interface DreamerLog {
  type: 'stale' | 'archive' | 'contradiction' | 'promote' | 'merge-suggestion';
  entry_id: string;
  message: string;
  timestamp: number;
}

export class Dreamer {
  private interval: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private readonly CYCLE_MS: number;
  private readonly STALE_THRESHOLD_DAYS: number;
  private readonly ARCHIVE_THRESHOLD_DAYS: number;
  private readonly PROMOTION_SESSION_THRESHOLD: number;
  private readonly logs: DreamerLog[] = [];
  private globalStore?: GlobalKnowledgeStore;

  constructor(
    private knowledgeBase: KnowledgeBase,
    private storage: StoragePlugin,
    opts?: {
      cycleMs?: number;
      staleThresholdDays?: number;
      archiveThresholdDays?: number;
      promotionSessionThreshold?: number;
      globalStore?: GlobalKnowledgeStore;
    },
  ) {
    this.CYCLE_MS = opts?.cycleMs ?? 5 * 60 * 1000;
    this.STALE_THRESHOLD_DAYS = opts?.staleThresholdDays ?? 30;
    this.ARCHIVE_THRESHOLD_DAYS = opts?.archiveThresholdDays ?? 90;
    this.PROMOTION_SESSION_THRESHOLD = opts?.promotionSessionThreshold ?? 3;
    this.globalStore = opts?.globalStore;
  }

  start(): void {
    if (this.interval) return; // already running
    this.interval = setInterval(() => this.cycle(), this.CYCLE_MS);
    this.interval.unref(); // Don't block process exit
    // Run first cycle after 30 seconds (don't block startup)
    this.startupTimer = setTimeout(() => this.cycle(), 30_000);
    this.startupTimer.unref(); // Don't block process exit
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  /** Expose logs for inspection / testing */
  getLogs(): readonly DreamerLog[] {
    return this.logs;
  }

  /** Run a single validation cycle (exposed for testing) */
  async cycle(): Promise<void> {
    try {
      await this.markStaleEntries();
      await this.archiveOldEntries();
      await this.detectContradictions();
      await this.promotionScan();
      await this.duplicateScan();
    } catch {
      // Dreamer is non-critical — never crash the host
    }
  }

  // ---------- Stale detection ----------

  async markStaleEntries(): Promise<number> {
    const cutoff = Date.now() - this.STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    const rows = this.storage.prepare(
      'SELECT id FROM knowledge WHERE archived = 0 AND stale = 0 AND last_accessed < ?',
    ).all(cutoff) as Array<{ id: string }>;

    for (const row of rows) {
      this.storage.exec('UPDATE knowledge SET stale = 1 WHERE id = ?', [row.id]);
      this.logs.push({
        type: 'stale',
        entry_id: row.id,
        message: `Marked stale (no access for ${this.STALE_THRESHOLD_DAYS}+ days)`,
        timestamp: Date.now(),
      });
    }

    return rows.length;
  }

  // ---------- Auto-archive ----------

  async archiveOldEntries(): Promise<number> {
    const cutoff = Date.now() - this.ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    // Never auto-archive explicit entries
    const rows = this.storage.prepare(
      "SELECT id FROM knowledge WHERE archived = 0 AND source_type != 'explicit' AND last_accessed < ?",
    ).all(cutoff) as Array<{ id: string }>;

    for (const row of rows) {
      this.storage.exec('UPDATE knowledge SET archived = 1 WHERE id = ?', [row.id]);
      this.logs.push({
        type: 'archive',
        entry_id: row.id,
        message: `Auto-archived (no access for ${this.ARCHIVE_THRESHOLD_DAYS}+ days)`,
        timestamp: Date.now(),
      });
    }

    return rows.length;
  }

  // ---------- Contradiction detection ----------

  async detectContradictions(): Promise<number> {
    const categories: KnowledgeCategory[] = ['pattern', 'decision', 'error', 'api', 'component'];
    let found = 0;

    for (const category of categories) {
      const entries = this.storage.prepare(
        'SELECT id, title, content FROM knowledge WHERE archived = 0 AND category = ? ORDER BY created_at DESC LIMIT 50',
      ).all(category) as Array<{ id: string; title: string; content: string }>;

      // Compare each pair for high word overlap
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i];
        const aWords = this.extractWords(`${a.title} ${a.content}`);

        for (let j = i + 1; j < entries.length; j++) {
          const b = entries[j];
          const bWords = this.extractWords(`${b.title} ${b.content}`);

          const bSet = new Set(bWords);
          const overlap = aWords.filter(w => bSet.has(w));

          // Require significant overlap (at least 4 shared meaningful words)
          // and overlap is at least 40% of the smaller entry's words
          const minLen = Math.min(aWords.length, bWords.length);
          if (overlap.length >= 4 && minLen > 0 && overlap.length / minLen >= 0.4) {
            found++;
            this.logs.push({
              type: 'contradiction',
              entry_id: a.id,
              message: `Potential contradiction with entry ${b.id}: ${overlap.length} shared words (${a.title} vs ${b.title})`,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    return found;
  }

  // ---------- Auto-promote scan ----------

  async promotionScan(): Promise<Array<{ id: string; title: string; sessions: number }>> {
    try {
      const rows = this.storage.prepare(`
        SELECT sal.knowledge_id, COUNT(DISTINCT sal.session_id) as sessions
        FROM session_access_log sal
        JOIN knowledge k ON k.id = sal.knowledge_id
        WHERE k.archived = 0
          AND k.auto_promoted = 0
          AND k.shareable = 1
        GROUP BY sal.knowledge_id
        HAVING sessions >= ?
      `).all(this.PROMOTION_SESSION_THRESHOLD) as Array<{ knowledge_id: string; sessions: number }>;

      const candidates: Array<{ id: string; title: string; sessions: number }> = [];

      for (const row of rows) {
        const entry = this.storage.prepare(
          'SELECT id, title FROM knowledge WHERE id = ?'
        ).get(row.knowledge_id) as { id: string; title: string } | undefined;

        if (entry) {
          candidates.push({ id: entry.id, title: entry.title, sessions: row.sessions });
          this.logs.push({
            type: 'promote',
            entry_id: entry.id,
            message: `Promotion candidate: "${entry.title}" (${row.sessions} sessions)`,
            timestamp: Date.now(),
          });
        }
      }

      return candidates;
    } catch {
      // session_access_log may not exist (pre-v11)
      return [];
    }
  }

  // ---------- Global duplicate scan ----------

  async duplicateScan(): Promise<number> {
    if (!this.globalStore) return 0;

    try {
      const allEntries = this.globalStore.getAll({ limit: 100 });
      let found = 0;
      const processed = new Set<string>();

      for (const entry of allEntries) {
        if (processed.has(entry.id)) continue;

        const duplicates = this.globalStore.findDuplicates(entry);
        for (const dup of duplicates) {
          if (dup.entry.id === entry.id) continue;
          if (processed.has(dup.entry.id)) continue;

          const pairKey = [entry.id, dup.entry.id].sort().join(':');
          if (processed.has(pairKey)) continue;
          processed.add(pairKey);

          if (dup.similarity > 0.9) {
            this.globalStore.autoMerge(entry.id, dup.entry.id);
            processed.add(dup.entry.id);
            this.logs.push({
              type: 'merge-suggestion',
              entry_id: entry.id,
              message: `Auto-merged with ${dup.entry.id} (similarity: ${dup.similarity.toFixed(2)})`,
              timestamp: Date.now(),
            });
            found++;
          } else if (dup.similarity >= 0.7) {
            this.logs.push({
              type: 'merge-suggestion',
              entry_id: entry.id,
              message: `Merge suggestion: "${entry.title}" ↔ "${dup.entry.title}" (similarity: ${dup.similarity.toFixed(2)})`,
              timestamp: Date.now(),
            });
            found++;
          }
        }
      }

      return found;
    } catch {
      return 0;
    }
  }

  private extractWords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w));
  }
}
