import type { StoragePlugin, KnowledgeEntry, KnowledgeCategory, SourceType, ContradictionWarning } from '../../core/types.js';
import { ulid } from '../../core/utils.js';
import { sanitizeFTS5 } from '../search/fts5-utils.js';
import { Embedder } from '../search/embedder.js';
import { generateTitle, generateTags } from '../../core/auto-tagger.js';

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
    const now = Date.now();

    // Auto-generate title if too short or generic
    if (!entry.title || entry.title.trim().length < 5) {
      entry.title = generateTitle(entry.content);
    }
    // Auto-generate tags if empty
    if (!entry.tags || entry.tags.length === 0) {
      entry.tags = generateTags(entry.content);
    }

    const knowledge: KnowledgeEntry = {
      id: ulid(),
      category: entry.category,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || [],
      shareable: entry.shareable !== false,
      relevance_score: 1.0,
      access_count: 0,
      created_at: now,
      last_accessed: now,
      archived: false,
      source_type: entry.source_type || 'observed',
    };

    this.storage.exec(
      'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, last_accessed, archived, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [knowledge.id, knowledge.category, knowledge.title, knowledge.content, JSON.stringify(knowledge.tags), knowledge.shareable ? 1 : 0, knowledge.relevance_score, knowledge.access_count, knowledge.created_at, knowledge.last_accessed, knowledge.archived ? 1 : 0, knowledge.source_type]
    );

    return knowledge;
  }

  async checkContradictions(title: string, content: string, category: KnowledgeCategory): Promise<ContradictionWarning[]> {
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

    // Layer 3: Semantic vector similarity (optional — requires @huggingface/transformers)
    const candidateIds = new Set(candidates.map(c => c.id as string));
    try {
      const vectorCandidates = await this.findSemanticCandidates(title, content, category);
      for (const vc of vectorCandidates) {
        if (!candidateIds.has(vc.id as string)) {
          candidates.push(vc);
          candidateIds.add(vc.id as string);
        }
      }
    } catch {
      // Vector search unavailable — skip silently
    }

    if (candidates.length === 0) return [];

    // Build contradiction warnings
    const warnings: ContradictionWarning[] = [];
    for (const c of candidates) {
      const existingTitle = (c.title as string) ?? '';
      const existingContent = ((c.content as string) ?? '').slice(0, 200);

      // Determine similarity reason
      let reason = (c._similarity_reason as string) || 'similar topic';
      if (!c._similarity_reason) {
        const titleLower = title.toLowerCase();
        const existingLower = existingTitle.toLowerCase();
        if (titleLower === existingLower) {
          reason = 'identical title';
        } else if (titleLower.includes(existingLower) || existingLower.includes(titleLower)) {
          reason = 'overlapping title';
        }
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

  /**
   * Use vector embeddings to find semantically similar knowledge entries.
   * Returns entries with cosine similarity >= 0.75.
   * Silently returns [] if embeddings are unavailable.
   */
  private async findSemanticCandidates(
    title: string,
    content: string,
    category: KnowledgeCategory,
  ): Promise<Array<Record<string, unknown>>> {
    if (!(await Embedder.isAvailable())) return [];

    const newEmbedding = await Embedder.embed(`${title} ${content}`);
    if (!newEmbedding) return [];

    // Fetch existing entries in the same category to compare
    const existingEntries = this.storage.prepare(
      'SELECT id, title, content FROM knowledge WHERE archived = 0 AND category = ? ORDER BY created_at DESC LIMIT 50'
    ).all(category) as Array<Record<string, unknown>>;

    const SEMANTIC_THRESHOLD = 0.75;
    const results: Array<Record<string, unknown>> = [];

    for (const entry of existingEntries) {
      const entryText = `${(entry.title as string) ?? ''} ${(entry.content as string) ?? ''}`;
      const entryEmbedding = await Embedder.embed(entryText);
      if (!entryEmbedding) continue;

      const similarity = Embedder.cosineSimilarity(newEmbedding, entryEmbedding);
      if (similarity >= SEMANTIC_THRESHOLD) {
        results.push({
          ...entry,
          _similarity_reason: `semantic similarity (vector: ${similarity.toFixed(2)})`,
        });
      }
    }

    return results;
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

  search(query: string, opts: { category?: KnowledgeCategory; limit?: number } = {}, sessionId?: string): KnowledgeEntry[] {
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

    // Apply relevance decay based on age and access frequency
    const now = Date.now();
    const DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

    results = results.map(entry => {
      const age = now - entry.created_at;
      // Explicit entries decay at 0.8x the rate (slower decay)
      const effectiveAge = entry.source_type === 'explicit' ? age * 0.8 : age;
      const decayFactor = Math.pow(0.5, effectiveAge / DECAY_HALF_LIFE_MS);
      const accessBoost = Math.log2((entry.access_count || 0) + 2);
      // Combine: base relevance * decay, boosted by access frequency
      return {
        ...entry,
        relevance_score: (entry.relevance_score || 1) * (0.5 + 0.3 * decayFactor + 0.2 * (accessBoost / 10)),
      };
    }).sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

    // Increment access counts and update last_accessed for results
    for (const entry of results) {
      this.storage.exec(
        'UPDATE knowledge SET access_count = access_count + 1, last_accessed = ? WHERE id = ?',
        [now, entry.id]
      );
    }

    // Record session access for auto-promote tracking
    if (sessionId) {
      const now2 = Date.now();
      for (const entry of results) {
        try {
          this.storage.exec(
            'INSERT OR IGNORE INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
            [entry.id, sessionId, now2]
          );
        } catch {
          // session_access_log table may not exist (pre-v11) — ignore
        }
      }
    }

    return results;
  }

  access(id: string): KnowledgeEntry | null {
    const row = this.storage.prepare(
      'SELECT * FROM knowledge WHERE id = ? AND archived = 0'
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    // Increment access count and update last_accessed
    this.storage.exec(
      'UPDATE knowledge SET access_count = access_count + 1, last_accessed = ? WHERE id = ?',
      [Date.now(), id]
    );

    return this.rowToEntry(row);
  }

  /** Get entry by ID (including archived entries). Does NOT increment access count. */
  getById(id: string): KnowledgeEntry | null {
    const row = this.storage.prepare(
      'SELECT * FROM knowledge WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  /** Archive a knowledge entry by setting archived = 1. */
  archive(id: string): boolean {
    const row = this.storage.prepare('SELECT id FROM knowledge WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return false;
    this.storage.exec('UPDATE knowledge SET archived = 1 WHERE id = ?', [id]);
    return true;
  }

  /** Update tags on a knowledge entry (merges with existing). */
  addTags(id: string, tags: string[]): boolean {
    const entry = this.getById(id);
    if (!entry) return false;
    const merged = Array.from(new Set([...entry.tags, ...tags]));
    this.storage.exec('UPDATE knowledge SET tags = ? WHERE id = ?', [JSON.stringify(merged), id]);
    return true;
  }

  computeConfidence(entry: KnowledgeEntry, sessionCount?: number): number {
    const now = Date.now();
    const HALF_LIFE = 14 * 24 * 60 * 60 * 1000;

    // Source weight: explicit > inferred > observed
    const sourceWeights: Record<string, number> = { explicit: 1.0, inferred: 0.6, observed: 0.4 };
    const sourceWeight = sourceWeights[entry.source_type] ?? 0.4;

    // Freshness decay
    const age = now - entry.created_at;
    const freshness = Math.pow(0.5, age / HALF_LIFE);

    // Access frequency (capped at 1.0)
    const accessFreq = Math.min(1.0, Math.log2((entry.access_count || 0) + 2) / 10);

    // Session spread (if available)
    let sessionSpread = 0;
    if (sessionCount !== undefined) {
      sessionSpread = Math.min(1.0, sessionCount / 5);
    } else {
      // Try to get from session_access_log
      try {
        const row = this.storage.prepare(
          'SELECT COUNT(DISTINCT session_id) as cnt FROM session_access_log WHERE knowledge_id = ?'
        ).get(entry.id) as { cnt: number } | undefined;
        sessionSpread = Math.min(1.0, (row?.cnt || 0) / 5);
      } catch {
        sessionSpread = 0;
      }
    }

    // Contradiction-free (check stale flag and contradiction_count)
    let contradictionFree = 1.0;
    try {
      const row = this.storage.prepare(
        'SELECT stale, contradiction_count FROM knowledge WHERE id = ?'
      ).get(entry.id) as { stale: number; contradiction_count: number } | undefined;
      if (row) {
        if (row.stale) contradictionFree = 0.3;
        else if (row.contradiction_count > 0) contradictionFree = 0.5;
      }
    } catch {
      // pre-v12 or missing column
    }

    const confidence = (
      sourceWeight * 0.3 +
      freshness * 0.25 +
      accessFreq * 0.2 +
      sessionSpread * 0.15 +
      contradictionFree * 0.1
    );

    return Math.max(0, Math.min(1, confidence));
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
      last_accessed: (row.last_accessed as number) || (row.created_at as number),
      archived: !!(row.archived as number),
      source_type: (['explicit', 'inferred', 'observed'].includes(row.source_type as string)
        ? row.source_type as SourceType
        : 'observed'),
    };
  }
}
