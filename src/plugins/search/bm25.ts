import type { SearchPlugin, PluginConfig, SearchResult, SearchOpts } from '../../core/types.js';
import type { BetterSqlite3Storage } from '../storage/better-sqlite3.js';

export class BM25Search implements SearchPlugin {
  name = 'bm25-search';
  version = '1.0.0';
  type = 'search' as const;
  strategy = 'bm25' as const;
  priority = 1;

  constructor(private storage: BetterSqlite3Storage) {}

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async search(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    const limit = opts.limit || 5;
    let sql = `
      SELECT o.id, o.type, o.summary, o.content, o.indexed_at,
             bm25(obs_fts) as relevance
      FROM obs_fts
      JOIN observations o ON o.rowid = obs_fts.rowid
      WHERE obs_fts MATCH ?
    `;
    const params: unknown[] = [query];

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

    sql += ' ORDER BY bm25(obs_fts) LIMIT ?';
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

  shouldFallback(results: SearchResult[]): boolean {
    return results.length < 3;
  }
}
