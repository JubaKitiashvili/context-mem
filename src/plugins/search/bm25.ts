import type { SearchPlugin, PluginConfig, SearchResult, SearchOpts } from '../../core/types.js';
import type { BetterSqlite3Storage } from '../storage/better-sqlite3.js';
import { sanitizeFTS5Query } from './fts5-utils.js';
import { extractBestSnippet } from './snippet-extractor.js';
import { buildORQuery, buildANDQuery, buildEntityQuery, buildPhraseQuery, buildRelaxedANDQuery, extractKeywords, resolveTemporalKeywords } from './query-builder.js';

export class BM25Search implements SearchPlugin {
  name = 'bm25-search';
  version = '2.0.0';
  type = 'search' as const;
  strategy = 'bm25' as const;
  priority = 1;

  constructor(private storage: BetterSqlite3Storage) {}

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async search(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    const limit = opts.limit || 5;
    const seen = new Map<string, { row: RowData; score: number }>();

    // Build filter clauses
    let filterSQL = '';
    const filterParams: unknown[] = [];
    if (opts.type_filter && opts.type_filter.length > 0) {
      filterSQL += ` AND o.type IN (${opts.type_filter.map(() => '?').join(',')})`;
      filterParams.push(...opts.type_filter);
    }
    if (opts.from) {
      filterSQL += ' AND o.indexed_at >= ?';
      filterParams.push(opts.from);
    }
    if (opts.to) {
      filterSQL += ' AND o.indexed_at <= ?';
      filterParams.push(opts.to);
    }

    const runQuery = (matchExpr: string, weight: number) => {
      try {
        const sql = `
          SELECT o.id, o.type, o.summary, o.content, o.indexed_at, o.access_count,
                 bm25(obs_fts) as relevance
          FROM obs_fts
          JOIN observations o ON o.rowid = obs_fts.rowid
          WHERE obs_fts MATCH ?${filterSQL}
          ORDER BY bm25(obs_fts) LIMIT ?`;
        const rows = this.storage.prepare(sql).all(matchExpr, ...filterParams, limit * 5) as RowData[];
        for (const row of rows) {
          const score = Math.abs(row.relevance) * weight;
          const existing = seen.get(row.id);
          if (!existing || score > existing.score) {
            seen.set(row.id, { row, score });
          }
        }
      } catch { /* query syntax error — skip */ }
    };

    // Strategy 1: AND-mode (high precision — all keywords must match)
    const andQuery = buildANDQuery(query);
    if (andQuery) runQuery(andQuery, 2.0);

    // Strategy 2: Phrase matching (consecutive keyword pairs)
    const phraseQuery = buildPhraseQuery(query);
    if (phraseQuery) runQuery(phraseQuery, 1.9);

    // Strategy 3: Entity-focused (proper nouns, dates)
    const entityQuery = buildEntityQuery(query);
    if (entityQuery) runQuery(entityQuery, 1.8);

    // Strategy 4: Original sanitized query (FTS5 default tokenization)
    const sanitized = sanitizeFTS5Query(query);
    if (sanitized && sanitized !== '""') runQuery(sanitized, 1.5);

    // Strategy 5: Relaxed AND (entity + top content words, fewer terms than full AND)
    const relaxedAnd = buildRelaxedANDQuery(query);
    if (relaxedAnd && relaxedAnd !== andQuery) runQuery(relaxedAnd, 1.2);

    // Strategy 6: OR-mode with synonym expansion (broad recall)
    const orQuery = buildORQuery(query);
    if (orQuery) runQuery(orQuery, 1.0);

    // Strategy 7: Individual keyword fallback (long-tail catch)
    const keywords = extractKeywords(query).filter(w => w.length >= 4);
    for (const kw of keywords.slice(0, 5)) {
      runQuery(`"${kw}"`, 0.5);
    }

    // Strategy 8: Temporal resolution (relative dates → absolute date keywords)
    if (opts.referenceDate) {
      const temporalKws = resolveTemporalKeywords(query, new Date(opts.referenceDate));
      if (temporalKws.length > 0) {
        const temporalQuery = temporalKws.map(w => `"${w}"`).join(' AND ');
        runQuery(temporalQuery, 1.6);
      }
    }

    // Convert to results, sorted by score
    const sorted = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);

    // Normalize scores to 0-1 range so they're comparable with vector cosine similarities
    const maxScore = sorted.length > 0 ? sorted[0].score : 1;
    const minScore = sorted.length > 1 ? sorted[sorted.length - 1].score : 0;
    const range = maxScore - minScore || 1;

    return sorted.map(({ row, score }) => ({
      id: row.id,
      title: (row.summary || row.content).slice(0, 100),
      snippet: extractBestSnippet(row.summary || row.content, query, 300),
      relevance_score: (score - minScore) / range,  // normalized to [0, 1]
      type: row.type as SearchResult['type'],
      timestamp: row.indexed_at,
      access_count: row.access_count ?? 0,
    }));
  }

  shouldFallback(results: SearchResult[]): boolean {
    return results.length === 0;
  }
}

interface RowData {
  id: string;
  type: string;
  summary: string;
  content: string;
  indexed_at: number;
  access_count: number;
  relevance: number;
}
