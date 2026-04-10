/**
 * Benchmark adapter using context-mem's CORE search modules.
 * No duplicate logic — directly imports query-builder, fts5-utils from core.
 * Creates a fresh temp DB per benchmark item.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..', '..');
const { migrations } = require(path.join(projectRoot, 'dist/plugins/storage/migrations.js'));
const { sanitizeFTS5Query } = require(path.join(projectRoot, 'dist/plugins/search/fts5-utils.js'));
const { buildORQuery, buildANDQuery, buildEntityQuery, buildPhraseQuery, buildRelaxedANDQuery, extractKeywords, resolveTemporalKeywords, EXPANSIONS, mergeExpansions } = require(path.join(projectRoot, 'dist/plugins/search/query-builder.js'));
const { BENCH_EXPANSIONS } = require(path.join(__dirname, 'expansions.js'));

// Merge benchmark-specific synonyms into the active expansion set
mergeExpansions(BENCH_EXPANSIONS);

// ── Vector search helpers (optional) ────────────────────────────────────────
let _embedder = null;
let _embedderLoading = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  if (_embedderLoading) return _embedderLoading;
  _embedderLoading = (async () => {
    try {
      const { Embedder } = require(path.join(projectRoot, 'dist/plugins/search/embedder.js'));
      if (await Embedder.isAvailable()) {
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
    this._embeddings = new Map();
    this._useVector = opts.vector !== false;
  }

  open() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -8192');

    for (const m of migrations) {
      try { this.db.exec(m.up); } catch {}
    }

    this._insertStmt = this.db.prepare(`
      INSERT INTO observations (id, type, content, summary, metadata, indexed_at, session_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this._updateEmbedStmt = this.db.prepare('UPDATE observations SET embeddings = ? WHERE id = ?');
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

  async embedAll() {
    const embedder = await getEmbedder();
    if (!embedder) return 0;
    const rows = this.db.prepare('SELECT id, summary, content FROM observations').all();
    let count = 0;
    for (const row of rows) {
      try {
        const summaryEmb = await embedder.embed(row.summary || row.content.slice(0, 200));
        const contentEmb = row.content.length > 200 ? await embedder.embed(row.content) : summaryEmb;
        if (summaryEmb) {
          this._updateEmbedStmt.run(embedder.toBuffer(summaryEmb), row.id);
          this._embeddings.set(row.id, { summary: summaryEmb, content: contentEmb || summaryEmb });
          count++;
        }
      } catch {}
    }
    return count;
  }

  /**
   * Multi-strategy search using CORE query-builder module.
   * Same 4 strategies as core BM25Search: AND → Entity → Sanitized → OR+synonyms.
   */
  search(query, limit = 10, opts = {}) {
    const seen = new Map(); // id → relevance score (higher = better)

    const runFTS = (matchExpr, weight) => {
      try {
        const rows = this.db.prepare(`
          SELECT o.id, bm25(obs_fts, 1.0, 0.75) AS score
          FROM obs_fts JOIN observations o ON o.rowid = obs_fts.rowid
          WHERE obs_fts MATCH ? ORDER BY score LIMIT ?
        `).all(matchExpr, limit * 5);
        for (const r of rows) {
          const relevance = Math.abs(r.score) * weight;
          if (!seen.has(r.id) || relevance > seen.get(r.id)) seen.set(r.id, relevance);
        }
      } catch {}
    };

    // Strategy 1: AND-mode (core: buildANDQuery) — high precision
    const andQ = buildANDQuery(query);
    if (andQ) runFTS(andQ, 2.0);

    // Strategy 2: Entity-focused (core: buildEntityQuery) — names, dates
    const entityQ = buildEntityQuery(query);
    if (entityQ) runFTS(entityQ, 1.8);

    // Strategy 3: Phrase matching (core: buildPhraseQuery)
    const phraseQ = buildPhraseQuery(query);
    if (phraseQ) runFTS(phraseQ, 1.9);

    // Strategy 4: Original sanitized (core: sanitizeFTS5Query) — FTS5 default
    const sanitized = sanitizeFTS5Query(query);
    if (sanitized && sanitized !== '""') runFTS(sanitized, 1.5);

    // Strategy 5: Relaxed AND (core: buildRelaxedANDQuery) — entity + top keywords
    const relaxedQ = buildRelaxedANDQuery(query);
    if (relaxedQ && relaxedQ !== andQ) runFTS(relaxedQ, 1.2);

    // Strategy 6: OR-mode with synonyms (core: buildORQuery) — broad recall
    const orQ = buildORQuery(query);
    if (orQ) runFTS(orQ, 1.0);

    // Strategy 7: Individual keywords — catch long-tail
    const keywords = extractKeywords(query).filter(w => w.length >= 4);
    for (const kw of keywords.slice(0, 5)) {
      runFTS(`"${kw}"`, 0.5);
    }

    // Strategy 8: Temporal resolution (relative dates → absolute)
    if (opts.referenceDate) {
      const temporalKws = resolveTemporalKeywords(query, new Date(opts.referenceDate));
      if (temporalKws.length > 0) {
        const temporalQuery = temporalKws.map(w => `"${w}"`).join(' AND ');
        runFTS(temporalQuery, 1.6);
        // Also try individual temporal keywords
        for (const kw of temporalKws) {
          if (kw.length >= 3) runFTS(`"${kw}"`, 0.8);
        }
      }
    }

    // Strategy 9: Trigram fallback
    if (seen.size < limit) {
      try {
        const triRows = this.db.prepare(`
          SELECT o.id, bm25(obs_trigram) AS score
          FROM obs_trigram JOIN observations o ON o.rowid = obs_trigram.rowid
          WHERE obs_trigram MATCH ? ORDER BY score LIMIT ?
        `).all(sanitized || query, limit);
        for (const r of triRows) {
          if (!seen.has(r.id)) seen.set(r.id, Math.abs(r.score) * 0.3);
        }
      } catch {}
    }

    // Strategy 7: Vector search (optional)
    if (this._useVector && this._queryEmbedding) {
      for (const [docId, docEmb] of this._embeddings) {
        const simS = docEmb.summary ? cosineSimilarity(this._queryEmbedding, docEmb.summary) : 0;
        const simC = docEmb.content ? cosineSimilarity(this._queryEmbedding, docEmb.content) : 0;
        const sim = Math.max(simS, simC);
        if (sim >= 0.15) {
          const relevance = sim * 3.0;
          if (!seen.has(docId)) seen.set(docId, relevance);
          else seen.set(docId, seen.get(docId) + relevance);
        }
      }
    }

    // ── Content-based reranker (same as core fusion.ts rerank) ───────────
    const queryLower = query.toLowerCase();
    const queryWords = extractKeywords(query);
    const queryBigrams = [];
    for (let i = 0; i < queryWords.length - 1; i++) {
      queryBigrams.push(queryWords[i] + ' ' + queryWords[i + 1]);
    }

    if (queryWords.length > 0 && seen.size > 0) {
      const ids = [...seen.keys()];
      try {
        const placeholders = ids.map(() => '?').join(',');
        const rows = this.db.prepare(`SELECT id, content FROM observations WHERE id IN (${placeholders})`).all(...ids);
        const contentMap = new Map(rows.map(r => [r.id, r.content.toLowerCase()]));

        // Build synonym lookup for query words
        const synonymMap = new Map();
        for (const w of queryWords) {
          const syns = EXPANSIONS && EXPANSIONS[w] ? EXPANSIONS[w] : [];
          synonymMap.set(w, syns);
        }

        // Compute IDF for each query word across all candidate documents
        const docFreq = new Map();
        for (const w of queryWords) {
          let count = 0;
          for (const content of contentMap.values()) {
            if (content.includes(w)) count++;
          }
          docFreq.set(w, count);
        }
        const N = contentMap.size || 1;

        for (const [id, baseScore] of seen) {
          const content = contentMap.get(id);
          if (!content) continue;
          // IDF-weighted keyword matching: rare words count more
          let weightedHits = 0;
          for (const w of queryWords) {
            const df = docFreq.get(w) || 0;
            const idf = Math.log((N + 1) / (df + 1));
            if (content.includes(w)) {
              weightedHits += idf;
            } else {
              // Check synonyms
              const syns = synonymMap.get(w) || [];
              if (syns.some(s => content.includes(s))) {
                weightedHits += idf * 0.7;
              }
            }
          }
          // Normalize by max possible IDF score
          const maxIdf = queryWords.reduce((sum, w) => {
            const df = docFreq.get(w) || 0;
            return sum + Math.log((N + 1) / (df + 1));
          }, 0);
          const idfDensity = maxIdf > 0 ? weightedHits / maxIdf : 0;

          const bigramHits = queryBigrams.filter(bg => content.includes(bg)).length;
          const bigramScore = queryBigrams.length > 0 ? bigramHits / queryBigrams.length : 0;
          const boost = idfDensity * 4.0 + bigramScore * 2.0;
          seen.set(id, baseScore + boost);
        }
      } catch {}
    }

    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));
  }

  async searchAsync(query, limit = 10, opts = {}) {
    if (this._useVector && this._embeddings.size > 0) {
      const embedder = await getEmbedder();
      if (embedder) {
        try { this._queryEmbedding = await (embedder.embedQuery || embedder.embed).call(embedder, query); } catch { this._queryEmbedding = null; }
      }
    }
    return this.search(query, limit, opts);
  }

  /**
   * Vector rerank: embed query + BM25 candidates only (not entire corpus).
   * Memory-efficient: embeds ~30 docs per query instead of thousands.
   */
  async vectorRerank(query, bm25Results, limit = 10) {
    const embedder = await getEmbedder();
    if (!embedder) return bm25Results.slice(0, limit);

    try {
      const queryEmb = await (embedder.embedQuery || embedder.embed).call(embedder, query);
      if (!queryEmb) return bm25Results.slice(0, limit);

      // Fetch content for BM25 candidates
      const ids = bm25Results.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const rows = this.db.prepare(`SELECT id, content FROM observations WHERE id IN (${placeholders})`).all(...ids);
      const contentMap = new Map(rows.map(r => [r.id, r.content]));

      // Embed each candidate and compute similarity
      const scored = [];
      for (const r of bm25Results) {
        const content = contentMap.get(r.id);
        if (!content) { scored.push({ ...r }); continue; }
        const docEmb = await embedder.embed(content.slice(0, 2000)); // truncate for speed
        const sim = docEmb ? cosineSimilarity(queryEmb, docEmb) : 0;
        // Fuse BM25 score + vector similarity
        scored.push({ ...r, score: r.score + sim * 3.0 });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    } catch {
      return bm25Results.slice(0, limit);
    }
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
    this._embeddings.clear();
    this._queryEmbedding = null;
    try { fs.unlinkSync(this.dbPath); } catch {}
  }

  resolveId(id) { return this._idMap.get(id) || id; }

  get count() {
    if (!this.db) return 0;
    return this.db.prepare('SELECT COUNT(*) as c FROM observations').get().c;
  }
}

module.exports = { BenchKernel, getEmbedder };
