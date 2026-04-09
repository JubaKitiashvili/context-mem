import type { SearchPlugin, PluginConfig, SearchResult, SearchOpts } from '../../core/types.js';
import type { BetterSqlite3Storage } from '../storage/better-sqlite3.js';
import { Embedder } from './embedder.js';
import { extractBestSnippet } from './snippet-extractor.js';

const SCAN_LIMIT = 5000;
const SIMILARITY_THRESHOLD = 0.2;

export class VectorSearch implements SearchPlugin {
  name = 'vector-search';
  version = '1.0.0';
  type = 'search' as const;
  strategy = 'vector' as const;
  priority = 0;

  constructor(private storage: BetterSqlite3Storage) {}

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async search(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    const queryEmbedding = await Embedder.embedQuery(query);
    if (!queryEmbedding) return [];

    const limit = opts.limit || 5;

    let sql = `
      SELECT id, type, summary, content, indexed_at, access_count, embeddings
      FROM observations
      WHERE embeddings IS NOT NULL
    `;
    const params: unknown[] = [];

    if (opts.type_filter && opts.type_filter.length > 0) {
      sql += ` AND type IN (${opts.type_filter.map(() => '?').join(',')})`;
      params.push(...opts.type_filter);
    }
    if (opts.from) {
      sql += ' AND indexed_at >= ?';
      params.push(opts.from);
    }
    if (opts.to) {
      sql += ' AND indexed_at <= ?';
      params.push(opts.to);
    }

    sql += ` ORDER BY indexed_at DESC LIMIT ?`;
    params.push(SCAN_LIMIT);

    try {
      const rows = this.storage.prepare(sql).all(...params) as Array<{
        id: string; type: string; summary: string | null; content: string;
        indexed_at: number; access_count: number; embeddings: Buffer;
      }>;

      const scored: Array<{ row: typeof rows[0]; similarity: number }> = [];

      for (const row of rows) {
        const embedding = Embedder.fromBuffer(row.embeddings);
        const similarity = Embedder.cosineSimilarity(queryEmbedding, embedding);
        if (similarity >= SIMILARITY_THRESHOLD) {
          scored.push({ row, similarity });
        }
      }

      scored.sort((a, b) => b.similarity - a.similarity);

      return scored.slice(0, limit).map(({ row, similarity }) => ({
        id: row.id,
        title: (row.summary || row.content).slice(0, 100),
        snippet: extractBestSnippet(row.summary || row.content, query, 300),
        relevance_score: similarity,
        type: row.type as SearchResult['type'],
        timestamp: row.indexed_at,
        access_count: row.access_count ?? 0,
      }));
    } catch {
      return [];
    }
  }

  shouldFallback(results: SearchResult[]): boolean {
    // Only stop cascade if we have high-confidence semantic matches
    if (results.length > 0 && results[0].relevance_score >= 0.7) return false;
    return true;
  }
}
