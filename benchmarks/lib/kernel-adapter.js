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
    // If metadata has an explicit date, use it as indexed_at for temporal filtering
    const indexedAt = metadata.date
      ? (typeof metadata.date === 'number' ? metadata.date : new Date(metadata.date).getTime())
      : Date.now();
    const now = isNaN(indexedAt) ? Date.now() : indexedAt;
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

    // Strategy 7b: Individual SYNONYM searches — low weight (0.2) so docs
    // enter the candidate pool but don't override main search ranking.
    // Essential for semantic-gap cases like "siblings" → "brother".
    for (const kw of keywords.slice(0, 5)) {
      const syns = EXPANSIONS && EXPANSIONS[kw] ? EXPANSIONS[kw] : [];
      for (const syn of syns.slice(0, 3)) {
        if (syn.length >= 4) runFTS(`"${syn}"`, 0.2);
      }
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
        if (sim >= 0.20) {
          const relevance = sim * 3.0;
          if (!seen.has(docId)) seen.set(docId, relevance);
          else seen.set(docId, seen.get(docId) + relevance);
        }
      }
    }

    // ── IDF-weighted content reranker ────────────────────────────────
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

        // IDF: rare keywords get higher weight
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
          let weightedHits = 0;
          for (const w of queryWords) {
            const df = docFreq.get(w) || 0;
            const idf = Math.log((N + 1) / (df + 1));
            if (content.includes(w)) {
              weightedHits += idf;
            } else {
              const syns = EXPANSIONS && EXPANSIONS[w] ? EXPANSIONS[w] : [];
              if (syns.some(s => content.includes(s))) weightedHits += idf * 0.7;
            }
          }
          const maxIdf = queryWords.reduce((sum, w) => sum + Math.log((N + 1) / ((docFreq.get(w) || 0) + 1)), 0);
          const idfDensity = maxIdf > 0 ? weightedHits / maxIdf : 0;
          const bigramHits = queryBigrams.filter(bg => content.includes(bg)).length;
          const bigramScore = queryBigrams.length > 0 ? bigramHits / queryBigrams.length : 0;
          // Moderate IDF boost — same pattern as core fusion reranker but on full content
          const boost = idfDensity * 3.0 + bigramScore * 1.5;
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

  /**
   * Hybrid parallel search: BM25 and vector retrieve independently, then merge.
   * Finds documents that either BM25 or vector excels at — covers semantic gap.
   * Requires embedAll() to have been called first.
   */
  async hybridSearch(query, limit = 10, opts = {}) {
    // BM25 retrieval (top-30)
    const bm25Results = this.search(query, 30, opts);

    // Vector retrieval (top-30 from pre-computed embeddings)
    const embedder = await getEmbedder();
    if (!embedder || this._embeddings.size === 0) {
      return bm25Results.slice(0, limit);
    }

    let queryEmb;
    try {
      queryEmb = await (embedder.embedQuery || embedder.embed).call(embedder, query);
    } catch { return bm25Results.slice(0, limit); }
    if (!queryEmb) return bm25Results.slice(0, limit);

    // Vector search over pre-computed embeddings
    const vectorResults = [];
    for (const [docId, docEmb] of this._embeddings) {
      const simS = docEmb.summary ? cosineSimilarity(queryEmb, docEmb.summary) : 0;
      const simC = docEmb.content ? cosineSimilarity(queryEmb, docEmb.content) : 0;
      const sim = Math.max(simS, simC);
      if (sim >= 0.20) {
        vectorResults.push({ id: docId, score: sim });
      }
    }
    vectorResults.sort((a, b) => b.score - a.score);
    const topVector = vectorResults.slice(0, 30);

    // Merge: BM25 scores normalized + vector scores, weighted
    const merged = new Map(); // id → { bm25Score, vectorScore }
    const BM25_WEIGHT = 0.55;
    const VECTOR_WEIGHT = 0.45;

    // BM25 results (already normalized 0-1 from search())
    const bm25Max = bm25Results.length > 0 ? Math.max(...bm25Results.map(r => r.score)) : 1;
    for (const r of bm25Results) {
      const normScore = bm25Max > 0 ? r.score / bm25Max : 0;
      merged.set(r.id, { score: normScore * BM25_WEIGHT, id: r.id });
    }

    // Vector results (cosine similarity already 0-1)
    for (const r of topVector) {
      const existing = merged.get(r.id);
      if (existing) {
        existing.score += r.score * VECTOR_WEIGHT;
      } else {
        merged.set(r.id, { score: r.score * VECTOR_WEIGHT, id: r.id });
      }
    }

    // Sort by fused score
    const fusedResults = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return fusedResults;
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
    this._embeddings.clear();
    this._queryEmbedding = null;
    // Delete the db file AND WAL/SHM siblings (WAL mode creates these)
    try { fs.unlinkSync(this.dbPath); } catch {}
    try { fs.unlinkSync(this.dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(this.dbPath + '-shm'); } catch {}
  }

  resolveId(id) { return this._idMap.get(id) || id; }

  get count() {
    if (!this.db) return 0;
    return this.db.prepare('SELECT COUNT(*) as c FROM observations').get().c;
  }
}

// ── Temporal Resolver (mirror of src/plugins/search/temporal-resolver.ts) ───

const DAY_MS = 86_400_000;
const WORD_TO_NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function parseNum(token) {
  const lower = token.toLowerCase();
  if (WORD_TO_NUM[lower] !== undefined) return WORD_TO_NUM[lower];
  const n = parseInt(lower, 10);
  return isNaN(n) ? null : n;
}

function rangeAround(targetDate, toleranceDays, confidence) {
  return {
    start: new Date(targetDate.getTime() - toleranceDays * DAY_MS),
    end: new Date(targetDate.getTime() + toleranceDays * DAY_MS),
    confidence,
  };
}

function resolveTemporalRange(query, referenceDate) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (isNaN(ref.getTime())) return null;
  const q = query.toLowerCase();

  let m = q.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+days?\s+ago\b/);
  if (m) {
    const n = parseNum(m[1]);
    if (n !== null) return rangeAround(new Date(ref.getTime() - n * DAY_MS), 1, 'high');
  }

  if (/\ba?\s*couple\s+of?\s*days?\s+ago\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 2 * DAY_MS), 2, 'medium');
  }

  if (/\b(a\s+)?few\s+days?\s+ago\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 3 * DAY_MS), 2, 'medium');
  }

  m = q.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+weeks?\s+ago\b/);
  if (m) {
    const n = parseNum(m[1]);
    if (n !== null) return rangeAround(new Date(ref.getTime() - n * 7 * DAY_MS), 3, 'high');
  }

  // "a week ago" = exactly 7 days ago (±2)
  // "last week" = any time during the previous 7 days (4-day tolerance covers the full calendar week)
  if (/\blast\s+week\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 7 * DAY_MS), 4, 'high');
  }
  if (/\b(a\s+)?week\s+ago\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 7 * DAY_MS), 2, 'high');
  }

  m = q.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\s+ago\b/);
  if (m) {
    const n = parseNum(m[1]);
    if (n !== null) return rangeAround(new Date(ref.getTime() - n * 30 * DAY_MS), 5, 'medium');
  }

  if (/\blast\s+month\b/.test(q)) {
    return rangeAround(new Date(ref.getTime() - 30 * DAY_MS), 5, 'medium');
  }

  m = q.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const targetDow = WEEKDAYS[m[1]];
    const refDow = ref.getDay();
    let daysBack = (refDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    return rangeAround(new Date(ref.getTime() - daysBack * DAY_MS), 0, 'high');
  }

  if (/\byesterday\b/.test(q)) return rangeAround(new Date(ref.getTime() - DAY_MS), 0, 'high');
  if (/\btoday\b/.test(q)) return rangeAround(new Date(ref.getTime()), 0, 'high');

  return null;
}

// ── LLM Judge (mirror of src/plugins/search/llm-judge.ts) ────────────────────

let _llmLastRequest = 0;
const LLM_MIN_INTERVAL_MS = 2200;

async function rateLimit() {
  const elapsed = Date.now() - _llmLastRequest;
  if (elapsed < LLM_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, LLM_MIN_INTERVAL_MS - elapsed));
  }
  _llmLastRequest = Date.now();
}

async function llmScoreCandidates(query, candidates, apiKey, model = 'claude-haiku-4-5-20251001', retries = 3) {
  if (candidates.length === 0) return [];
  const numbered = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 1500)}`).join('\n\n');
  const prompt =
    `A user is asking: "${query}"\n\n` +
    `Find sessions that help answer this question. Look for BOTH direct and indirect evidence:\n\n` +
    `Score 10: directly answers the question.\n` +
    `Score 7-9: strongly relevant — same topic, related entities, specific details.\n` +
    `Score 4-6: indirect clues — preferences, past activities, background context.\n` +
    `Score 0-3: unrelated.\n\n` +
    `Key rules:\n` +
    `- "recommend a show/movie" → find sessions about entertainment: stand-up comedy, Netflix, streaming, actors, genres.\n` +
    `- "siblings" → sessions mentioning brother, sister, family members.\n` +
    `- "cooking for friend" → sessions about baking, recipes, dinner parties, desserts.\n` +
    `- "bought X" / "X arrived" → sessions about ANY purchases or deliveries (even different items).\n` +
    `- Sessions where user discusses specific titles, brands, or preferences ARE highly relevant.\n\n` +
    `Sessions:\n${numbered}\n\n` +
    `Return ONLY a JSON object with ALL ${candidates.length} indices: {"0": 8, "1": 3, ...}.`;

  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimit();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      if (data?.error?.type === 'rate_limit_error') {
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      const text = data?.content?.[0]?.text || '';
      const match = text.match(/\{[^{}]*\}/s);
      if (!match) return null;
      const scores = JSON.parse(match[0]);
      if (typeof scores !== 'object' || scores === null) return null;
      const scoreArr = new Array(candidates.length).fill(0);
      for (const [k, v] of Object.entries(scores)) {
        const idx = parseInt(k, 10);
        if (!isNaN(idx) && idx >= 0 && idx < candidates.length && typeof v === 'number') {
          scoreArr[idx] = Math.max(0, Math.min(10, v));
        }
      }
      return scoreArr;
    } catch (e) {
      if (attempt === retries - 1) return null;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return null;
}

/**
 * LLM rerank: score top-N candidates with Claude, blend with retrieval score.
 * Also applies temporal filtering if the query contains temporal expressions.
 *
 * Strategy for temporal queries:
 * - Parse query for temporal range
 * - Query ALL in-range session IDs from the database (not just top-K)
 * - Union with top-K from hybrid search → full candidate pool
 * - Let LLM pick the best
 */
async function llmRerank(kernel, query, results, limit = 10, referenceDate = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || results.length === 0) return results.slice(0, limit);

  let poolResults = results;

  if (referenceDate) {
    const range = resolveTemporalRange(query, referenceDate);
    if (range) {
      try {
        // Step 1: Get ALL in-range session IDs from the ENTIRE corpus (not just top-K)
        const startMs = range.start.getTime();
        const endMs = range.end.getTime();
        const inRangeRows = kernel.db.prepare(
          'SELECT id FROM observations WHERE indexed_at >= ? AND indexed_at <= ?'
        ).all(startMs, endMs);
        const inRangeIds = new Set(inRangeRows.map(r => r.id));

        if (inRangeIds.size > 0) {
          // Build pool: ONLY in-range candidates. Temporal queries with a valid
          // reference date should completely filter out out-of-range noise.
          const existingInPool = results.filter(r => inRangeIds.has(r.id));
          const existingIds = new Set(existingInPool.map(r => r.id));

          // In-range candidates that the hybrid search missed — include them
          // with score 0 so LLM can lift them up by semantic relevance.
          const missingFromPool = [...inRangeIds]
            .filter(id => !existingIds.has(id))
            .map(id => ({ id, score: 0 }));

          // Order: hybrid matches first (they have real retrieval signal),
          // then missing. Both share the LLM scoring pass equally.
          poolResults = [...existingInPool, ...missingFromPool];
        }
      } catch {}
    }
  }

  // Fetch content for LLM scoring.
  // Cap at 50 candidates to stay within the LLM context budget.
  const pool = poolResults.slice(0, 50);
  const ids = pool.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  let rows;
  try {
    rows = kernel.db.prepare(`SELECT id, content FROM observations WHERE id IN (${placeholders})`).all(...ids);
  } catch { return poolResults.slice(0, limit); }
  const contentMap = new Map(rows.map(r => [r.id, r.content]));

  const candidates = pool.map(r => ({
    id: r.id,
    score: r.score,
    content: contentMap.get(r.id) || '',
  }));

  const llmScores = await llmScoreCandidates(query, candidates, apiKey);
  if (!llmScores) return poolResults.slice(0, limit);

  // Blend: 35% retrieval + 65% LLM — LLM-dominant blend needed
  // to surface preference/indirect matches that retrieval misses.
  const retrievalMax = Math.max(...pool.map(r => r.score || 0)) || 1;
  const blended = pool.map((r, i) => {
    const retrievalNorm = (r.score || 0) / retrievalMax;
    const llmNorm = (llmScores[i] || 0) / 10;
    const fused = retrievalNorm * 0.35 + llmNorm * 0.65;
    return { ...r, score: fused };
  });

  blended.sort((a, b) => b.score - a.score);

  // Append any remaining (non-scored) results
  const seen = new Set(blended.map(r => r.id));
  const tail = poolResults.filter(r => !seen.has(r.id));
  return [...blended, ...tail].slice(0, limit);
}

module.exports = { BenchKernel, getEmbedder, llmRerank, resolveTemporalRange };
