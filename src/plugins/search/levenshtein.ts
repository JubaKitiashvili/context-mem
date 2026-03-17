import type { SearchPlugin, PluginConfig, SearchResult, SearchOpts } from '../../core/types.js';
import type { BetterSqlite3Storage } from '../storage/better-sqlite3.js';

export class LevenshteinSearch implements SearchPlugin {
  name = 'levenshtein-search';
  version = '1.0.0';
  type = 'search' as const;
  strategy = 'levenshtein' as const;
  priority = 3;

  constructor(private storage: BetterSqlite3Storage) {}

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async search(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    const limit = opts.limit || 5;
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    if (queryWords.length === 0) return [];

    // Operate on 100 most recent observations only
    let sql = 'SELECT id, type, summary, content, indexed_at FROM observations';
    const params: unknown[] = [];

    if (opts.type_filter && opts.type_filter.length > 0) {
      sql += ` WHERE type IN (${opts.type_filter.map(() => '?').join(',')})`;
      params.push(...opts.type_filter);
    }

    sql += ' ORDER BY indexed_at DESC LIMIT 100';

    const rows = this.storage.prepare(sql).all(...params) as Array<{
      id: string; type: string; summary: string | null; content: string; indexed_at: number;
    }>;

    // Score each observation by minimum Levenshtein distance
    const scored: Array<{ row: typeof rows[0]; score: number }> = [];

    for (const row of rows) {
      const text = (row.summary || row.content).toLowerCase();
      const words = text.split(/\s+/).filter(w => w.length >= 2);

      let totalScore = 0;
      let matchedWords = 0;

      for (const qWord of queryWords) {
        let bestDist = Infinity;
        for (const tWord of words) {
          const dist = this.levenshtein(qWord, tWord);
          if (dist < bestDist) bestDist = dist;
          if (dist === 0) break; // exact match, no need to continue
        }
        if (bestDist <= 2) {
          matchedWords++;
          totalScore += 1 / (bestDist + 1); // closer match = higher score
        }
      }

      if (matchedWords > 0) {
        scored.push({ row, score: totalScore / queryWords.length });
      }
    }

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(s => ({
      id: s.row.id,
      title: (s.row.summary || s.row.content).slice(0, 100),
      snippet: (s.row.summary || s.row.content).slice(0, 200),
      relevance_score: s.score,
      type: s.row.type as SearchResult['type'],
      timestamp: s.row.indexed_at,
    }));
  }

  shouldFallback(_results: SearchResult[]): boolean {
    return false; // Terminal — never falls back
  }

  private levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Optimization: if length difference > 2, skip
    if (Math.abs(a.length - b.length) > 2) return 3;

    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[a.length][b.length];
  }
}
