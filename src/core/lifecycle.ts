import type { StoragePlugin, ObservationType } from './types.js';

export interface LifecycleConfig {
  ttl_days: number;
  max_db_size_mb: number;
  max_observations: number;
  preserve_types: ObservationType[];
  vacuum_on_cleanup?: boolean;
}

export class LifecycleManager {
  constructor(
    private storage: StoragePlugin,
    private config: LifecycleConfig,
  ) {}

  async cleanup(): Promise<{ deleted: number }> {
    let deleted = 0;

    // 1. TTL — delete old observations (skip preserved types)
    const cutoff = Date.now() - (this.config.ttl_days * 24 * 60 * 60 * 1000);
    const preservePlaceholders = this.config.preserve_types.map(() => '?').join(',');
    const ttlResult = this.storage.prepare(
      `DELETE FROM observations WHERE indexed_at < ? AND type NOT IN (${preservePlaceholders})`
    ).run(cutoff, ...this.config.preserve_types);
    deleted += ttlResult.changes;

    // 2. Count cap — delete oldest if over max_observations (skip preserved types)
    const countRow = this.storage.prepare('SELECT COUNT(*) as cnt FROM observations').get() as { cnt: number };
    if (countRow.cnt > this.config.max_observations) {
      const excess = countRow.cnt - this.config.max_observations;
      const capResult = this.storage.prepare(
        `DELETE FROM observations WHERE id IN (
          SELECT id FROM observations WHERE type NOT IN (${preservePlaceholders}) ORDER BY indexed_at ASC LIMIT ?
        )`
      ).run(...this.config.preserve_types, excess);
      deleted += capResult.changes;
    }

    // VACUUM scheduling — reclaim space from FTS5 shadow tables + WAL
    if (this.config.vacuum_on_cleanup !== false) {
      this.storage.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      // Only VACUUM if DB > 10MB (VACUUM is expensive)
      const dbSize = this.storage.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
      if (dbSize && (dbSize as any).size > 10 * 1024 * 1024) {
        this.storage.exec('VACUUM');
      }
    }

    return { deleted };
  }

  async cleanupSession(sessionId: string): Promise<{ deleted: number }> {
    const result = this.storage.prepare(
      `DELETE FROM observations WHERE privacy_level = 'private' AND session_id = ?`
    ).run(sessionId);
    return { deleted: result.changes };
  }
}
