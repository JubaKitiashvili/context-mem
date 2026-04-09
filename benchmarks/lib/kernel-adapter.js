/**
 * Lightweight adapter to use context-mem's storage + search directly.
 * Bypasses MCP for speed. Creates a fresh temp DB per benchmark item.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..', '..');
const { migrations } = require(path.join(projectRoot, 'dist/plugins/storage/migrations.js'));
const { sanitizeFTS5 } = require(path.join(projectRoot, 'dist/plugins/search/fts5-utils.js'));

// Stop words to filter from search queries (same as mempalace)
const STOP_WORDS = new Set([
  'what', 'when', 'where', 'who', 'how', 'which', 'did', 'do', 'does',
  'was', 'were', 'have', 'has', 'had', 'is', 'are', 'the', 'a', 'an',
  'my', 'me', 'i', 'you', 'your', 'their', 'it', 'its', 'in', 'on',
  'at', 'to', 'for', 'of', 'with', 'by', 'from', 'ago', 'last', 'that',
  'this', 'there', 'about', 'get', 'got', 'give', 'gave', 'buy', 'bought',
  'made', 'make', 'can', 'will', 'would', 'could', 'should', 'might',
]);

/**
 * Build an OR-joined FTS5 query from natural language.
 * Strips stop words, keeps meaningful terms, joins with OR for partial matching.
 */
function buildFTS5Query(query) {
  const words = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  if (words.length === 0) return null;
  // Use OR for partial matching (like embedding similarity)
  return words.map(w => `"${w}"`).join(' OR ');
}

class BenchKernel {
  constructor(opts = {}) {
    this.dbPath = opts.dbPath || path.join(os.tmpdir(), `cm-bench-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    this.db = null;
    this._insertStmt = null;
    this._searchStmt = null;
    this._counter = 0;
    this._seenIds = new Set();
    this._idMap = new Map(); // internal id → original corpus id
  }

  open() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -8192');

    // Apply migrations
    for (const m of migrations) {
      try { this.db.exec(m.up); } catch { /* already applied */ }
    }

    this._insertStmt = this.db.prepare(`
      INSERT INTO observations (id, type, content, summary, metadata, indexed_at, session_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return this;
  }

  /**
   * Ingest a document with a known corpus_id for later scoring.
   */
  ingest(corpusId, content, metadata = {}) {
    this._counter++;
    let id = corpusId;
    const now = Date.now();
    const hash = require('crypto').createHash('sha256').update(content + this._counter).digest('hex');
    const metaJson = JSON.stringify({ ...metadata, _originalId: corpusId });
    const summary = content.slice(0, 200);

    // Handle duplicate IDs by appending suffix
    if (this._seenIds.has(id)) {
      id = `${corpusId}_dup${this._counter}`;
    }
    this._seenIds.add(id);
    // Map back to original corpus ID for scoring
    this._idMap.set(id, corpusId);

    this._insertStmt.run(id, 'context', content, summary, metaJson, now, 'bench', hash);
    return id;
  }

  /**
   * Ingest many documents in a single transaction (fast).
   */
  ingestBatch(items) {
    const tx = this.db.transaction(() => {
      for (const { id, content, metadata } of items) {
        this.ingest(id, content, metadata || {});
      }
    });
    tx();
  }

  /**
   * Search using multi-strategy approach for maximum recall.
   * Returns array of { id, score } ordered by relevance.
   */
  search(query, limit = 10) {
    const seen = new Map(); // id → best score

    // Strategy 1: OR-joined meaningful terms (best for natural language questions)
    const orQuery = buildFTS5Query(query);
    if (orQuery) {
      try {
        const rows = this.db.prepare(`
          SELECT o.id, bm25(obs_fts, 1.0, 0.75) AS score
          FROM obs_fts
          JOIN observations o ON o.rowid = obs_fts.rowid
          WHERE obs_fts MATCH ?
          ORDER BY score
          LIMIT ?
        `).all(orQuery, limit * 3);
        for (const r of rows) {
          if (!seen.has(r.id) || r.score < seen.get(r.id)) seen.set(r.id, r.score);
        }
      } catch { /* fallthrough */ }
    }

    // Strategy 2: Individual high-value keyword searches (catches vocabulary gaps)
    const keywords = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
    // Search for individual important keywords separately
    for (const kw of keywords.slice(0, 5)) {
      try {
        const rows = this.db.prepare(`
          SELECT o.id, bm25(obs_fts, 1.0, 0.75) AS score
          FROM obs_fts
          JOIN observations o ON o.rowid = obs_fts.rowid
          WHERE obs_fts MATCH ?
          ORDER BY score
          LIMIT ?
        `).all(`"${kw}"`, 5);
        for (const r of rows) {
          // Individual keyword matches get a penalty (less relevant than multi-keyword)
          const penalized = (r.score || 0) + 2.0;
          if (!seen.has(r.id) || penalized < seen.get(r.id)) seen.set(r.id, penalized);
        }
      } catch { /* skip bad keywords */ }
    }

    // Strategy 3: Trigram (catches partial word matches)
    if (seen.size < limit) {
      const trigramResults = this._searchTrigram(query, limit);
      for (const r of trigramResults) {
        const penalized = (r.score || 0) + 5.0;
        if (!seen.has(r.id) || penalized < seen.get(r.id)) seen.set(r.id, penalized);
      }
    }

    // Strategy 4: LIKE fallback
    if (seen.size < limit) {
      const fallback = this._searchFallback(query, limit);
      for (const r of fallback) {
        if (!seen.has(r.id)) seen.set(r.id, 10.0);
      }
    }

    // Sort by score and return top-K
    return [...seen.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));
  }

  _searchTrigram(query, limit) {
    const sanitized = sanitizeFTS5(query);
    if (!sanitized || sanitized.length < 3) return this._searchFallback(query, limit);
    try {
      const rows = this.db.prepare(`
        SELECT o.id, bm25(obs_trigram) AS score
        FROM obs_trigram
        JOIN observations o ON o.rowid = obs_trigram.rowid
        WHERE obs_trigram MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit);
      return rows;
    } catch {
      return this._searchFallback(query, limit);
    }
  }

  _searchFallback(query, limit) {
    // LIKE-based substring search as ultimate fallback
    const rows = this.db.prepare(`
      SELECT id, 0 AS score FROM observations
      WHERE content LIKE ? OR summary LIKE ?
      ORDER BY indexed_at DESC
      LIMIT ?
    `).all(`%${query.slice(0, 100)}%`, `%${query.slice(0, 100)}%`, limit);
    return rows;
  }

  /**
   * Search knowledge base (for benchmarks that test knowledge retrieval).
   */
  searchKnowledge(query, limit = 10) {
    const sanitized = sanitizeFTS5(query);
    if (!sanitized || sanitized.trim().length < 2) return [];
    try {
      return this.db.prepare(`
        SELECT k.id, k.title, k.content, bm25(knowledge_fts, 1.0, 0.75) AS score
        FROM knowledge_fts
        JOIN knowledge k ON k.rowid = knowledge_fts.rowid
        WHERE knowledge_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(sanitized, limit);
    } catch {
      return [];
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    try { fs.unlinkSync(this.dbPath); } catch { /* ok */ }
  }

  /** Resolve an internal ID back to the original corpus ID */
  resolveId(id) {
    return this._idMap.get(id) || id;
  }

  /** Get total observations count */
  get count() {
    if (!this.db) return 0;
    const row = this.db.prepare('SELECT COUNT(*) as c FROM observations').get();
    return row.c;
  }
}

module.exports = { BenchKernel };
