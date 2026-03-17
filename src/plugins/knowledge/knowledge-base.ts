import type { StoragePlugin, KnowledgeEntry, KnowledgeCategory } from '../../core/types.js';
import { ulid } from '../../core/utils.js';

// Use FTS5 query sanitization
function sanitizeFTS5(query: string): string {
  return query.replace(/[^\w\s]/g, ' ').trim();
}

export class KnowledgeBase {
  constructor(private storage: StoragePlugin) {}

  save(entry: {
    category: KnowledgeCategory;
    title: string;
    content: string;
    tags?: string[];
    shareable?: boolean;
  }): KnowledgeEntry {
    const knowledge: KnowledgeEntry = {
      id: ulid(),
      category: entry.category,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || [],
      shareable: entry.shareable !== false,
      relevance_score: 1.0,
      access_count: 0,
      created_at: Date.now(),
      archived: false,
    };

    this.storage.exec(
      'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [knowledge.id, knowledge.category, knowledge.title, knowledge.content, JSON.stringify(knowledge.tags), knowledge.shareable ? 1 : 0, knowledge.relevance_score, knowledge.access_count, knowledge.created_at, knowledge.archived ? 1 : 0]
    );

    return knowledge;
  }

  search(query: string, opts: { category?: KnowledgeCategory; limit?: number } = {}): KnowledgeEntry[] {
    const limit = opts.limit || 10;
    const sanitized = sanitizeFTS5(query);
    if (!sanitized) return [];

    // Layer 1: FTS5 full-text search
    let results = this.searchFTS5(sanitized, opts.category, limit);

    // Layer 2: Trigram fallback if FTS5 yields nothing
    if (results.length === 0) {
      results = this.searchTrigram(sanitized, opts.category, limit);
    }

    // Layer 3: Scan fallback for very short or unusual queries
    if (results.length === 0) {
      results = this.searchScan(query, opts.category, limit);
    }

    // Increment access counts for results
    for (const entry of results) {
      this.storage.exec(
        'UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?',
        [entry.id]
      );
    }

    return results;
  }

  access(id: string): KnowledgeEntry | null {
    const row = this.storage.prepare(
      'SELECT * FROM knowledge WHERE id = ? AND archived = 0'
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    // Increment access count
    this.storage.exec(
      'UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?',
      [id]
    );

    return this.rowToEntry(row);
  }

  prune(): number {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - NINETY_DAYS_MS;

    // Calculate relevance for old entries and archive low-scoring ones
    const oldEntries = this.storage.prepare(
      'SELECT id, created_at, access_count FROM knowledge WHERE archived = 0 AND created_at < ?'
    ).all(cutoff) as Array<{ id: string; created_at: number; access_count: number }>;

    let pruned = 0;
    for (const entry of oldEntries) {
      const weeksOld = (Date.now() - entry.created_at) / (7 * 24 * 60 * 60 * 1000);
      const relevance = Math.pow(0.9, weeksOld) * Math.log2(entry.access_count + 1);

      if (relevance < 0.1) {
        this.storage.exec(
          'UPDATE knowledge SET archived = 1, relevance_score = ? WHERE id = ?',
          [relevance, entry.id]
        );
        pruned++;
      } else {
        // Update relevance score
        this.storage.exec(
          'UPDATE knowledge SET relevance_score = ? WHERE id = ?',
          [relevance, entry.id]
        );
      }
    }

    return pruned;
  }

  private searchFTS5(query: string, category: KnowledgeCategory | undefined, limit: number): KnowledgeEntry[] {
    try {
      let sql = `
        SELECT k.* FROM knowledge_fts
        JOIN knowledge k ON k.rowid = knowledge_fts.rowid
        WHERE knowledge_fts MATCH ? AND k.archived = 0
      `;
      const params: unknown[] = [query];
      if (category) {
        sql += ' AND k.category = ?';
        params.push(category);
      }
      sql += ' ORDER BY bm25(knowledge_fts) ASC LIMIT ?';
      params.push(limit);

      const rows = this.storage.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEntry(r));
    } catch {
      return [];
    }
  }

  private searchTrigram(query: string, category: KnowledgeCategory | undefined, limit: number): KnowledgeEntry[] {
    if (query.length < 3) return [];
    try {
      let sql = `
        SELECT k.* FROM knowledge_trigram
        JOIN knowledge k ON k.rowid = knowledge_trigram.rowid
        WHERE knowledge_trigram MATCH ? AND k.archived = 0
      `;
      const params: unknown[] = [query];
      if (category) {
        sql += ' AND k.category = ?';
        params.push(category);
      }
      sql += ' LIMIT ?';
      params.push(limit);

      const rows = this.storage.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEntry(r));
    } catch {
      return [];
    }
  }

  private searchScan(query: string, category: KnowledgeCategory | undefined, limit: number): KnowledgeEntry[] {
    const lowerQuery = query.toLowerCase();
    let sql = 'SELECT * FROM knowledge WHERE archived = 0';
    const params: unknown[] = [];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';

    const rows = this.storage.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows
      .filter(r => {
        const title = (r.title as string).toLowerCase();
        const content = (r.content as string).toLowerCase();
        return title.includes(lowerQuery) || content.includes(lowerQuery);
      })
      .slice(0, limit)
      .map(r => this.rowToEntry(r));
  }

  private rowToEntry(row: Record<string, unknown>): KnowledgeEntry {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags as string) as string[];
    } catch {
      // invalid tags
    }
    return {
      id: row.id as string,
      category: row.category as KnowledgeCategory,
      title: row.title as string,
      content: row.content as string,
      tags,
      shareable: !!(row.shareable as number),
      relevance_score: row.relevance_score as number,
      access_count: row.access_count as number,
      created_at: row.created_at as number,
      archived: !!(row.archived as number),
    };
  }
}
