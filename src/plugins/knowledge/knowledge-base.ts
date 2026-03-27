import type { StoragePlugin, KnowledgeEntry, KnowledgeCategory, SourceType, ContradictionWarning } from '../../core/types.js';
import { ulid } from '../../core/utils.js';
import { sanitizeFTS5 } from '../search/fts5-utils.js';

// Stopwords for contradiction detection word-overlap filter
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out',
  'use', 'get', 'set', 'add', 'fix', 'has', 'had', 'its', 'let', 'say', 'she', 'too', 'new',
  'now', 'old', 'see', 'way', 'may', 'who', 'did', 'got', 'try', 'run', 'api', 'app',
]);

export class KnowledgeBase {
  constructor(private storage: StoragePlugin) {}

  save(entry: {
    category: KnowledgeCategory;
    title: string;
    content: string;
    tags?: string[];
    shareable?: boolean;
    source_type?: SourceType;
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
      source_type: entry.source_type || 'observed',
    };

    this.storage.exec(
      'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [knowledge.id, knowledge.category, knowledge.title, knowledge.content, JSON.stringify(knowledge.tags), knowledge.shareable ? 1 : 0, knowledge.relevance_score, knowledge.access_count, knowledge.created_at, knowledge.archived ? 1 : 0, knowledge.source_type]
    );

    return knowledge;
  }

  checkContradictions(title: string, content: string, category: KnowledgeCategory): ContradictionWarning[] {
    const raw = `${title} ${content}`;
    let searchText = raw;
    if (raw.length > 200) {
      const idx = raw.lastIndexOf(' ', 200);
      searchText = raw.slice(0, idx > 0 ? idx : 200);
    }
    const sanitized = sanitizeFTS5(searchText);
    if (!sanitized) return [];

    // Search existing knowledge in the same category for similar entries
    let candidates: Array<Record<string, unknown>> = [];

    // Try FTS5 first
    try {
      candidates = this.storage.prepare(`
        SELECT k.id, k.title, k.content FROM knowledge_fts
        JOIN knowledge k ON k.rowid = knowledge_fts.rowid
        WHERE knowledge_fts MATCH ? AND k.archived = 0 AND k.category = ?
        ORDER BY bm25(knowledge_fts) ASC LIMIT 5
      `).all(sanitized, category) as Array<Record<string, unknown>>;
    } catch {
      // FTS5 failed — try scan
    }

    // Fallback: title + content similarity scan
    if (candidates.length === 0) {
      // Use title if available, otherwise fall back to content for word extraction
      const sourceText = title.trim() ? title.toLowerCase() : content.toLowerCase().slice(0, 200);
      const allEntries = this.storage.prepare(
        'SELECT id, title, content FROM knowledge WHERE archived = 0 AND category = ? ORDER BY created_at DESC LIMIT 50'
      ).all(category) as Array<Record<string, unknown>>;

      candidates = allEntries.filter(r => {
        const existingTitle = ((r.title as string) ?? '').toLowerCase();
        const existingContent = ((r.content as string) ?? '').toLowerCase().slice(0, 200);
        const compareText = title.trim() ? existingTitle : existingContent;
        // Check if texts share significant non-stopword words (3+ chars)
        const newWords = sourceText.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
        const existingWords = compareText.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
        const existingWordSet = new Set(existingWords);
        const overlap = newWords.filter(w => existingWordSet.has(w));
        return overlap.length >= 2;
      });
    }

    if (candidates.length === 0) return [];

    // Build contradiction warnings
    const warnings: ContradictionWarning[] = [];
    for (const c of candidates) {
      const existingTitle = (c.title as string) ?? '';
      const existingContent = ((c.content as string) ?? '').slice(0, 200);

      // Determine similarity reason
      let reason = 'similar topic';
      const titleLower = title.toLowerCase();
      const existingLower = existingTitle.toLowerCase();
      if (titleLower === existingLower) {
        reason = 'identical title';
      } else if (titleLower.includes(existingLower) || existingLower.includes(titleLower)) {
        reason = 'overlapping title';
      }

      warnings.push({
        id: c.id as string,
        title: existingTitle,
        content: existingContent,
        similarity_reason: reason,
      });
    }

    return warnings;
  }

  generateProfile(): string {
    try {
      const lines: string[] = [];

      // Recent decisions (what tech/architecture choices were made)
      const decisions = this.storage.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category = 'decision' ORDER BY created_at DESC LIMIT 5"
      ).all() as Array<{ title: string }>;

      // Recent patterns (what conventions are used)
      const patterns = this.storage.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category = 'pattern' ORDER BY access_count DESC LIMIT 5"
      ).all() as Array<{ title: string }>;

      // Recent errors (what's been debugging)
      const errors = this.storage.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category = 'error' ORDER BY created_at DESC LIMIT 3"
      ).all() as Array<{ title: string }>;

      // API/component knowledge (what tech stack is used)
      const apis = this.storage.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category IN ('api', 'component') ORDER BY access_count DESC LIMIT 3"
      ).all() as Array<{ title: string }>;

      if (decisions.length > 0) {
        lines.push('Decisions: ' + decisions.map(d => d.title).join(', '));
      }
      if (patterns.length > 0) {
        lines.push('Patterns: ' + patterns.map(p => p.title).join(', '));
      }
      if (apis.length > 0) {
        lines.push('Tech: ' + apis.map(a => a.title).join(', '));
      }
      if (errors.length > 0) {
        lines.push('Recent issues: ' + errors.map(e => e.title).join(', '));
      }

      return lines.join('\n');
    } catch {
      return '';
    }
  }

  saveProfile(content: string): void {
    this.storage.exec(
      'INSERT OR REPLACE INTO project_profile (id, content, updated_at) VALUES (1, ?, ?)',
      [content, Date.now()]
    );
  }

  getProfile(): { content: string; updated_at: number } | null {
    try {
      const row = this.storage.prepare(
        'SELECT content, updated_at FROM project_profile WHERE id = 1'
      ).get() as { content: string; updated_at: number } | undefined;
      if (!row || !row.content) return null;
      return row;
    } catch {
      return null;
    }
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
    const now = Date.now();
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const cutoff = now - NINETY_DAYS_MS;

    // Calculate relevance for old entries and archive low-scoring ones
    const oldEntries = this.storage.prepare(
      'SELECT id, created_at, access_count FROM knowledge WHERE archived = 0 AND created_at < ?'
    ).all(cutoff) as Array<{ id: string; created_at: number; access_count: number }>;

    let pruned = 0;
    for (const entry of oldEntries) {
      const weeksOld = (now - entry.created_at) / (7 * 24 * 60 * 60 * 1000);
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
        const title = ((r.title as string) ?? '').toLowerCase();
        const content = ((r.content as string) ?? '').toLowerCase();
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
      source_type: (['explicit', 'inferred', 'observed'].includes(row.source_type as string)
        ? row.source_type as SourceType
        : 'observed'),
    };
  }
}
