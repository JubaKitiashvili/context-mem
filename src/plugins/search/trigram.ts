import type { SearchPlugin, PluginConfig, SearchResult, SearchOpts } from '../../core/types.js';
import type { BetterSqlite3Storage } from '../storage/better-sqlite3.js';
import { sanitizeFTS5Query } from './fts5-utils.js';

export class TrigramSearch implements SearchPlugin {
  name = 'trigram-search';
  version = '1.0.0';
  type = 'search' as const;
  strategy = 'trigram' as const;
  priority = 2;

  constructor(private storage: BetterSqlite3Storage) {}

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async search(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    if (query.length < 3) return [];

    const limit = opts.limit || 5;
    let sql = `
      SELECT o.id, o.type, o.summary, o.content, o.indexed_at,
             rank as relevance
      FROM obs_trigram
      JOIN observations o ON o.rowid = obs_trigram.rowid
      WHERE obs_trigram MATCH ?
    `;
    const params: unknown[] = [sanitizeFTS5Query(query)];

    if (opts.type_filter && opts.type_filter.length > 0) {
      sql += ` AND o.type IN (${opts.type_filter.map(() => '?').join(',')})`;
      params.push(...opts.type_filter);
    }
    if (opts.from) {
      sql += ' AND o.indexed_at >= ?';
      params.push(opts.from);
    }
    if (opts.to) {
      sql += ' AND o.indexed_at <= ?';
      params.push(opts.to);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    try {
      const rows = this.storage.prepare(sql).all(...params) as Array<{
        id: string; type: string; summary: string; content: string;
        indexed_at: number; relevance: number;
      }>;

      return rows.map(row => ({
        id: row.id,
        title: (row.summary || row.content).slice(0, 100),
        snippet: (row.summary || row.content).slice(0, 100),
        relevance_score: Math.abs(row.relevance),
        type: row.type as SearchResult['type'],
        timestamp: row.indexed_at,
      }));
    } catch {
      return [];
    }
  }

  shouldFallback(_results: SearchResult[]): boolean {
    return false;
  }
}
