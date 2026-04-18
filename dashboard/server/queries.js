'use strict';

/**
 * SQLite query helpers for the context-mem dashboard.
 * All functions receive `state` — the shared mutable object from index.js —
 * so they always read the live `db`, `currentProject`, `PROJECT_DIR`, `dbPath`,
 * `Database`, `os`, `path`, and `fs` references.
 */

// --- Query helpers ---
function getStats(state) {
  const { db, fs } = state;
  const obsCount = db.prepare('SELECT COUNT(*) as v FROM observations').get();
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM observations GROUP BY type ORDER BY count DESC').all();
  const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) as v FROM observations').get();
  const currentDbPath = db.name;
  const dbSize = fs.statSync(currentDbPath).size;

  const tokenStats = db.prepare(`
    SELECT event_type,
           COUNT(*) as count,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out
    FROM token_stats GROUP BY event_type
  `).all();

  const storeStats = tokenStats.find(t => t.event_type === 'store') || { count: 0, tokens_in: 0, tokens_out: 0 };
  const discoveryStats = tokenStats.find(t => t.event_type === 'discovery') || { count: 0, tokens_in: 0, tokens_out: 0 };
  const readStats = tokenStats.find(t => t.event_type === 'read') || { count: 0, tokens_in: 0, tokens_out: 0 };

  const tokensSaved = storeStats.tokens_in - (discoveryStats.tokens_out + readStats.tokens_out);
  const savingsPct = storeStats.tokens_in > 0
    ? Math.round((tokensSaved / storeStats.tokens_in) * 100)
    : 0;

  let embeddedCount = 0;
  try { embeddedCount = db.prepare('SELECT COUNT(*) as v FROM observations WHERE embeddings IS NOT NULL').get().v; } catch {}

  return {
    observations: obsCount.v,
    sessions: sessions.v,
    db_size_kb: Math.round(dbSize / 1024),
    by_type: byType,
    tokens_in: storeStats.tokens_in,
    tokens_out: storeStats.tokens_out,
    tokens_saved: Math.max(0, tokensSaved),
    savings_pct: Math.max(0, savingsPct),
    searches: discoveryStats.count,
    reads: readStats.count,
    store_events: storeStats.count,
    embedded_count: embeddedCount,
  };
}

function getTimeline(state, limit = 50, type = null, sessionId = null) {
  const { db } = state;
  let sql = `SELECT id, type, summary, substr(content, 1, 300) as content_preview,
             indexed_at, privacy_level, session_id, metadata
             FROM observations`;
  const conditions = [];
  const params = [];
  if (type) { conditions.push('type = ?'); params.push(type); }
  if (sessionId) { conditions.push('session_id = ?'); params.push(sessionId); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY indexed_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function getCompressionByType(state) {
  const { db } = state;
  return db.prepare(`
    SELECT o.type,
           COUNT(*) as count,
           COALESCE(SUM(json_extract(o.metadata, '$.tokens_original')), 0) as tokens_original,
           COALESCE(SUM(json_extract(o.metadata, '$.tokens_summarized')), 0) as tokens_summarized
    FROM observations o
    GROUP BY o.type ORDER BY tokens_original DESC
  `).all().map(r => ({
    type: r.type,
    count: r.count,
    tokens_original: r.tokens_original,
    tokens_summarized: r.tokens_summarized,
    saved: Math.max(0, r.tokens_original - r.tokens_summarized),
    compression_pct: r.tokens_original > 0
      ? Math.round((1 - r.tokens_summarized / r.tokens_original) * 100)
      : 0,
  }));
}

function getTopFiles(state, limit = 10) {
  const { db } = state;
  return db.prepare(`
    SELECT json_extract(metadata, '$.file_path') as file_path,
           COUNT(*) as count,
           GROUP_CONCAT(DISTINCT type) as types
    FROM observations
    WHERE json_extract(metadata, '$.file_path') IS NOT NULL
      AND json_extract(metadata, '$.file_path') != ''
    GROUP BY file_path
    ORDER BY count DESC LIMIT ?
  `).all(limit);
}

function getPrivacyBreakdown(state) {
  const { db } = state;
  return db.prepare(`
    SELECT COALESCE(privacy_level, 'public') as level, COUNT(*) as count
    FROM observations GROUP BY level ORDER BY count DESC
  `).all();
}

function getSessionActivity(state) {
  // Get observation counts bucketed by hour for the last 7 days
  const { db } = state;
  const since = Date.now() - (7 * 24 * 60 * 60 * 1000);
  return db.prepare(`
    SELECT
      CAST((indexed_at / 3600000) * 3600000 AS INTEGER) as hour_bucket,
      COUNT(*) as count,
      session_id
    FROM observations
    WHERE indexed_at > ?
    GROUP BY hour_bucket
    ORDER BY hour_bucket ASC
  `).all(since);
}

function exportObservations(state, limit = 1000) {
  const { db } = state;
  return db.prepare(`
    SELECT id, type, content, summary, metadata, indexed_at, privacy_level, session_id
    FROM observations ORDER BY indexed_at DESC LIMIT ?
  `).all(limit);
}

function getDbHealth(state) {
  const { db, fs } = state;
  const schemaVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  const obsCount = db.prepare('SELECT COUNT(*) as v FROM observations').get();
  const currentDbPath = db.name;
  const dbSize = fs.statSync(currentDbPath).size;

  // WAL file size
  let walSize = 0;
  try { walSize = fs.statSync(currentDbPath + '-wal').size; } catch {}

  // FTS5 check: verify tables exist and have rows
  let ftsOk = true;
  try {
    const ftsCount = db.prepare("SELECT COUNT(*) as c FROM obs_fts").get();
    ftsOk = ftsCount && ftsCount.c >= 0;
  } catch { ftsOk = false; }

  let trigramOk = true;
  try {
    const triCount = db.prepare("SELECT COUNT(*) as c FROM obs_trigram").get();
    trigramOk = triCount && triCount.c >= 0;
  } catch { trigramOk = false; }

  // Oldest / newest observation
  const oldest = db.prepare('SELECT MIN(indexed_at) as v FROM observations').get();
  const newest = db.prepare('SELECT MAX(indexed_at) as v FROM observations').get();

  return {
    schema_version: schemaVersion?.v || 0,
    observations: obsCount?.v || 0,
    db_size_bytes: dbSize,
    wal_size_bytes: walSize,
    fts5_ok: ftsOk,
    trigram_ok: trigramOk,
    oldest_at: oldest?.v || null,
    newest_at: newest?.v || null,
    db_path: currentDbPath,
  };
}

function getObservation(state, id) {
  const { db } = state;
  if (!id) return { error: 'Missing id' };
  const row = db.prepare(`SELECT id, type, content, summary, metadata, indexed_at, privacy_level, session_id FROM observations WHERE id = ?`).get(id);
  if (!row) return { error: 'Not found' };

  let meta = {};
  try { meta = JSON.parse(row.metadata); } catch {}

  return {
    id: row.id,
    type: row.type,
    content: row.content,
    summary: row.summary,
    metadata: meta,
    indexed_at: row.indexed_at,
    privacy_level: row.privacy_level,
    session_id: row.session_id,
    content_length: row.content ? row.content.length : 0,
    tokens_est: row.content ? Math.ceil(row.content.length / 4) : 0,
  };
}

function searchObservations(state, query, limit = 20, type = null) {
  const { db } = state;
  if (!query || !query.trim()) return [];

  // Sanitize for FTS5 — remove special chars, wrap terms in quotes
  const sanitized = query.trim()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t}"`)
    .join(' OR ');

  if (!sanitized) return [];

  let sql, params;

  try {
    // Try FTS5 search first (BM25 ranked)
    sql = `SELECT o.id, o.type, o.summary, substr(o.content, 1, 300) as content_preview,
                  o.indexed_at, o.privacy_level, o.session_id, o.metadata,
                  bm25(obs_fts) as rank
           FROM obs_fts f
           JOIN observations o ON o.rowid = f.rowid
           WHERE obs_fts MATCH ?`;
    params = [sanitized];

    if (type) {
      sql += ' AND o.type = ?';
      params.push(type);
    }
    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    return db.prepare(sql).all(...params);
  } catch {
    // Fallback to LIKE search
    sql = `SELECT id, type, summary, substr(content, 1, 300) as content_preview,
                  indexed_at, privacy_level, session_id, metadata,
                  0 as rank
           FROM observations
           WHERE (summary LIKE ? OR content LIKE ?)`;
    const like = `%${query.trim()}%`;
    params = [like, like];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY indexed_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(sql).all(...params);
  }
}

function getTokenHistory(state) {
  const { db } = state;
  return db.prepare(`
    SELECT session_id, event_type, tokens_in, tokens_out, timestamp
    FROM token_stats ORDER BY timestamp DESC LIMIT 200
  `).all();
}

// --- New feature queries ---

function getKnowledgeEntries(state, limit = 20, category = null) {
  const { db } = state;
  try {
    let sql = 'SELECT id, category, title, content, tags, relevance_score, access_count, created_at, archived FROM knowledge WHERE archived = 0';
    const params = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  } catch { return []; }
}

function searchKnowledge(state, query, limit = 50) {
  const { db } = state;
  if (!query || !query.trim()) return [];
  limit = Math.min(limit, 1000);
  try {
    // Try knowledge_fts if available
    try {
      const sanitized = query.trim()
        .replace(/[^\w\s-]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 0)
        .map(t => `"${t}"`)
        .join(' OR ');
      if (sanitized) {
        return db.prepare(
          `SELECT k.id, k.category, k.title, k.content, k.tags, k.relevance_score, k.access_count, k.created_at, k.archived
           FROM knowledge_fts f
           JOIN knowledge k ON k.rowid = f.rowid
           WHERE knowledge_fts MATCH ? AND k.archived = 0
           ORDER BY k.access_count DESC LIMIT ?`
        ).all(sanitized, limit);
      }
    } catch {}
    // Fallback to LIKE search
    const like = `%${query.trim()}%`;
    return db.prepare(
      `SELECT id, category, title, content, tags, relevance_score, access_count, created_at, archived
       FROM knowledge WHERE archived = 0 AND (title LIKE ? OR content LIKE ?)
       ORDER BY access_count DESC LIMIT ?`
    ).all(like, like, limit);
  } catch { return []; }
}

function getKnowledgeStats(state) {
  const { db } = state;
  try {
    const byCategory = db.prepare('SELECT category, COUNT(*) as count FROM knowledge WHERE archived = 0 GROUP BY category ORDER BY count DESC').all();
    const total = db.prepare('SELECT COUNT(*) as v FROM knowledge WHERE archived = 0').get();
    const archived = db.prepare('SELECT COUNT(*) as v FROM knowledge WHERE archived = 1').get();
    return { categories: byCategory, total: total?.v || 0, archived: archived?.v || 0 };
  } catch { return { categories: [], total: 0, archived: 0 }; }
}

function getBudgetStatus(state) {
  const { db } = state;
  try {
    const settings = db.prepare('SELECT session_limit, overflow_strategy, agent_limits FROM budget_settings WHERE id = 1').get();
    if (!settings) return { limit: 0, used: 0, pct: 0, strategy: 'warn', throttled: false, blocked: false };
    const used = db.prepare("SELECT COALESCE(SUM(tokens_in), 0) as v FROM token_stats WHERE event_type = 'store'").get();
    const usedTokens = used?.v || 0;
    const pct = settings.session_limit > 0 ? Math.round((usedTokens / settings.session_limit) * 100) : 0;
    return {
      limit: settings.session_limit,
      used: usedTokens,
      pct: Math.min(pct, 100),
      strategy: settings.overflow_strategy,
      throttled: pct >= 80,
      blocked: pct >= 100,
    };
  } catch { return { limit: 0, used: 0, pct: 0, strategy: 'warn', throttled: false, blocked: false }; }
}

function getEvents(state, limit = 50, sessionId = null) {
  const { db } = state;
  try {
    let sql = 'SELECT id, session_id, event_type, priority, agent, data, context_bytes, timestamp FROM events';
    const params = [];
    if (sessionId) { sql += ' WHERE session_id = ?'; params.push(sessionId); }
    sql += ' ORDER BY timestamp DESC, rowid DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => {
      let data = {};
      try { data = JSON.parse(r.data); } catch {}
      return { ...r, data };
    });
  } catch { return []; }
}

function getEventStats(state) {
  const { db } = state;
  try {
    const byType = db.prepare('SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC').all();
    const byPriority = db.prepare('SELECT priority, COUNT(*) as count FROM events GROUP BY priority ORDER BY priority ASC').all();
    const total = db.prepare('SELECT COUNT(*) as v FROM events').get();

    // Error-fix patterns: error followed by file_modify
    let errorFixes = [];
    try {
      const recent = db.prepare('SELECT id, event_type, data, timestamp FROM events ORDER BY timestamp DESC, rowid DESC LIMIT 200').all();
      const chrono = [...recent].reverse();
      let lastError = null;
      for (const evt of chrono) {
        if (evt.event_type === 'error') { lastError = evt; }
        else if (evt.event_type === 'file_modify' && lastError) {
          let errData = {}, fixData = {};
          try { errData = JSON.parse(lastError.data); } catch {}
          try { fixData = JSON.parse(evt.data); } catch {}
          errorFixes.push({
            error_id: lastError.id,
            fix_id: evt.id,
            file: fixData.file || 'unknown',
            error_type: errData.type || 'error',
            time_to_fix_ms: evt.timestamp - lastError.timestamp,
          });
          lastError = null;
        }
      }
    } catch {}

    return { by_type: byType, by_priority: byPriority, total: total?.v || 0, error_fixes: errorFixes };
  } catch { return { by_type: [], by_priority: [], total: 0, error_fixes: [] }; }
}

function getSnapshots(state) {
  const { db } = state;
  try {
    const rows = db.prepare('SELECT session_id, snapshot, created_at FROM snapshots ORDER BY created_at DESC LIMIT 20').all();
    return rows.map(r => {
      let data = {};
      try { data = JSON.parse(r.snapshot); } catch {}
      return { session_id: r.session_id, data, created_at: r.created_at };
    });
  } catch { return []; }
}

function getContentSources(state) {
  const { db } = state;
  try {
    return db.prepare(`
      SELECT cs.id, cs.source, cs.indexed_at,
             COUNT(cc.id) as chunk_count,
             SUM(LENGTH(cc.content)) as total_bytes,
             SUM(CASE WHEN cc.has_code = 1 THEN 1 ELSE 0 END) as code_chunks
      FROM content_sources cs
      LEFT JOIN content_chunks cc ON cc.source_id = cs.id
      GROUP BY cs.id
      ORDER BY cs.indexed_at DESC LIMIT 20
    `).all();
  } catch { return []; }
}

function getSessionList(state) {
  const { db } = state;
  return db.prepare(`
    SELECT session_id,
           COUNT(*) as obs_count,
           MIN(indexed_at) as first_at,
           MAX(indexed_at) as last_at
    FROM observations GROUP BY session_id ORDER BY last_at DESC
  `).all();
}

// --- Intelligence layer query helpers (v2.6.0) ---

/**
 * Classify search query intent (mirrors src/plugins/search/intent.ts)
 * Returns: { intent_type, type_boosts, confidence }
 */
function classifyIntent(query) {
  const q = (query || '').toLowerCase();
  const words = q.split(/\s+/);

  const causalSignals = ['why', 'cause', 'reason', 'because', 'broke', 'failed', 'crash', 'error', 'bug', 'issue', 'problem'];
  const temporalSignals = ['when', 'last', 'recent', 'today', 'yesterday', 'ago', 'since', 'latest', 'before', 'after', 'history'];
  const lookupSignals = ['how', 'where', 'find', 'show', 'explain', 'work', 'does', 'what', 'which', 'get', 'use'];

  let causalScore = 0, temporalScore = 0, lookupScore = 0;
  for (const w of words) {
    if (causalSignals.includes(w)) causalScore++;
    if (temporalSignals.includes(w)) temporalScore++;
    if (lookupSignals.includes(w)) lookupScore++;
  }

  const maxScore = Math.max(causalScore, temporalScore, lookupScore);
  if (maxScore === 0) return { intent_type: 'general', type_boosts: {}, confidence: 0.5 };

  if (causalScore === maxScore) {
    return { intent_type: 'causal', type_boosts: { error: 2, decision: 1.5, log: 1 }, confidence: Math.min(1, 0.5 + causalScore * 0.2) };
  }
  if (temporalScore === maxScore) {
    return { intent_type: 'temporal', type_boosts: { commit: 2, log: 1.5, context: 1 }, confidence: Math.min(1, 0.5 + temporalScore * 0.2) };
  }
  return { intent_type: 'lookup', type_boosts: { code: 2, context: 1.5, decision: 1 }, confidence: Math.min(1, 0.5 + lookupScore * 0.2) };
}

/**
 * Compute authority score for a knowledge entry (mirrors knowledge-base.ts computeAuthority)
 * Returns: 0-1 clamped score
 */
function computeAuthority(state, entry) {
  const { db } = state;
  // Source weight
  const sourceWeights = { explicit: 1.0, inferred: 0.6, observed: 0.3 };
  let source = 'observed';
  try {
    const meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : (entry.metadata || {});
    source = meta.source_type || meta.source || 'observed';
  } catch {}
  const sourceWeight = sourceWeights[source] || 0.3;

  // Session breadth
  let sessionCount = 0;
  try {
    const row = db.prepare('SELECT COUNT(DISTINCT session_id) as cnt FROM knowledge_access_log WHERE knowledge_id = ?').get(entry.id);
    sessionCount = row?.cnt || 0;
  } catch {}
  const sessionBreadth = Math.min(1, Math.log2(sessionCount + 1) / 5);

  // Access density
  const ageDays = Math.max(1, (Date.now() - (entry.created_at || Date.now())) / 86400000);
  const accessDensity = Math.min(1, (entry.access_count || 0) / ageDays / 10);

  // Recency (7-day half-life)
  const daysSince = (Date.now() - (entry.last_accessed || entry.created_at || Date.now())) / 86400000;
  const recency = Math.pow(0.5, daysSince / 7);

  // Softmax attention
  const signals = [sourceWeight, sessionBreadth, accessDensity, recency];
  const maxSig = Math.max(...signals);
  const expSignals = signals.map(s => Math.exp(s - maxSig));
  const sumExp = expSignals.reduce((a, b) => a + b, 0);
  const attention = expSignals.map(e => e / sumExp);

  const score = signals.reduce((sum, sig, i) => sum + sig * attention[i], 0);
  return Math.max(0, Math.min(1, score));
}

/**
 * Find potential contradictions in knowledge base
 */
function getContradictions(state, limit = 20) {
  const { db } = state;
  try {
    const entries = db.prepare('SELECT id, category, title, content, tags, relevance_score, access_count, created_at, last_accessed, metadata FROM knowledge WHERE archived = 0 ORDER BY created_at DESC LIMIT ?').all(limit);
    const contradictions = [];

    for (const entry of entries) {
      const authority = computeAuthority(state, entry);
      // Find similar entries via word overlap
      const words = (entry.title + ' ' + entry.content).toLowerCase()
        .replace(/[^\w\s]/g, '').split(/\s+/)
        .filter(w => w.length > 3);
      const uniqueWords = [...new Set(words)];
      if (uniqueWords.length < 2) continue;

      // Try FTS5 search for similar content
      const searchTerms = uniqueWords.slice(0, 5).map(t => `"${t}"`).join(' OR ');
      let candidates = [];
      try {
        candidates = db.prepare(
          `SELECT k.id, k.category, k.title, k.content, k.access_count, k.created_at, k.last_accessed, k.metadata
           FROM knowledge_fts f JOIN knowledge k ON k.rowid = f.rowid
           WHERE knowledge_fts MATCH ? AND k.id != ? AND k.archived = 0 AND k.category = ?
           LIMIT 3`
        ).all(searchTerms, entry.id, entry.category);
      } catch {
        // Fallback to LIKE
        const like = '%' + uniqueWords[0] + '%';
        candidates = db.prepare(
          'SELECT id, category, title, content, access_count, created_at, last_accessed, metadata FROM knowledge WHERE id != ? AND archived = 0 AND category = ? AND content LIKE ? LIMIT 3'
        ).all(entry.id, entry.category, like);
      }

      for (const candidate of candidates) {
        const candidateAuthority = computeAuthority(state, candidate);
        const diff = Math.abs(authority - candidateAuthority);
        let suggestedAction = 'merge';
        if (diff > 0.3) suggestedAction = authority > candidateAuthority ? 'keep_existing' : 'replace';

        contradictions.push({
          entry_a: { id: entry.id, title: entry.title, category: entry.category, authority },
          entry_b: { id: candidate.id, title: candidate.title, category: candidate.category, authority: candidateAuthority },
          suggested_action: suggestedAction,
          authority_diff: diff,
        });
      }
    }

    return contradictions.slice(0, limit);
  } catch { return []; }
}

/**
 * Get LLM provider status from config
 */
function getLLMStatus(state) {
  const { currentProject, PROJECT_DIR, path, fs } = state;
  const projectDir = currentProject || PROJECT_DIR;
  const configPath = path.join(projectDir, '.context-mem.json');
  const result = { enabled: false, provider: null, model: null, available: false };

  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const ai = cfg.ai_curation || cfg.llm || {};
    result.enabled = !!ai.enabled;
    result.provider = ai.provider || 'auto';
    result.model = ai.model || null;

    if (result.enabled) {
      // Check provider availability
      if (ai.provider === 'claude' || ai.provider === 'auto') {
        result.available = !!process.env.ANTHROPIC_API_KEY;
        if (result.available && !result.provider) result.provider = 'claude';
      }
      if (!result.available && (ai.provider === 'openrouter' || ai.provider === 'auto')) {
        result.available = !!process.env.OPENROUTER_API_KEY;
        if (result.available && result.provider === 'auto') result.provider = 'openrouter';
      }
      if (!result.available && (ai.provider === 'ollama' || ai.provider === 'auto')) {
        result.provider = result.provider === 'auto' ? 'ollama' : result.provider;
        result.available = true; // Ollama assumed local
      }
    }
  } catch {}

  return result;
}

/**
 * Enhanced search with intent classification and reranking
 */
function searchWithPipeline(state, query, limit = 20, type = null) {
  if (!query || !query.trim()) return { results: [], intent: { intent_type: 'general', confidence: 0 }, weights: {} };

  const intent = classifyIntent(query);

  // Weight presets per intent
  const INTENT_WEIGHTS = {
    causal:   { relevance: 0.20, recency: 0.70, access: 0.10 },
    temporal: { relevance: 0.10, recency: 0.75, access: 0.15 },
    lookup:   { relevance: 0.80, recency: 0.10, access: 0.10 },
    general:  { relevance: 0.55, recency: 0.30, access: 0.15 },
  };

  const weights = INTENT_WEIGHTS[intent.intent_type] || INTENT_WEIGHTS.general;

  // Get raw search results
  const rawResults = searchObservations(state, query, limit * 2, type);

  // Apply reranking
  const now = Date.now();
  const HALF_LIFE = 7 * 24 * 60 * 60 * 1000; // 7 days

  const scored = rawResults.map(r => {
    const relevance = r.rank !== undefined ? Math.min(1, Math.abs(r.rank) / 30) : 0.5;
    const recency = Math.pow(0.5, (now - r.indexed_at) / HALF_LIFE);

    let accessCount = 0;
    try {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
      accessCount = meta.access_count || 0;
    } catch {}
    const access = Math.log2(accessCount + 2) / 10;

    const finalScore = weights.relevance * relevance + weights.recency * recency + weights.access * access;

    // Apply type boosts from intent
    let typeBoost = 1.0;
    if (intent.type_boosts[r.type]) typeBoost = 1 + (intent.type_boosts[r.type] * 0.1);

    return { ...r, final_score: finalScore * typeBoost, relevance_score: relevance, recency_score: recency };
  });

  scored.sort((a, b) => b.final_score - a.final_score);

  return {
    results: scored.slice(0, limit),
    intent,
    weights,
    pipeline: ['FTS5/BM25', 'Intent Classification', 'Reranking'],
  };
}

/**
 * Get knowledge entries with authority scores
 */
function getKnowledgeWithAuthority(state, limit = 20, category = null) {
  const { db } = state;
  try {
    let sql = 'SELECT id, category, title, content, tags, relevance_score, access_count, created_at, last_accessed, archived, metadata FROM knowledge WHERE archived = 0';
    const params = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const entries = db.prepare(sql).all(...params);
    return entries.map(e => ({ ...e, authority: computeAuthority(state, e) }));
  } catch { return []; }
}

// --- Dashboard 2.0 query helpers ---

function getGraphData(state, entityFilter, depth) {
  const { db } = state;
  try {
    const nodes = [];
    const edges = [];
    const visited = new Set();

    // Get seed entities (all or filtered by name)
    let seedSql = 'SELECT id, name, entity_type, metadata, knowledge_id, created_at FROM entities';
    const seedParams = [];
    if (entityFilter) {
      seedSql += ' WHERE name LIKE ?';
      seedParams.push('%' + entityFilter + '%');
    }
    seedSql += ' LIMIT 200';
    const seeds = db.prepare(seedSql).all(...seedParams);

    // BFS traversal up to depth
    let frontier = seeds.map(e => e.id);
    for (const e of seeds) {
      if (!visited.has(e.id)) {
        visited.add(e.id);
        let meta = {};
        try { meta = JSON.parse(e.metadata); } catch {}
        nodes.push({ id: e.id, name: e.name, type: e.entity_type, metadata: meta, knowledge_id: e.knowledge_id, created_at: e.created_at });
      }
    }

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier = [];
      for (const eid of frontier) {
        // Outgoing relationships
        const rels = db.prepare(
          'SELECT id, from_entity, to_entity, relationship_type, weight, metadata FROM relationships WHERE from_entity = ? OR to_entity = ?'
        ).all(eid, eid);

        for (const r of rels) {
          let rMeta = {};
          try { rMeta = JSON.parse(r.metadata); } catch {}
          edges.push({ id: r.id, source: r.from_entity, target: r.to_entity, type: r.relationship_type, weight: r.weight, metadata: rMeta });

          const neighborId = r.from_entity === eid ? r.to_entity : r.from_entity;
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            const neighbor = db.prepare('SELECT id, name, entity_type, metadata, knowledge_id, created_at FROM entities WHERE id = ?').get(neighborId);
            if (neighbor) {
              let nMeta = {};
              try { nMeta = JSON.parse(neighbor.metadata); } catch {}
              nodes.push({ id: neighbor.id, name: neighbor.name, type: neighbor.entity_type, metadata: nMeta, knowledge_id: neighbor.knowledge_id, created_at: neighbor.created_at });
              nextFrontier.push(neighborId);
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    // Deduplicate edges by id
    const uniqueEdges = [];
    const edgeIds = new Set();
    for (const e of edges) {
      if (!edgeIds.has(e.id)) { edgeIds.add(e.id); uniqueEdges.push(e); }
    }

    return { nodes, edges: uniqueEdges };
  } catch { return { nodes: [], edges: [] }; }
}

function getTimelineRange(state, from, to, type, limit) {
  const { db } = state;
  try {
    let sql = `SELECT id, type, summary, substr(content, 1, 300) as content_preview,
               indexed_at, privacy_level, session_id, metadata
               FROM observations WHERE indexed_at >= ? AND indexed_at <= ?`;
    const params = [from, to];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY indexed_at DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  } catch { return []; }
}

function getAgents(state) {
  const { dbPath, path, fs } = state;
  try {
    const agentsPath = path.join(path.dirname(dbPath), 'agents.json');
    if (!fs.existsSync(agentsPath)) return [];
    const raw = fs.readFileSync(agentsPath, 'utf8');
    const agents = JSON.parse(raw);
    return Array.isArray(agents) ? agents : [];
  } catch { return []; }
}

// --- Total Recall API helpers ---

function getImportanceDistribution(state) {
  const { db } = state;
  try {
    const rows = db.prepare(`
      SELECT
        CASE
          WHEN importance_score >= 0.9 THEN '0.9-1.0'
          WHEN importance_score >= 0.8 THEN '0.8-0.9'
          WHEN importance_score >= 0.7 THEN '0.7-0.8'
          WHEN importance_score >= 0.6 THEN '0.6-0.7'
          WHEN importance_score >= 0.5 THEN '0.5-0.6'
          WHEN importance_score >= 0.4 THEN '0.4-0.5'
          WHEN importance_score >= 0.3 THEN '0.3-0.4'
          ELSE '0.0-0.3'
        END as bucket,
        COUNT(*) as count
      FROM observations
      GROUP BY bucket
      ORDER BY bucket DESC
    `).all();
    return rows;
  } catch { return []; }
}

function getCompressionTiers(state) {
  const { db } = state;
  try {
    const rows = db.prepare(`
      SELECT compression_tier as tier, COUNT(*) as count
      FROM observations
      GROUP BY compression_tier
      ORDER BY CASE compression_tier
        WHEN 'verbatim' THEN 1
        WHEN 'light' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'distilled' THEN 4
        ELSE 5
      END
    `).all();
    const total = rows.reduce((s, r) => s + r.count, 0);
    return { tiers: rows, total };
  } catch { return { tiers: [], total: 0 }; }
}

function getSignificanceFlags(state) {
  const { db } = state;
  try {
    const flags = { DECISION: 0, ORIGIN: 0, PIVOT: 0, CORE: 0, MILESTONE: 0, PROBLEM: 0 };
    const rows = db.prepare("SELECT metadata FROM observations WHERE metadata LIKE '%significance_flags%'").all();
    for (const row of rows) {
      try {
        const meta = JSON.parse(row.metadata);
        if (Array.isArray(meta.significance_flags)) {
          for (const f of meta.significance_flags) {
            if (flags[f] !== undefined) flags[f]++;
          }
        }
      } catch {}
    }
    const pinned = db.prepare('SELECT COUNT(*) as v FROM observations WHERE pinned = 1').get();
    return { flags, pinned_count: pinned?.v || 0 };
  } catch { return { flags: {}, pinned_count: 0 }; }
}

function getTopicsList(state, limit = 50) {
  const { db } = state;
  try {
    return db.prepare(
      'SELECT id, name, observation_count, last_seen FROM topics ORDER BY observation_count DESC LIMIT ?'
    ).all(limit);
  } catch { return []; }
}

function getTopicObservations(state, topicName, limit = 20) {
  const { db } = state;
  try {
    return db.prepare(`
      SELECT o.id, o.type, o.summary, substr(o.content, 1, 300) as content_preview,
             o.indexed_at, o.importance_score, o.pinned, o.compression_tier, o.metadata
      FROM observation_topics ot
      JOIN topics t ON t.id = ot.topic_id
      JOIN observations o ON o.id = ot.observation_id
      WHERE t.name = ?
      ORDER BY o.importance_score DESC, o.indexed_at DESC
      LIMIT ?
    `).all(topicName, limit);
  } catch { return []; }
}

function getEntitiesSummary(state) {
  const { db } = state;
  try {
    const byType = db.prepare(
      'SELECT entity_type, COUNT(*) as count FROM entities GROUP BY entity_type ORDER BY count DESC'
    ).all();
    const total = byType.reduce((s, r) => s + r.count, 0);
    const topByRelationships = db.prepare(`
      SELECT e.name, e.entity_type,
             (SELECT COUNT(*) FROM relationships r WHERE r.from_entity = e.id OR r.to_entity = e.id) as rel_count
      FROM entities e
      ORDER BY rel_count DESC LIMIT 10
    `).all();
    return { by_type: byType, total, top_connected: topByRelationships };
  } catch { return { by_type: [], total: 0, top_connected: [] }; }
}

function getPeopleList(state, limit = 20) {
  const { db } = state;
  try {
    return db.prepare(`
      SELECT e.id, e.name, e.created_at,
             (SELECT COUNT(*) FROM relationships r WHERE r.from_entity = e.id OR r.to_entity = e.id) as rel_count
      FROM entities e WHERE e.entity_type = 'person'
      ORDER BY rel_count DESC, e.created_at DESC LIMIT ?
    `).all(limit);
  } catch { return []; }
}

function getTemporalFacts(state) {
  const { db } = state;
  try {
    const active = db.prepare('SELECT COUNT(*) as v FROM knowledge WHERE archived = 0 AND valid_to IS NULL').get();
    const superseded = db.prepare('SELECT COUNT(*) as v FROM knowledge WHERE valid_to IS NOT NULL').get();
    const recent = db.prepare(`
      SELECT id, title, valid_from, valid_to, superseded_by
      FROM knowledge WHERE valid_to IS NOT NULL
      ORDER BY valid_to DESC LIMIT 5
    `).all();
    return { active: active?.v || 0, superseded: superseded?.v || 0, recent_supersessions: recent };
  } catch { return { active: 0, superseded: 0, recent_supersessions: [] }; }
}

function getPressureEntries(state, limit = 10) {
  const { db } = state;
  try {
    const now = Date.now();
    const rows = db.prepare(`
      SELECT id, type, summary, content, indexed_at, importance_score, access_count, pinned, last_useful_at
      FROM observations WHERE pinned = 0
      ORDER BY importance_score ASC, indexed_at ASC LIMIT 50
    `).all();
    const entries = [];
    for (const o of rows) {
      const ageDays = (now - o.indexed_at) / (24 * 60 * 60 * 1000);
      const recency = Math.pow(0.5, ageDays / 14);
      const accessFactor = Math.log2(Math.max(1, (o.access_count || 0) + 1)) / 5;
      const usefulFactor = o.last_useful_at ? 0.5 : 0;
      const importance = o.importance_score || 0.5;
      const survival = importance * 0.4 + recency * 0.3 + accessFactor * 0.2 + usefulFactor * 0.1;
      const risk = Math.max(0, Math.min(1, 1 - survival));
      const reasons = [];
      if (importance < 0.4) reasons.push('low importance');
      if (ageDays > 30) reasons.push(Math.round(ageDays) + ' days old');
      if (!o.access_count) reasons.push('never accessed');
      if (!o.last_useful_at) reasons.push('never useful');
      entries.push({
        id: o.id, title: (o.summary || o.content || '').slice(0, 100), type: o.type,
        risk_score: Math.round(risk * 100) / 100, reasons, age_days: Math.round(ageDays),
        access_count: o.access_count || 0, importance_score: o.importance_score
      });
    }
    return entries.sort((a, b) => b.risk_score - a.risk_score).slice(0, limit);
  } catch { return []; }
}

function getWakeUpPreview(state) {
  const { db } = state;
  try {
    const profile = db.prepare('SELECT content FROM project_profile WHERE id = 1').get();
    const knowledge = db.prepare(`
      SELECT title, content, relevance_score, access_count FROM knowledge
      WHERE archived = 0 AND valid_to IS NULL
      ORDER BY relevance_score DESC, access_count DESC LIMIT 5
    `).all();
    const entities = db.prepare(`
      SELECT e.name, e.entity_type,
             (SELECT COUNT(*) FROM relationships r WHERE r.from_entity = e.id OR r.to_entity = e.id) as rel_count
      FROM entities e ORDER BY rel_count DESC, e.updated_at DESC LIMIT 5
    `).all();
    return {
      l0_profile: profile?.content || '',
      l1_critical: knowledge.map(k => ({ title: k.title, content: k.content.slice(0, 120), score: k.relevance_score })),
      l3_entities: entities.filter(e => e.rel_count > 0).map(e => ({ name: e.name, type: e.entity_type, connections: e.rel_count })),
    };
  } catch { return { l0_profile: '', l1_critical: [], l3_entities: [] }; }
}

function getDecisionTrail(state, query) {
  const { db } = state;
  try {
    const decisions = db.prepare(`
      SELECT id, content, summary, indexed_at, metadata, session_id
      FROM observations
      WHERE (type = 'decision' OR metadata LIKE '%DECISION%')
        AND (content LIKE ? OR summary LIKE ?)
      ORDER BY indexed_at DESC LIMIT 5
    `).all('%' + query + '%', '%' + query + '%');
    if (decisions.length === 0) return null;
    const d = decisions[0];
    const evidence = [];
    if (d.session_id) {
      const events = db.prepare(`
        SELECT event_type, data, timestamp FROM events
        WHERE session_id = ? AND timestamp < ? AND timestamp > ?
        ORDER BY timestamp ASC LIMIT 15
      `).all(d.session_id, d.indexed_at, d.indexed_at - 3600000);
      for (const e of events) {
        let data = {}; try { data = JSON.parse(e.data); } catch {}
        evidence.push({ type: e.event_type, content: data.file || JSON.stringify(data).slice(0, 150), timestamp: e.timestamp });
      }
    }
    evidence.push({ type: 'decision', content: (d.summary || d.content).slice(0, 300), timestamp: d.indexed_at });
    let flags = []; try { flags = JSON.parse(d.metadata).significance_flags || []; } catch {}
    return { decision: (d.summary || d.content).slice(0, 200), date: d.indexed_at, evidence, flags };
  } catch { return null; }
}

function generateNarrativeApi(state, format, sessionId, topic) {
  const { db } = state;
  try {
    const data = { decisions: [], errors: [], changes: [], patterns: [], people: [] };
    let where = '1=1'; const params = [];
    if (sessionId) { where += ' AND session_id = ?'; params.push(sessionId); }
    if (topic) { where += ' AND (content LIKE ? OR summary LIKE ?)'; params.push('%' + topic + '%', '%' + topic + '%'); }
    try {
      data.decisions = db.prepare(`SELECT summary, content FROM observations WHERE ${where} AND type = 'decision' ORDER BY indexed_at DESC LIMIT 10`).all(...params).map(d => (d.summary || d.content).slice(0, 150));
      data.errors = db.prepare(`SELECT summary, content FROM observations WHERE ${where} AND type = 'error' ORDER BY indexed_at DESC LIMIT 5`).all(...params).map(e => (e.summary || e.content).slice(0, 150));
      data.changes = db.prepare(`SELECT summary, content FROM observations WHERE ${where} AND type IN ('code','commit') ORDER BY indexed_at DESC LIMIT 10`).all(...params).map(c => (c.summary || c.content).slice(0, 150));
    } catch {}
    try { data.patterns = db.prepare("SELECT title FROM knowledge WHERE category = 'pattern' AND archived = 0 ORDER BY access_count DESC LIMIT 5").all().map(p => p.title); } catch {}
    try { data.people = db.prepare("SELECT name FROM entities WHERE entity_type = 'person' ORDER BY updated_at DESC LIMIT 5").all().map(p => p.name); } catch {}
    // Template rendering
    if (format === 'pr') {
      let t = '## Summary\n'; t += data.changes.length ? data.changes.map(c => '- ' + c).join('\n') : 'No changes recorded.';
      if (data.decisions.length) t += '\n\n## Decisions\n' + data.decisions.map(d => '- ' + d).join('\n');
      if (data.errors.length) t += '\n\n## Issues Resolved\n' + data.errors.map(e => '- ' + e).join('\n');
      t += '\n\n## Test Plan\n- [ ] Verify changes\n- [ ] Run test suite'; return t;
    } else if (format === 'standup') {
      const done = data.changes.length ? data.changes.slice(0, 3).map(c => '- ' + c).join('\n') : '- No changes';
      const blockers = data.errors.length ? data.errors.slice(0, 2).map(e => '- ' + e).join('\n') : '- None';
      return '**Done:**\n' + done + '\n\n**Next:**\n- Continue current work\n\n**Blockers:**\n' + blockers;
    } else if (format === 'adr') {
      const title = data.decisions[0] || 'Untitled Decision';
      const ctx = data.errors.length ? data.errors.map(e => '- ' + e).join('\n') : '- Context not recorded';
      const dec = data.decisions.length ? data.decisions.map(d => '- ' + d).join('\n') : '- Decision not recorded';
      const con = data.changes.length ? data.changes.slice(0, 3).map(c => '- ' + c).join('\n') : '- Not yet observed';
      return '# ' + title + '\n\n## Context\n' + ctx + '\n\n## Decision\n' + dec + '\n\n## Consequences\n' + con;
    } else if (format === 'onboarding') {
      let t = '# Project Overview';
      if (data.patterns.length) t += '\n\n## Patterns\n' + data.patterns.map(p => '- ' + p).join('\n');
      if (data.decisions.length) t += '\n\n## Key Decisions\n' + data.decisions.map(d => '- ' + d).join('\n');
      if (data.people.length) t += '\n\n## Team\n' + data.people.map(p => '- ' + p).join('\n');
      return t;
    }
    return 'Unknown format: ' + format;
  } catch (e) { return 'Error: ' + e.message; }
}

function getPinnedObservations(state, limit = 20) {
  const { db } = state;
  try {
    return db.prepare(`
      SELECT id, type, summary, substr(content, 1, 300) as content_preview,
             indexed_at, importance_score, compression_tier, metadata
      FROM observations WHERE pinned = 1
      ORDER BY indexed_at DESC LIMIT ?
    `).all(limit);
  } catch { return []; }
}

function getCompressionAnalytics(state) {
  const { db } = state;

  // Per content-type breakdown (uses observation.type column)
  let perContentType = [];
  try {
    perContentType = db.prepare(`
      SELECT o.type,
             COUNT(*) as observations,
             COALESCE(SUM(json_extract(o.metadata, '$.tokens_original')), 0)    as total_original_bytes,
             COALESCE(SUM(json_extract(o.metadata, '$.tokens_summarized')), 0)  as total_summary_bytes
      FROM observations o
      GROUP BY o.type
      ORDER BY total_original_bytes DESC
    `).all().map(r => ({
      type: r.type,
      observations: r.observations,
      total_original_bytes: r.total_original_bytes,
      total_summary_bytes: r.total_summary_bytes,
      savings_pct: r.total_original_bytes > 0
        ? Math.round((1 - r.total_summary_bytes / r.total_original_bytes) * 1000) / 10
        : 0,
    }));
  } catch {}

  // Overall totals
  let overall = { observations: 0, total_original: 0, total_summary: 0, savings_pct: 0 };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as observations,
             COALESCE(SUM(json_extract(metadata, '$.tokens_original')), 0)   as total_original,
             COALESCE(SUM(json_extract(metadata, '$.tokens_summarized')), 0) as total_summary
      FROM observations
    `).get();
    if (row) {
      overall = {
        observations: row.observations,
        total_original: row.total_original,
        total_summary: row.total_summary,
        savings_pct: row.total_original > 0
          ? Math.round((1 - row.total_summary / row.total_original) * 1000) / 10
          : 0,
      };
    }
  } catch {}

  // Compression ratio histogram — bucket by savings %
  const buckets = [
    { label: '0-10%',   min: 0,  max: 10  },
    { label: '10-30%',  min: 10, max: 30  },
    { label: '30-50%',  min: 30, max: 50  },
    { label: '50-70%',  min: 50, max: 70  },
    { label: '70-90%',  min: 70, max: 90  },
    { label: '90-100%', min: 90, max: 101 },
  ];
  const histogram = buckets.map(b => ({ bucket: b.label, count: 0 }));

  try {
    const rows = db.prepare(`
      SELECT json_extract(metadata, '$.tokens_original')   as orig,
             json_extract(metadata, '$.tokens_summarized') as summ
      FROM observations
      WHERE json_extract(metadata, '$.tokens_original') > 0
        AND json_extract(metadata, '$.tokens_summarized') IS NOT NULL
    `).all();

    for (const r of rows) {
      const pct = Math.round((1 - r.summ / r.orig) * 100);
      const idx = buckets.findIndex(b => pct >= b.min && pct < b.max);
      if (idx >= 0) histogram[idx].count++;
    }
  } catch {}

  return { perContentType, histogram, overall };
}

function getTunnels(state) {
  const { db, currentProject, PROJECT_DIR, path, fs, os, Database } = state;
  try {
    const topics = db.prepare('SELECT name FROM topics WHERE observation_count > 0').all();
    // Check global store for cross-project matches
    const globalDbPath = path.join(os.homedir(), '.context-mem', 'global', 'store.db');
    if (!fs.existsSync(globalDbPath)) return [];
    const globalDb = new Database(globalDbPath, { readonly: true });
    const tunnels = [];
    for (const t of topics) {
      try {
        const matches = globalDb.prepare("SELECT source_project FROM global_knowledge WHERE title LIKE ? OR content LIKE ? LIMIT 5")
          .all('%' + t.name + '%', '%' + t.name + '%');
        if (matches.length > 0) {
          const projects = new Set([currentProject || PROJECT_DIR]);
          for (const m of matches) if (m.source_project) projects.add(m.source_project);
          if (projects.size >= 2) tunnels.push({ topic: t.name, projects: [...projects] });
        }
      } catch {}
    }
    globalDb.close();
    return tunnels;
  } catch { return []; }
}

module.exports = {
  getStats,
  getTimeline,
  getCompressionByType,
  getTopFiles,
  getPrivacyBreakdown,
  getSessionActivity,
  exportObservations,
  getDbHealth,
  getObservation,
  searchObservations,
  getTokenHistory,
  getKnowledgeEntries,
  searchKnowledge,
  getKnowledgeStats,
  getBudgetStatus,
  getEvents,
  getEventStats,
  getSnapshots,
  getContentSources,
  getSessionList,
  classifyIntent,
  computeAuthority,
  getContradictions,
  getLLMStatus,
  searchWithPipeline,
  getKnowledgeWithAuthority,
  getGraphData,
  getTimelineRange,
  getAgents,
  getImportanceDistribution,
  getCompressionTiers,
  getSignificanceFlags,
  getTopicsList,
  getTopicObservations,
  getEntitiesSummary,
  getPeopleList,
  getTemporalFacts,
  getPressureEntries,
  getWakeUpPreview,
  getDecisionTrail,
  generateNarrativeApi,
  getPinnedObservations,
  getTunnels,
  getCompressionAnalytics,
};
