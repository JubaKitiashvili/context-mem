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
import { getTargetTier, compressToTier } from './adaptive-compressor.js';
import type { CompressionTier } from './adaptive-compressor.js';

// Stopwords for contradiction word-overlap detection (same set as knowledge-base)
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out',
  'use', 'get', 'set', 'add', 'fix', 'has', 'had', 'its', 'let', 'say', 'she', 'too', 'new',
  'now', 'old', 'see', 'way', 'may', 'who', 'did', 'got', 'try', 'run', 'api', 'app',
]);

export interface DreamerLog {
  type: 'stale' | 'archive' | 'contradiction' | 'promote' | 'merge-suggestion' | 'compress';
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
      await this.progressiveCompress();
      await this.consolidateRelated();
      await this.extractCausalChains();
      await this.boostCorroboration();
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

  // ---------- Progressive compression ----------

  async progressiveCompress(): Promise<number> {
    try {
      const rows = this.storage.prepare(
        'SELECT id, content, summary, indexed_at, importance_score, pinned, compression_tier FROM observations WHERE pinned = 0'
      ).all() as Array<{
        id: string; content: string; summary: string | null;
        indexed_at: number; importance_score: number; pinned: number; compression_tier: string;
      }>;

      let compressed = 0;
      for (const row of rows) {
        const targetTier = getTargetTier(row.indexed_at, row.importance_score, row.pinned === 1);
        if (targetTier === row.compression_tier) continue;

        // Only compress forward (never decompress)
        const tierOrder: CompressionTier[] = ['verbatim', 'light', 'medium', 'distilled'];
        const currentIdx = tierOrder.indexOf(row.compression_tier as CompressionTier);
        const targetIdx = tierOrder.indexOf(targetTier);
        if (targetIdx <= currentIdx) continue;

        const newSummary = compressToTier(row.content, row.summary, targetTier);
        this.storage.exec(
          'UPDATE observations SET summary = ?, compression_tier = ? WHERE id = ?',
          [newSummary, targetTier, row.id],
        );

        this.logs.push({
          type: 'compress',
          entry_id: row.id,
          message: `Compressed from ${row.compression_tier} to ${targetTier}`,
          timestamp: Date.now(),
        });
        compressed++;
      }

      return compressed;
    } catch {
      return 0;
    }
  }

  // ---------- Consolidation ----------

  async consolidateRelated(): Promise<number> {
    try {
      // Find topics with >5 unlinked observations
      const topics = this.storage.prepare(`
        SELECT t.id, t.name, t.observation_count
        FROM topics t
        WHERE t.observation_count > 5
      `).all() as Array<{ id: string; name: string; observation_count: number }>;

      let consolidated = 0;
      for (const topic of topics) {
        // Check if already consolidated (knowledge entry exists for this topic)
        const existing = this.storage.prepare(
          "SELECT id FROM knowledge WHERE title LIKE ? AND category = 'pattern'"
        ).get(`%${topic.name}%`) as { id: string } | undefined;
        if (existing) continue;

        // Get observation summaries for this topic
        const obs = this.storage.prepare(`
          SELECT o.id, o.summary, o.content
          FROM observation_topics ot
          JOIN observations o ON o.id = ot.observation_id
          WHERE ot.topic_id = ?
          ORDER BY o.importance_score DESC
          LIMIT 10
        `).all(topic.id) as Array<{ id: string; summary: string | null; content: string }>;

        if (obs.length < 5) continue;

        // Create consolidated knowledge entry
        const summaries = obs.map(o => o.summary || o.content.slice(0, 100)).join('; ');
        const consolidatedContent = `Consolidated from ${obs.length} observations on ${topic.name}: ${summaries.slice(0, 500)}`;

        try {
          await this.knowledgeBase.save({
            category: 'pattern',
            title: `${topic.name} knowledge (consolidated)`,
            content: consolidatedContent,
            tags: [topic.name, 'consolidated'],
            source_type: 'inferred',
          });
          consolidated++;
          this.logs.push({
            type: 'merge-suggestion',
            entry_id: topic.id,
            message: `Consolidated ${obs.length} observations on topic "${topic.name}"`,
            timestamp: Date.now(),
          });
        } catch { /* non-critical */ }
      }
      return consolidated;
    } catch {
      return 0;
    }
  }

  // ---------- Causal chain extraction ----------

  async extractCausalChains(): Promise<number> {
    try {
      // Find DECISION observations followed by PROBLEM then MILESTONE
      const decisions = this.storage.prepare(`
        SELECT o.id, o.indexed_at, o.metadata
        FROM observations o
        WHERE o.metadata LIKE '%DECISION%'
        ORDER BY o.indexed_at DESC
        LIMIT 50
      `).all() as Array<{ id: string; indexed_at: number; metadata: string }>;

      let chains = 0;
      for (const decision of decisions) {
        // Look for PROBLEM within 7 days after
        const problem = this.storage.prepare(`
          SELECT id, indexed_at FROM observations
          WHERE metadata LIKE '%PROBLEM%'
            AND indexed_at > ? AND indexed_at < ?
          ORDER BY indexed_at ASC LIMIT 1
        `).get(decision.indexed_at, decision.indexed_at + 7 * 24 * 60 * 60 * 1000) as { id: string; indexed_at: number } | undefined;

        if (!problem) continue;

        // Look for MILESTONE within 14 days after the problem
        const milestone = this.storage.prepare(`
          SELECT id FROM observations
          WHERE metadata LIKE '%MILESTONE%'
            AND indexed_at > ? AND indexed_at < ?
          ORDER BY indexed_at ASC LIMIT 1
        `).get(problem.indexed_at, problem.indexed_at + 14 * 24 * 60 * 60 * 1000) as { id: string } | undefined;

        if (!milestone) continue;

        this.logs.push({
          type: 'promote',
          entry_id: decision.id,
          message: `Causal chain: decision ${decision.id} → problem ${problem.id} → milestone ${milestone.id}`,
          timestamp: Date.now(),
        });
        chains++;
      }
      return chains;
    } catch {
      return 0;
    }
  }

  // ---------- Corroboration boost ----------

  async boostCorroboration(): Promise<number> {
    try {
      // Find knowledge entries accessed in 3+ distinct sessions
      const rows = this.storage.prepare(`
        SELECT sal.knowledge_id, COUNT(DISTINCT sal.session_id) as sessions
        FROM session_access_log sal
        JOIN knowledge k ON k.id = sal.knowledge_id
        WHERE k.archived = 0
        GROUP BY sal.knowledge_id
        HAVING sessions >= 3
      `).all() as Array<{ knowledge_id: string; sessions: number }>;

      let boosted = 0;
      for (const row of rows) {
        // Only boost if not already boosted recently (check access_count as proxy)
        const entry = this.storage.prepare(
          'SELECT relevance_score FROM knowledge WHERE id = ?'
        ).get(row.knowledge_id) as { relevance_score: number } | undefined;

        if (!entry || entry.relevance_score >= 3.0) continue; // cap boost

        this.storage.exec(
          'UPDATE knowledge SET relevance_score = MIN(relevance_score * 1.15, 5.0) WHERE id = ?',
          [row.knowledge_id],
        );
        boosted++;
      }
      return boosted;
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
