/**
 * Lightweight adapter to use context-mem's storage + search directly.
 * Bypasses MCP for speed. Creates a fresh temp DB per benchmark item.
 * Supports hybrid search: FTS5 BM25 + vector cosine similarity.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..', '..');
const { migrations } = require(path.join(projectRoot, 'dist/plugins/storage/migrations.js'));
const { sanitizeFTS5 } = require(path.join(projectRoot, 'dist/plugins/search/fts5-utils.js'));

// Stop words to filter from search queries
const STOP_WORDS = new Set([
  'what', 'when', 'where', 'who', 'how', 'which', 'did', 'do', 'does',
  'was', 'were', 'have', 'has', 'had', 'is', 'are', 'the', 'a', 'an',
  'my', 'me', 'i', 'you', 'your', 'their', 'it', 'its', 'in', 'on',
  'at', 'to', 'for', 'of', 'with', 'by', 'from', 'ago', 'last', 'that',
  'this', 'there', 'about', 'get', 'got', 'give', 'gave', 'buy', 'bought',
  'made', 'make', 'can', 'will', 'would', 'could', 'should', 'might',
]);

// Query expansion: add related terms to improve recall
const EXPANSIONS = {
  recommend: ['suggest', 'prefer', 'like', 'enjoy', 'favorite', 'love'],
  suggest: ['recommend', 'prefer', 'like', 'favorite'],
  movie: ['film', 'show', 'series', 'watch', 'cinema'],
  show: ['movie', 'series', 'watch', 'program'],
  dinner: ['food', 'meal', 'cook', 'recipe', 'eat', 'restaurant'],
  activity: ['hobby', 'sport', 'exercise', 'game', 'fun'],
  evening: ['night', 'weekend', 'free time', 'relax'],
  accessories: ['equipment', 'gear', 'tools', 'supplies'],
  photography: ['camera', 'photo', 'lens', 'shoot'],
  violin: ['music', 'instrument', 'practice', 'play'],
  exercise: ['workout', 'gym', 'fitness', 'run', 'sport'],
  ingredients: ['food', 'cook', 'garden', 'grow', 'recipe'],
  serve: ['cook', 'make', 'prepare', 'meal'],
  schedule: ['time', 'meeting', 'calendar', 'plan'],
  tool: ['app', 'software', 'platform', 'service'],
  email: ['message', 'follow-up', 'outreach', 'send'],
  performance: ['review', 'metrics', 'results', 'goals'],
  hobby: ['interest', 'activity', 'passion', 'enjoy'],
};

function buildFTS5Query(query) {
  const words = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  if (words.length === 0) return null;
  // Expand with synonyms
  const expanded = new Set(words);
  for (const w of words) {
    if (Object.prototype.hasOwnProperty.call(EXPANSIONS, w)) {
      EXPANSIONS[w].forEach(s => expanded.add(s));
    }
  }
  return [...expanded].map(w => `"${w}"`).join(' OR ');
}

// ── Vector search helpers ───────────────────────────────────────────────────
let _embedder = null;
let _embedderLoading = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  if (_embedderLoading) return _embedderLoading;
  _embedderLoading = (async () => {
    try {
      const { Embedder } = require(path.join(projectRoot, 'dist/plugins/search/embedder.js'));
      if (await Embedder.isAvailable()) {
        // Warm up pipeline
        await Embedder.embed('warmup');
        _embedder = Embedder;
        return Embedder;
      }
    } catch {}
    return null;
  })();
  return _embedderLoading;
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── BenchKernel ─────────────────────────────────────────────────────────────

class BenchKernel {
  constructor(opts = {}) {
    this.dbPath = opts.dbPath || path.join(os.tmpdir(), `cm-bench-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    this.db = null;
    this._insertStmt = null;
    this._updateEmbedStmt = null;
    this._counter = 0;
    this._seenIds = new Set();
    this._idMap = new Map();
    this._embeddings = new Map(); // id → Float32Array
    this._useVector = opts.vector !== false; // enabled by default
  }

  open() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -8192');

    for (const m of migrations) {
      try { this.db.exec(m.up); } catch { /* already applied */ }
    }

    this._insertStmt = this.db.prepare(`
      INSERT INTO observations (id, type, content, summary, metadata, indexed_at, session_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this._updateEmbedStmt = this.db.prepare(
      'UPDATE observations SET embeddings = ? WHERE id = ?'
    );

    return this;
  }

  ingest(corpusId, content, metadata = {}) {
    this._counter++;
    let id = corpusId;
    const now = Date.now();
    const hash = crypto.createHash('sha256').update(content + this._counter).digest('hex');
    const metaJson = JSON.stringify({ ...metadata, _originalId: corpusId });
    const summary = content.slice(0, 200);

    if (this._seenIds.has(id)) {
      id = `${corpusId}_dup${this._counter}`;
    }
    this._seenIds.add(id);
    this._idMap.set(id, corpusId);

    this._insertStmt.run(id, 'context', content, summary, metaJson, now, 'bench', hash);
    return id;
  }

  /**
   * Embed all ingested documents. Call once after all ingests.
   * Stores embeddings in SQLite + in-memory cache for fast search.
   */
  async embedAll() {
    const embedder = await getEmbedder();
    if (!embedder) return 0;

    const rows = this.db.prepare('SELECT id, summary, content FROM observations').all();
    let count = 0;

    for (const row of rows) {
      try {
        // Dual embedding: embed both summary (focused) and content (comprehensive)
        // Store as { summary, content } so search can take best match
        const summaryEmb = await embedder.embed(row.summary || row.content.slice(0, 200));
        const contentEmb = row.content.length > 200 ? await embedder.embed(row.content) : summaryEmb;
        if (summaryEmb) {
          this._updateEmbedStmt.run(embedder.toBuffer(summaryEmb), row.id);
          this._embeddings.set(row.id, { summary: summaryEmb, content: contentEmb || summaryEmb });
          count++;
        }
      } catch { /* skip */ }
    }

    return count;
  }

  /**
   * Hybrid search: FTS5 BM25 + vector cosine similarity, merged by score.
   */
  search(query, limit = 10) {
    const seen = new Map(); // id → best score (lower = better for BM25, we normalize)

    // ── FTS5 BM25 search ────────────────────────────────────────────────────
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
          // BM25 scores are negative (lower = better), normalize to positive relevance
          const relevance = Math.abs(r.score);
          if (!seen.has(r.id) || relevance > seen.get(r.id)) seen.set(r.id, relevance);
        }
      } catch { /* fallthrough */ }
    }

    // Individual keyword searches
    const keywords = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
    for (const kw of keywords.slice(0, 5)) {
      try {
        const rows = this.db.prepare(`
          SELECT o.id, bm25(obs_fts, 1.0, 0.75) AS score
          FROM obs_fts JOIN observations o ON o.rowid = obs_fts.rowid
          WHERE obs_fts MATCH ? ORDER BY score LIMIT 5
        `).all(`"${kw}"`, 5);
        for (const r of rows) {
          const relevance = Math.abs(r.score) * 0.5; // penalty for single keyword
          if (!seen.has(r.id) || relevance > seen.get(r.id)) seen.set(r.id, relevance);
        }
      } catch {}
    }

    // Trigram fallback
    if (seen.size < limit) {
      const trigramResults = this._searchTrigram(query, limit);
      for (const r of trigramResults) {
        const relevance = Math.abs(r.score) * 0.3;
        if (!seen.has(r.id)) seen.set(r.id, relevance);
      }
    }

    // ── Vector search (dual embedding: max of summary + content similarity) ──
    if (this._useVector && this._queryEmbedding) {
      for (const [docId, docEmb] of this._embeddings) {
        // Take max similarity from summary and content embeddings
        const simSummary = docEmb.summary ? cosineSimilarity(this._queryEmbedding, docEmb.summary) : 0;
        const simContent = docEmb.content ? cosineSimilarity(this._queryEmbedding, docEmb.content) : 0;
        const sim = Math.max(simSummary, simContent);
        if (sim >= 0.15) {
          const relevance = sim * 8.0;
          if (!seen.has(docId)) {
            seen.set(docId, relevance);
          } else {
            // Strong multi-match boost: found by both FTS5 and vector
            seen.set(docId, seen.get(docId) + relevance);
          }
        }
      }
    }

    // ── Reranker: keyword density + exact phrase + bigram matching ────────
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    // Build bigrams from query
    const queryBigrams = [];
    for (let i = 0; i < queryWords.length - 1; i++) {
      queryBigrams.push(queryWords[i] + ' ' + queryWords[i + 1]);
    }

    if (queryWords.length > 0 && seen.size > 0) {
      // Fetch content for all candidates
      const ids = [...seen.keys()];
      const placeholders = ids.map(() => '?').join(',');
      let contentMap;
      try {
        const rows = this.db.prepare(`SELECT id, content FROM observations WHERE id IN (${placeholders})`).all(...ids);
        contentMap = new Map(rows.map(r => [r.id, r.content.toLowerCase()]));
      } catch {
        contentMap = new Map();
      }

      for (const [id, baseScore] of seen) {
        const content = contentMap.get(id);
        if (!content) continue;

        // Keyword density: what fraction of query keywords appear in this doc
        const keywordHits = queryWords.filter(w => content.includes(w)).length;
        const density = keywordHits / queryWords.length;

        // Bigram matching: consecutive query words appearing together
        const bigramHits = queryBigrams.filter(bg => content.includes(bg)).length;
        const bigramScore = queryBigrams.length > 0 ? bigramHits / queryBigrams.length : 0;

        // Exact phrase match (huge boost)
        const phraseMatch = content.includes(queryLower.replace(/[^\w\s]/g, '').trim().slice(0, 50)) ? 2.0 : 0;

        // Combined rerank score
        const boost = density * 3.0 + bigramScore * 2.0 + phraseMatch;
        seen.set(id, baseScore + boost);
      }
    }

    // Sort by relevance (higher = better) and return top-K
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));
  }

  /**
   * Async search with vector embedding of query.
   * Use this instead of search() when vector search is enabled.
   */
  async searchAsync(query, limit = 10) {
    // Embed the query
    if (this._useVector && this._embeddings.size > 0) {
      const embedder = await getEmbedder();
      if (embedder) {
        try {
          this._queryEmbedding = await embedder.embed(query);
        } catch {
          this._queryEmbedding = null;
        }
      }
    }
    return this.search(query, limit);
  }

  _searchTrigram(query, limit) {
    const sanitized = sanitizeFTS5(query);
    if (!sanitized || sanitized.length < 3) return [];
    try {
      return this.db.prepare(`
        SELECT o.id, bm25(obs_trigram) AS score
        FROM obs_trigram JOIN observations o ON o.rowid = obs_trigram.rowid
        WHERE obs_trigram MATCH ? ORDER BY score LIMIT ?
      `).all(sanitized, limit);
    } catch { return []; }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._embeddings.clear();
    this._queryEmbedding = null;
    try { fs.unlinkSync(this.dbPath); } catch {}
  }

  resolveId(id) {
    return this._idMap.get(id) || id;
  }

  get count() {
    if (!this.db) return 0;
    return this.db.prepare('SELECT COUNT(*) as c FROM observations').get().c;
  }
}

module.exports = { BenchKernel, getEmbedder };
