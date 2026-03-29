#!/usr/bin/env node
'use strict';

/**
 * context-mem dashboard — Lightweight real-time dashboard for context-mem
 * Zero external dependencies beyond better-sqlite3 (already installed)
 *
 * Usage:
 *   node dashboard/server.js [--port 51893] [--db path/to/store.db]
 *   context-mem dashboard
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// WebSocket is optional — dashboard works with HTTP polling alone
let WebSocketServer;
try { WebSocketServer = require('ws').WebSocketServer; } catch {}

// --- CLI args ---
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PORT = parseInt(process.env.CONTEXT_MEM_DASHBOARD_PORT || getArg('--port', '51893'), 10);
const DB_PATH = process.env.CONTEXT_MEM_DB || getArg('--db', '');
const PROJECT_DIR = process.env.CONTEXT_MEM_PROJECT || getArg('--project', process.cwd());
const NO_OPEN = args.includes('--no-open');
const MULTI_MODE = args.includes('--multi');

// --- Instance registry (multi-project support) ---
const os = require('os');
const INSTANCES_DIR = path.join(os.homedir(), '.context-mem', 'instances');

function getRegisteredInstances() {
  if (!fs.existsSync(INSTANCES_DIR)) return [];
  const instances = [];
  for (const file of fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, file), 'utf8'));
      // DB must exist to show in dashboard
      if (!fs.existsSync(info.dbPath)) {
        try { fs.unlinkSync(path.join(INSTANCES_DIR, file)); } catch {}
        continue;
      }
      // Check if process is still alive — mark status but don't delete
      let active = false;
      try { process.kill(info.pid, 0); active = true; } catch {}
      info.active = active;
      instances.push(info);
    } catch {}
  }
  return instances.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// --- Resolve DB path ---
function findDb() {
  if (DB_PATH && fs.existsSync(DB_PATH)) return DB_PATH;

  // In multi mode, use first registered instance
  if (MULTI_MODE) {
    const instances = getRegisteredInstances();
    if (instances.length > 0) return instances[0].dbPath;
  }

  // Try standard locations
  const candidates = [
    path.join(PROJECT_DIR, '.context-mem', 'store.db'),
    path.join(process.cwd(), '.context-mem', 'store.db'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const dbPath = findDb();
if (!dbPath) {
  console.error('context-mem dashboard: No database found.');
  console.error('Run `context-mem init` in your project first.');
  process.exit(1);
}

// --- Open SQLite (read-only) ---
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  // Try from context-mem's own node_modules
  const cmPath = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
  if (fs.existsSync(cmPath)) {
    Database = require(cmPath);
  } else {
    console.error('context-mem dashboard: better-sqlite3 not found. Run: npm install better-sqlite3');
    process.exit(1);
  }
}

let db = new Database(dbPath, { readonly: true });
db.pragma('journal_mode = WAL');
let currentProject = PROJECT_DIR;

/** Switch active DB to a different project */
function switchProject(newDbPath) {
  try {
    const newDb = new Database(newDbPath, { readonly: true });
    newDb.pragma('journal_mode = WAL');
    db.close();
    db = newDb;
    return true;
  } catch {
    return false;
  }
}

console.error(`context-mem dashboard: Reading from ${dbPath}`);

// --- Query helpers ---
function getStats() {
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

function getTimeline(limit = 50, type = null, sessionId = null) {
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

function getCompressionByType() {
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

function getTopFiles(limit = 10) {
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

function getPrivacyBreakdown() {
  return db.prepare(`
    SELECT COALESCE(privacy_level, 'public') as level, COUNT(*) as count
    FROM observations GROUP BY level ORDER BY count DESC
  `).all();
}

function getSessionActivity() {
  // Get observation counts bucketed by hour for the last 7 days
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

function exportObservations(limit = 1000) {
  return db.prepare(`
    SELECT id, type, content, summary, metadata, indexed_at, privacy_level, session_id
    FROM observations ORDER BY indexed_at DESC LIMIT ?
  `).all(limit);
}

function getDbHealth() {
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

function getObservation(id) {
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

function searchObservations(query, limit = 20, type = null) {
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

function getTokenHistory() {
  return db.prepare(`
    SELECT session_id, event_type, tokens_in, tokens_out, timestamp
    FROM token_stats ORDER BY timestamp DESC LIMIT 200
  `).all();
}

// --- New feature queries ---

function getKnowledgeEntries(limit = 20, category = null) {
  try {
    let sql = 'SELECT id, category, title, content, tags, relevance_score, access_count, created_at, archived FROM knowledge WHERE archived = 0';
    const params = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  } catch { return []; }
}

function searchKnowledge(query, limit = 50) {
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

function getKnowledgeStats() {
  try {
    const byCategory = db.prepare('SELECT category, COUNT(*) as count FROM knowledge WHERE archived = 0 GROUP BY category ORDER BY count DESC').all();
    const total = db.prepare('SELECT COUNT(*) as v FROM knowledge WHERE archived = 0').get();
    const archived = db.prepare('SELECT COUNT(*) as v FROM knowledge WHERE archived = 1').get();
    return { categories: byCategory, total: total?.v || 0, archived: archived?.v || 0 };
  } catch { return { categories: [], total: 0, archived: 0 }; }
}

function getBudgetStatus() {
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

function getEvents(limit = 50, sessionId = null) {
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

function getEventStats() {
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

function getSnapshots() {
  try {
    const rows = db.prepare('SELECT session_id, snapshot, created_at FROM snapshots ORDER BY created_at DESC LIMIT 20').all();
    return rows.map(r => {
      let data = {};
      try { data = JSON.parse(r.snapshot); } catch {}
      return { session_id: r.session_id, data, created_at: r.created_at };
    });
  } catch { return []; }
}

function getContentSources() {
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

function getSessionList() {
  return db.prepare(`
    SELECT session_id,
           COUNT(*) as obs_count,
           MIN(indexed_at) as first_at,
           MAX(indexed_at) as last_at
    FROM observations GROUP BY session_id ORDER BY last_at DESC
  `).all();
}

// --- Dashboard 2.0 query helpers ---

function getGraphData(entityFilter, depth) {
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

function getTimelineRange(from, to, type, limit) {
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

function getAgents() {
  try {
    const agentsPath = path.join(path.dirname(dbPath), 'agents.json');
    if (!fs.existsSync(agentsPath)) return [];
    const raw = fs.readFileSync(agentsPath, 'utf8');
    const agents = JSON.parse(raw);
    return Array.isArray(agents) ? agents : [];
  } catch { return []; }
}

// --- API router ---
function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  try {
    let data;
    switch (route) {
      case '/api/stats':
        data = getStats();
        break;
      case '/api/timeline':
        data = getTimeline(
          Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000),
          url.searchParams.get('type') || null,
          url.searchParams.get('session') || null
        );
        break;
      case '/api/observation':
        data = getObservation(url.searchParams.get('id') || '');
        break;
      case '/api/compression':
        data = getCompressionByType();
        break;
      case '/api/top-files':
        data = getTopFiles(Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 1000));
        break;
      case '/api/privacy':
        data = getPrivacyBreakdown();
        break;
      case '/api/activity':
        data = getSessionActivity();
        break;
      case '/api/db-health':
        data = getDbHealth();
        break;
      case '/api/export':
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="context-mem-export.json"',
          'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT,
        });
        res.end(JSON.stringify(exportObservations(
          Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 10000)
        ), null, 2));
        return;
      case '/api/search':
        data = searchObservations(
          url.searchParams.get('q') || '',
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 1000),
          url.searchParams.get('type') || null
        );
        break;
      case '/api/tokens':
        data = getTokenHistory();
        break;
      case '/api/sessions':
        data = getSessionList();
        break;
      case '/api/knowledge':
        data = getKnowledgeEntries(
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 1000),
          url.searchParams.get('category') || null
        );
        break;
      case '/api/knowledge-stats':
        data = getKnowledgeStats();
        break;
      case '/api/budget':
        data = getBudgetStatus();
        break;
      case '/api/events':
        data = getEvents(
          Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000),
          url.searchParams.get('session') || null
        );
        break;
      case '/api/event-stats':
        data = getEventStats();
        break;
      case '/api/snapshots':
        data = getSnapshots();
        break;
      case '/api/content-sources':
        data = getContentSources();
        break;
      case '/api/health':
        data = { status: 'ok', db: dbPath, uptime: process.uptime() };
        break;
      case '/api/init-status': {
        // Check if full init has been run for current project
        const projectDir = currentProject || PROJECT_DIR;
        const hasConfig = fs.existsSync(path.join(projectDir, '.context-mem.json'));
        const hasMarker = fs.existsSync(path.join(projectDir, '.context-mem', '.initialized'));
        const hasGitignore = (() => {
          const gp = path.join(projectDir, '.gitignore');
          if (!fs.existsSync(gp)) return false;
          return fs.readFileSync(gp, 'utf8').includes('.context-mem');
        })();
        // Detect which editors are present
        const editors = [];
        if (fs.existsSync(path.join(projectDir, '.cursor')) || fs.existsSync(path.join(os.homedir(), '.cursor'))) editors.push('Cursor');
        if (fs.existsSync(path.join(projectDir, '.windsurf')) || fs.existsSync(path.join(os.homedir(), '.windsurf'))) editors.push('Windsurf');
        if (fs.existsSync(path.join(projectDir, '.vscode'))) editors.push('Copilot');
        if (fs.existsSync(path.join(os.homedir(), '.cline'))) editors.push('Cline');
        if (fs.existsSync(path.join(os.homedir(), '.roo-code'))) editors.push('Roo Code');
        if (fs.existsSync(path.join(projectDir, 'CLAUDE.md'))) editors.push('Claude Code');
        if (fs.existsSync(path.join(projectDir, 'GEMINI.md'))) editors.push('Gemini CLI');
        data = {
          initialized: hasConfig,
          firstRunDone: hasMarker,
          gitignoreOk: hasGitignore,
          detectedEditors: editors,
          projectDir,
        };
        break;
      }
      case '/api/run-init': {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
          res.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        // Run context-mem init in the project directory
        const { execSync } = require('child_process');
        const initProjectDir = currentProject || PROJECT_DIR;
        try {
          const output = execSync('npx context-mem init', {
            cwd: initProjectDir,
            timeout: 30000,
            encoding: 'utf8',
            env: { ...process.env },
          });
          data = { ok: true, output: output.trim(), projectDir: initProjectDir };
        } catch (initErr) {
          data = { ok: false, error: initErr.message, output: initErr.stdout || '' };
        }
        break;
      }
      case '/api/instances':
        data = getRegisteredInstances().map(i => ({
          ...i,
          active: i.dbPath === db.name,
        }));
        break;
      case '/api/stats-all': {
        const allInstances = getRegisteredInstances();
        const allStats = [];
        let totalObs = 0, totalContentLen = 0, totalSummaryLen = 0;
        for (const inst of allInstances) {
          let tmpDb;
          try {
            tmpDb = new Database(inst.dbPath, { readonly: true });
            const obsCount = tmpDb.prepare('SELECT COUNT(*) as v FROM observations').get();
            const sizes = tmpDb.prepare('SELECT COALESCE(SUM(LENGTH(content)),0) as raw, COALESCE(SUM(LENGTH(summary)),0) as comp FROM observations').get();
            const obs = obsCount?.v || 0;
            const raw = sizes?.raw || 0;
            const comp = sizes?.comp || 0;
            totalObs += obs;
            totalContentLen += raw;
            totalSummaryLen += comp;
            allStats.push({ project: inst.projectName, projectDir: inst.projectDir, observations: obs, rawBytes: raw, compressedBytes: comp, savings: raw > 0 ? Math.round((1 - comp / raw) * 100) : 0 });
          } catch {} finally {
            try { if (tmpDb) tmpDb.close(); } catch {}
          }
        }
        data = {
          projects: allStats,
          total: {
            projectCount: allInstances.length,
            observations: totalObs,
            rawBytes: totalContentLen,
            compressedBytes: totalSummaryLen,
            savings: totalContentLen > 0 ? Math.round((1 - totalSummaryLen / totalContentLen) * 100) : 0,
          },
        };
        break;
      }
      case '/api/vector-status': {
        const vectorProjectDir = currentProject || PROJECT_DIR;
        const vectorConfigPath = path.join(vectorProjectDir, '.context-mem.json');
        let vectorEnabled = false;
        let hfInstalled = false;
        let embeddedCount = 0;
        let totalCount = 0;

        // Check config
        try {
          const cfg = JSON.parse(fs.readFileSync(vectorConfigPath, 'utf8'));
          vectorEnabled = Array.isArray(cfg.plugins?.search) && cfg.plugins.search.includes('vector');
        } catch {}

        // Check if @huggingface/transformers is importable
        try {
          require.resolve('@huggingface/transformers');
          hfInstalled = true;
        } catch {
          // Also check project-local node_modules
          try {
            require.resolve(path.join(vectorProjectDir, 'node_modules', '@huggingface/transformers'));
            hfInstalled = true;
          } catch {}
        }

        // Count embedded observations
        try {
          embeddedCount = db.prepare('SELECT COUNT(*) as v FROM observations WHERE embeddings IS NOT NULL').get().v;
          totalCount = db.prepare('SELECT COUNT(*) as v FROM observations').get().v;
        } catch {}

        // Determine status level:
        // "active"     — vector configured + HF installed + embeddings exist
        // "ready"      — vector configured + HF installed, but no embeddings yet
        // "missing-pkg" — vector configured but HF not installed
        // "available"  — vector not configured (upsell opportunity)
        let status = 'available';
        if (vectorEnabled && hfInstalled && embeddedCount > 0) status = 'active';
        else if (vectorEnabled && hfInstalled) status = 'ready';
        else if (vectorEnabled && !hfInstalled) status = 'missing-pkg';

        data = { status, vectorEnabled, hfInstalled, embeddedCount, totalCount, projectDir: vectorProjectDir };
        break;
      }
      case '/api/enable-vector': {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
          res.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        const enableProjectDir = currentProject || PROJECT_DIR;
        const enableConfigPath = path.join(enableProjectDir, '.context-mem.json');
        try {
          const cfg = JSON.parse(fs.readFileSync(enableConfigPath, 'utf8'));
          if (!Array.isArray(cfg.plugins?.search)) {
            cfg.plugins = cfg.plugins || {};
            cfg.plugins.search = ['bm25', 'trigram'];
          }
          if (!cfg.plugins.search.includes('vector')) {
            cfg.plugins.search.push('vector');
            fs.writeFileSync(enableConfigPath, JSON.stringify(cfg, null, 2) + '\n');
          }
          data = { ok: true, search: cfg.plugins.search };
        } catch (cfgErr) {
          data = { ok: false, error: cfgErr.message };
        }
        break;
      }
      case '/api/switch-project': {
        const targetDb = url.searchParams.get('db');
        const registeredInstances = getRegisteredInstances();
        const targetInstance = targetDb ? registeredInstances.find(i => i.dbPath === targetDb) : null;
        if (targetInstance && switchProject(targetDb)) {
          currentProject = targetInstance.projectDir;
          data = { ok: true, db: targetDb, project: currentProject };
        } else {
          data = { ok: false, error: 'Failed to switch' };
        }
        break;
      }
      case '/api/knowledge/search':
        data = searchKnowledge(
          url.searchParams.get('q') || '',
          Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000)
        );
        break;
      case '/api/graph': {
        const entity = url.searchParams.get('entity') || '';
        const depth = Math.min(parseInt(url.searchParams.get('depth') || '2', 10), 5);
        data = getGraphData(entity, depth);
        // Clamp total nodes+edges to 1000
        if (data.nodes.length > 1000) data.nodes = data.nodes.slice(0, 1000);
        if (data.edges.length > 1000) data.edges = data.edges.slice(0, 1000);
        break;
      }
      case '/api/timeline-range': {
        const from = parseInt(url.searchParams.get('from') || '0', 10);
        const to = parseInt(url.searchParams.get('to') || String(Date.now()), 10);
        const trType = url.searchParams.get('type') || '';
        data = getTimelineRange(from, to, trType || null, Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000));
        break;
      }
      case '/api/agents': {
        data = getAgents();
        break;
      }
      case '/api/search-analytics': {
        const topEntries = db.prepare(
          'SELECT id, title, category, access_count FROM knowledge WHERE archived = 0 ORDER BY access_count DESC LIMIT 10'
        ).all();
        const categoryBreakdown = db.prepare(
          'SELECT category, COUNT(*) as count FROM knowledge WHERE archived = 0 GROUP BY category'
        ).all();
        let totalSearches = 0;
        try {
          const row = db.prepare("SELECT COUNT(*) as count FROM token_stats WHERE event_type = 'search'").get();
          totalSearches = row?.count || 0;
        } catch {}
        data = { top_entries: topEntries, category_breakdown: categoryBreakdown, total_searches: totalSearches };
        break;
      }
      case '/api/health-score': {
        const now = Date.now();
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        const sevenDays = 7 * 24 * 60 * 60 * 1000;

        const totalK = db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE archived = 0').get();
        const freshK = db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE archived = 0 AND last_accessed > ?').get(now - fourteenDays);
        const freshness = totalK.cnt > 0 ? (freshK.cnt / totalK.cnt) : 0;

        const cats = db.prepare('SELECT COUNT(DISTINCT category) as cnt FROM knowledge WHERE archived = 0').get();
        const coverage = Math.min(1, (cats.cnt || 0) / 5);

        const recentObs = db.prepare('SELECT COUNT(*) as cnt FROM observations WHERE indexed_at > ?').get(now - sevenDays);
        const activity = Math.min(1, (recentObs.cnt || 0) / 100);

        let staleRatio = 1;
        try {
          const staleCount = db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE stale = 1').get();
          staleRatio = totalK.cnt > 0 ? 1 - Math.min(1, (staleCount.cnt || 0) / totalK.cnt) : 1;
        } catch {}

        let sessionCont = 0;
        try {
          const totalSess = db.prepare('SELECT COUNT(DISTINCT session_id) as cnt FROM token_stats').get();
          const chainedSess = db.prepare('SELECT COUNT(*) as cnt FROM session_chains').get();
          sessionCont = totalSess.cnt > 0 ? Math.min(1, (chainedSess.cnt || 0) / totalSess.cnt) : 0;
        } catch {}

        const score = Math.round(freshness * 30 + coverage * 25 + activity * 20 + staleRatio * 15 + sessionCont * 10);

        data = {
          score,
          breakdown: {
            knowledge_freshness: Math.round(freshness * 100),
            knowledge_coverage: Math.round(coverage * 100),
            observation_activity: Math.round(activity * 100),
            contradiction_free: Math.round(staleRatio * 100),
            session_continuity: Math.round(sessionCont * 100),
          },
        };
        break;
      }
      case '/api/time-diff': {
        const from = parseInt(url.searchParams.get('from') || '0');
        const to = parseInt(url.searchParams.get('to') || String(Date.now()));
        const added = db.prepare(
          'SELECT id, title, category, created_at FROM knowledge WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 50'
        ).all(from, to);
        const obsRows = db.prepare(
          'SELECT type, COUNT(*) as cnt FROM observations WHERE indexed_at >= ? AND indexed_at <= ? GROUP BY type'
        ).all(from, to);
        data = { knowledge_added: added, observations: obsRows };
        break;
      }
      default:
        // Path-based observation lookup: /api/observation/<id>
        if (route.startsWith('/api/observation/')) {
          const obsId = decodeURIComponent(route.split('/').pop());
          data = getObservation(obsId);
          break;
        }
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// --- Dashboard HTML ---
function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem dashboard</title>
<style>
  :root {
    --bg: #0a0a0f;
    --bg-card: #12121a;
    --bg-card-hover: #1a1a25;
    --border: #1e1e2e;
    --text: #e2e2e8;
    --text-dim: #6b6b80;
    --text-muted: #44445a;
    --accent: #6366f1;
    --accent-dim: #4f46e5;
    --green: #22c55e;
    --green-dim: rgba(34, 197, 94, 0.15);
    --orange: #f59e0b;
    --orange-dim: rgba(245, 158, 11, 0.15);
    --red: #ef4444;
    --red-dim: rgba(239, 68, 68, 0.15);
    --blue: #3b82f6;
    --blue-dim: rgba(59, 130, 246, 0.15);
    --purple: #a855f7;
    --purple-dim: rgba(168, 85, 247, 0.15);
    --cyan: #06b6d4;
    --cyan-dim: rgba(6, 182, 212, 0.15);
    --pink: #ec4899;
    --pink-dim: rgba(236, 72, 153, 0.15);
    --radius: 10px;
    --font: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* --- Header --- */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(12px);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 20px;
  }

  .nav-link {
    font-size: 12px;
    color: var(--text-dim);
    text-decoration: none;
    padding: 5px 12px;
    border-radius: 6px;
    transition: all 0.15s ease;
    font-family: var(--font);
  }

  .nav-link:hover {
    color: var(--text);
    background: var(--bg);
  }

  .nav-link.active {
    color: var(--accent);
    background: rgba(99,102,241,0.1);
  }

  .logo {
    width: 28px;
    height: 28px;
    background: var(--accent);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: white;
  }

  .header h1 {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }

  .header h1 span { color: var(--text-dim); font-weight: 400; }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--green);
    background: var(--green-dim);
    padding: 4px 10px;
    border-radius: 20px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    background: var(--green);
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* --- Main layout --- */
  .main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* --- Stats cards --- */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    transition: all 0.2s ease;
  }

  .stat-card:hover {
    background: var(--bg-card-hover);
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  .stat-label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .stat-value {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -1px;
    line-height: 1;
  }

  .stat-sub {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .stat-value.green { color: var(--green); }
  .stat-value.blue { color: var(--blue); }
  .stat-value.purple { color: var(--purple); }
  .stat-value.orange { color: var(--orange); }

  /* --- Token bar --- */
  .token-bar-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title .icon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
  }

  .token-comparison {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .token-label {
    font-size: 11px;
    color: var(--text-dim);
    width: 80px;
    flex-shrink: 0;
  }

  .token-bar-bg {
    flex: 1;
    height: 24px;
    background: var(--border);
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }

  .token-bar-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.6s ease;
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 10px;
    font-weight: 600;
    color: white;
  }

  .token-bar-fill.original { background: var(--red); opacity: 0.7; }
  .token-bar-fill.saved { background: var(--green); }
  .token-bar-fill.summary { background: var(--accent); }

  .token-number {
    font-size: 11px;
    color: var(--text-dim);
    width: 80px;
    text-align: right;
    flex-shrink: 0;
  }

  /* --- Type breakdown --- */
  .type-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .type-tag {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid var(--border);
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .type-tag:hover { border-color: var(--accent); }
  .type-tag.active { border-color: var(--accent); background: rgba(99,102,241,0.1); }

  .type-tag .count {
    background: var(--border);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 10px;
  }

  .type-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .type-code { background: var(--blue); }
  .type-error { background: var(--red); }
  .type-log { background: var(--orange); }
  .type-test { background: var(--green); }
  .type-commit { background: var(--purple); }
  .type-decision { background: var(--pink); }
  .type-context { background: var(--cyan); }

  /* --- Timeline --- */
  .timeline-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    max-height: 600px;
    overflow-y: auto;
  }

  .timeline-section::-webkit-scrollbar { width: 6px; }
  .timeline-section::-webkit-scrollbar-track { background: transparent; }
  .timeline-section::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .timeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    max-width: 400px;
    min-width: 200px;
  }

  .search-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--text);
    font-family: var(--font);
    font-size: 12px;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
  }

  .search-input::placeholder { color: var(--text-muted); }

  .search-clear {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 11px;
    padding: 6px 10px;
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.15s ease;
    display: none;
  }

  .search-clear:hover { border-color: var(--red); color: var(--red); }
  .search-clear.visible { display: block; }

  .search-info {
    font-size: 11px;
    color: var(--text-dim);
    padding: 8px 0;
    display: none;
  }

  .search-info.visible { display: flex; align-items: center; gap: 8px; }

  .search-info .count { color: var(--accent); font-weight: 600; }
  .search-info .query { color: var(--text); }

  .highlight {
    background: rgba(99, 102, 241, 0.25);
    color: var(--text);
    border-radius: 2px;
    padding: 0 2px;
  }

  /* --- Detail panel (expand on click) --- */
  .obs-item { cursor: pointer; }

  .obs-detail {
    margin-top: 8px;
    padding: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    animation: slideDown 0.15s ease;
    display: none;
  }

  .obs-detail.open { display: block; }

  @keyframes slideDown {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 500px; }
  }

  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }

  .detail-chip {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    background: var(--border);
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .detail-chip .label { color: var(--text-muted); }
  .detail-chip .value { color: var(--text); }
  .detail-chip.savings .value { color: var(--green); }

  .detail-content {
    font-size: 11px;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    max-height: 250px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .detail-content::-webkit-scrollbar { width: 4px; }
  .detail-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .detail-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 4px;
    margin-top: 10px;
  }

  .detail-label:first-child { margin-top: 0; }

  .detail-summary-text {
    font-size: 12px;
    color: var(--accent);
    line-height: 1.5;
    margin-bottom: 4px;
  }

  .obs-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--border);
  }

  .obs-item:last-child { border-bottom: none; }
  .obs-item:hover { background: var(--bg-card-hover); }

  .obs-type-indicator {
    width: 3px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .obs-body { flex: 1; min-width: 0; }

  .obs-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .obs-type-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .badge-code { background: var(--blue-dim); color: var(--blue); }
  .badge-error { background: var(--red-dim); color: var(--red); }
  .badge-log { background: var(--orange-dim); color: var(--orange); }
  .badge-test { background: var(--green-dim); color: var(--green); }
  .badge-commit { background: var(--purple-dim); color: var(--purple); }
  .badge-decision { background: var(--pink-dim); color: var(--pink); }
  .badge-context { background: var(--cyan-dim); color: var(--cyan); }

  .obs-time {
    font-size: 10px;
    color: var(--text-muted);
    margin-left: auto;
  }

  .obs-summary {
    font-size: 12px;
    color: var(--text);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .obs-id {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 4px;
    font-family: var(--font);
  }

  /* --- Sessions --- */
  .sessions-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    max-height: 300px;
    overflow-y: auto;
  }

  .sessions-section::-webkit-scrollbar { width: 6px; }
  .sessions-section::-webkit-scrollbar-track { background: transparent; }
  .sessions-section::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 6px;
    transition: background 0.15s ease;
    border-bottom: 1px solid var(--border);
  }

  .session-row:last-child { border-bottom: none; }
  .session-row:hover { background: var(--bg-card-hover); }

  .session-id {
    font-size: 11px;
    font-family: var(--font);
    color: var(--accent);
  }

  .session-meta {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: var(--text-dim);
  }

  /* --- Two col layout --- */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  @media (max-width: 768px) {
    .two-col { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .main { padding: 16px; }
  }

  /* --- Empty state --- */
  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-dim);
  }

  .empty-state .icon { font-size: 32px; margin-bottom: 12px; }
  .empty-state p { font-size: 13px; }

  /* --- Refresh indicator --- */
  .refresh-indicator {
    font-size: 10px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* --- Compression bars --- */
  .compression-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
  }

  .compression-type {
    font-size: 11px;
    width: 65px;
    flex-shrink: 0;
    color: var(--text-dim);
  }

  .compression-bar-bg {
    flex: 1;
    height: 18px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }

  .compression-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s ease;
    display: flex;
    align-items: center;
    padding-left: 6px;
    font-size: 9px;
    font-weight: 600;
    color: white;
  }

  .compression-stats {
    font-size: 10px;
    color: var(--text-muted);
    width: 50px;
    text-align: right;
    flex-shrink: 0;
  }

  /* --- Top files --- */
  .file-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .file-row:last-child { border-bottom: none; }

  .file-rank {
    font-size: 10px;
    color: var(--text-muted);
    width: 18px;
    text-align: center;
  }

  .file-path {
    flex: 1;
    font-size: 11px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-count {
    font-size: 10px;
    color: var(--accent);
    font-weight: 600;
    flex-shrink: 0;
  }

  /* --- Privacy breakdown --- */
  .privacy-bar {
    display: flex;
    height: 28px;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  .privacy-segment {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: white;
    transition: width 0.4s ease;
    min-width: 30px;
  }

  .privacy-public { background: var(--green); }
  .privacy-private { background: var(--orange); }
  .privacy-redacted { background: var(--red); }

  .privacy-legend {
    display: flex;
    gap: 16px;
    justify-content: center;
  }

  .privacy-legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .privacy-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  /* --- Activity mini chart --- */
  .activity-chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 60px;
    padding: 4px 0;
  }

  .activity-bar {
    flex: 1;
    min-width: 3px;
    max-width: 12px;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
    transition: height 0.3s ease;
    opacity: 0.7;
  }

  .activity-bar:hover { opacity: 1; }

  .activity-labels {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  /* --- Shortcuts modal --- */
  .shortcuts-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 200;
    backdrop-filter: blur(4px);
  }

  .shortcuts-overlay.open { display: flex; }

  .shortcuts-panel {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 400px;
  }

  .shortcuts-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
  }

  .shortcut-desc {
    font-size: 12px;
    color: var(--text-dim);
  }

  .shortcut-key {
    font-size: 11px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 8px;
    color: var(--text);
    font-family: var(--font);
  }

  /* --- Export button --- */
  .export-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.15s ease;
  }

  .export-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* --- Three col layout --- */
  .three-col {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }

  @media (max-width: 900px) { .three-col { grid-template-columns: 1fr; } }

  /* --- Toast notifications --- */
  .toast-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 300;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toast {
    background: var(--bg-card);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 12px;
    color: var(--text);
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    animation: toastIn 0.3s ease, toastOut 0.3s ease 2.7s;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 350px;
  }

  .toast .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }

  @keyframes toastIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(10px); } }

  /* --- Fullscreen modal --- */
  .fullscreen-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7);
    display: none;
    z-index: 250;
    backdrop-filter: blur(4px);
    padding: 40px;
  }

  .fullscreen-overlay.open { display: flex; flex-direction: column; }

  .fullscreen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .fullscreen-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .fullscreen-close {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 12px;
    padding: 6px 14px;
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.15s;
  }

  .fullscreen-close:hover { border-color: var(--red); color: var(--red); }

  .fullscreen-content {
    flex: 1;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
    overflow-y: auto;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font);
  }

  .fullscreen-content::-webkit-scrollbar { width: 6px; }
  .fullscreen-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* --- Copy button --- */
  .copy-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.15s;
  }

  .copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .copy-btn.copied { border-color: var(--green); color: var(--green); }

  /* --- DB Health --- */
  .health-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .health-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }

  .health-item:last-child { border-bottom: none; }
  .health-label { color: var(--text-muted); }
  .health-value { color: var(--text); font-weight: 500; }
  .health-ok { color: var(--green); }
  .health-warn { color: var(--orange); }
  .health-err { color: var(--red); }

  /* --- Session active state --- */
  .session-row { cursor: pointer; }
  .session-row.active { background: rgba(99,102,241,0.1); border-left: 3px solid var(--accent); padding-left: 9px; }

  /* --- Theme toggle --- */
  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 13px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

  /* --- Light theme --- */
  body.light {
    --bg: #f5f5f8;
    --bg-card: #ffffff;
    --bg-card-hover: #f0f0f5;
    --border: #e0e0e8;
    --text: #1a1a2e;
    --text-dim: #5a5a70;
    --text-muted: #8888a0;
  }

  body.light .fullscreen-content { background: #fafafa; }
  body.light .toast { box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  body.light .graph-tooltip { background: #fff; border: 1px solid #ddd; color: #333; }
  body.light .agent-card { background: #fff; border-color: #e0e0e8; }

  /* --- Savings calculator --- */
  .savings-callout {
    background: var(--green-dim);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .savings-callout-icon {
    font-size: 20px;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    background: var(--green);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 14px;
  }

  .savings-callout-text {
    font-size: 13px;
    color: var(--text);
    line-height: 1.4;
  }

  .savings-callout-text strong { color: var(--green); }

  /* --- Init banner --- */
  .init-banner {
    background: var(--orange-dim);
    border: 1px solid rgba(245, 158, 11, 0.25);
    border-radius: 8px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
    animation: fadeIn 0.3s ease;
  }
  .init-banner-icon {
    width: 36px;
    height: 36px;
    background: var(--orange);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 16px;
    flex-shrink: 0;
  }
  .init-banner-text {
    flex: 1;
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
  }
  .init-banner-text strong { color: var(--orange); }
  .init-banner-text .init-editors { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .init-banner-btn {
    background: var(--orange);
    color: #000;
    border: none;
    padding: 8px 18px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }
  .init-banner-btn:hover { opacity: 0.85; }
  .init-banner-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .init-banner-progress {
    display: none;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    font-size: 12px;
    color: var(--orange);
  }
  .init-banner-progress .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--orange-dim);
    border-top-color: var(--orange);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .init-banner.success {
    background: var(--green-dim);
    border-color: rgba(34, 197, 94, 0.25);
  }
  .init-banner.success .init-banner-icon { background: var(--green); }
  .init-banner.success .init-banner-text strong { color: var(--green); }
  body.light .init-banner { background: rgba(245, 158, 11, 0.08); }
  body.light .init-banner.success { background: rgba(34, 197, 94, 0.08); }

  /* Vector search banner — reuses init-banner layout */
  .vector-banner {
    border-radius: 8px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
    animation: fadeIn 0.3s ease;
  }
  .vector-banner.available {
    background: var(--purple-dim, rgba(168, 85, 247, 0.1));
    border: 1px solid rgba(168, 85, 247, 0.25);
  }
  .vector-banner.missing-pkg {
    background: var(--orange-dim);
    border: 1px solid rgba(245, 158, 11, 0.25);
  }
  .vector-banner.active {
    background: var(--green-dim);
    border: 1px solid rgba(34, 197, 94, 0.25);
  }
  .vector-banner.ready {
    background: var(--cyan-dim, rgba(34, 211, 238, 0.1));
    border: 1px solid rgba(34, 211, 238, 0.25);
  }
  .vector-banner-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }
  .vector-banner.available .vector-banner-icon { background: var(--purple, #a855f7); }
  .vector-banner.missing-pkg .vector-banner-icon { background: var(--orange); }
  .vector-banner.active .vector-banner-icon { background: var(--green); }
  .vector-banner.ready .vector-banner-icon { background: var(--cyan, #22d3ee); }
  .vector-banner-text {
    flex: 1;
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
  }
  .vector-banner-text strong { color: inherit; }
  .vector-banner.available .vector-banner-text strong { color: var(--purple, #a855f7); }
  .vector-banner.missing-pkg .vector-banner-text strong { color: var(--orange); }
  .vector-banner.active .vector-banner-text strong { color: var(--green); }
  .vector-banner.ready .vector-banner-text strong { color: var(--cyan, #22d3ee); }
  .vector-banner-sub { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .vector-banner-btn {
    border: none;
    padding: 8px 18px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    color: #000;
  }
  .vector-banner.available .vector-banner-btn { background: var(--purple, #a855f7); }
  .vector-banner.missing-pkg .vector-banner-btn { background: var(--orange); }
  .vector-banner-btn:hover { opacity: 0.85; }
  .vector-banner-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .vector-banner-progress {
    display: none;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    font-size: 12px;
    color: var(--purple, #a855f7);
  }
  .vector-banner-progress .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--purple-dim, rgba(168, 85, 247, 0.2));
    border-top-color: var(--purple, #a855f7);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  body.light .vector-banner.available { background: rgba(168, 85, 247, 0.08); }
  body.light .vector-banner.missing-pkg { background: rgba(245, 158, 11, 0.08); }
  body.light .vector-banner.active { background: rgba(34, 197, 94, 0.08); }
  body.light .vector-banner.ready { background: rgba(34, 211, 238, 0.08); }

  /* --- Footer --- */
  .footer {
    text-align: center;
    padding: 20px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  .footer a { color: var(--accent); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }

  /* --- Budget Bar --- */
  .budget-section { position: relative; }
  .budget-bar-bg {
    height: 20px;
    background: var(--bg);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 8px;
  }
  .budget-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s ease;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 6px;
    font-size: 10px;
    font-weight: 600;
    color: white;
  }
  .budget-bar-fill.ok { background: var(--green); }
  .budget-bar-fill.warn { background: var(--orange); }
  .budget-bar-fill.danger { background: var(--red); }
  .budget-meta {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 10px;
    color: var(--text-muted);
  }
  .budget-strategy {
    display: inline-block;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: 6px;
  }
  .strategy-warn { background: var(--orange-dim); color: var(--orange); }
  .strategy-aggressive_truncation { background: var(--red-dim); color: var(--red); }
  .strategy-hard_stop { background: var(--red-dim); color: var(--red); }

  /* --- Knowledge Base --- */
  .knowledge-category {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.15s;
  }
  .knowledge-category:hover { border-color: var(--accent); }
  .knowledge-category .cat-count {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-card);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .cat-pattern { color: var(--blue); }
  .cat-decision { color: var(--purple); }
  .cat-error { color: var(--red); }
  .cat-api { color: var(--cyan); }
  .cat-component { color: var(--green); }

  .knowledge-item {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .knowledge-item:last-child { border-bottom: none; }
  .knowledge-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }
  .knowledge-item-title { font-weight: 600; color: var(--text); }
  .knowledge-item-cat {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .knowledge-item-content {
    color: var(--text-dim);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .knowledge-item-meta {
    margin-top: 3px;
    font-size: 9px;
    color: var(--text-muted);
    display: flex;
    gap: 10px;
  }

  /* --- Events --- */
  .event-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .event-item:last-child { border-bottom: none; }
  .event-priority {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .event-p1 { background: var(--red-dim); color: var(--red); }
  .event-p2 { background: var(--orange-dim); color: var(--orange); }
  .event-p3 { background: var(--blue-dim); color: var(--blue); }
  .event-p4 { background: var(--bg); color: var(--text-muted); border: 1px solid var(--border); }
  .event-body { flex: 1; min-width: 0; }
  .event-type {
    font-weight: 600;
    color: var(--text);
  }
  .event-data {
    color: var(--text-dim);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .event-time {
    font-size: 9px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .event-type-dist {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }
  .event-type-tag {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .error-fix-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 10px;
    border-radius: 4px;
    background: var(--green-dim);
    margin-bottom: 4px;
  }
  .error-fix-icon { color: var(--green); font-weight: 700; }

  /* --- Content Sources --- */
  .source-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .source-item:last-child { border-bottom: none; }
  .source-name { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source-meta {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .source-chunks {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--blue-dim);
    color: var(--blue);
  }
  .source-code {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--green-dim);
    color: var(--green);
  }

  /* --- Snapshots --- */
  .snapshot-item {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .snapshot-item:last-child { border-bottom: none; }
  .snapshot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .snapshot-session { font-weight: 600; color: var(--text); font-size: 11px; }
  .snapshot-time { font-size: 9px; color: var(--text-muted); }
  .snapshot-stats {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: var(--text-dim);
  }
  .snapshot-stat-val { font-weight: 600; color: var(--green); }
/* --- Project Bar --- */
.project-bar {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 8px 24px;
}
.project-bar-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1400px;
  margin: 0 auto;
}
.project-bar-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.project-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
  overflow-x: auto;
}
.project-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  transition: all 0.15s ease;
  white-space: nowrap;
  user-select: none;
}
.project-pill:hover {
  border-color: var(--cyan);
  color: var(--text);
  background: var(--bg-card);
}
.project-pill.active {
  background: var(--cyan-dim, rgba(0,212,255,0.1));
  border-color: var(--cyan);
  color: var(--cyan);
  font-weight: 600;
}
.project-pill .pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green, #4ade80);
  flex-shrink: 0;
}
.project-pill.skeleton {
  opacity: 0.4;
  cursor: default;
}
.project-count {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  white-space: nowrap;
}

/* --- Knowledge Graph --- */
.graph-section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.graph-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.graph-controls input, .graph-controls select {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text);
  font-family: var(--font);
}
.graph-controls button {
  background: var(--accent);
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font);
  transition: background 0.15s;
}
.graph-controls button:hover { background: var(--accent-dim); }
.graph-canvas {
  width: 100%;
  height: 400px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  background: var(--bg);
}
.graph-canvas svg {
  width: 100%;
  height: 100%;
}
.graph-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}
.graph-tooltip {
  position: absolute;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--text);
  pointer-events: none;
  z-index: 50;
  max-width: 280px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  display: none;
}
.graph-tooltip .tt-name { font-weight: 600; margin-bottom: 4px; }
.graph-tooltip .tt-type { color: var(--text-dim); font-size: 11px; }
.graph-node-label {
  font-size: 10px;
  fill: var(--text);
  pointer-events: none;
  text-anchor: middle;
  dominant-baseline: central;
}
.graph-stats {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-dim);
}

/* --- Agents Panel --- */
.agents-section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}
.agent-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  transition: border-color 0.15s;
}
.agent-card:hover { border-color: var(--accent); }
.agent-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.agent-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.agent-status-dot.active { background: var(--green); }
.agent-status-dot.idle { background: var(--orange); }
.agent-status-dot.offline { background: var(--text-muted); }
.agent-detail {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 4px;
  line-height: 1.5;
}
.agent-detail strong { color: var(--text); font-weight: 500; }
.agent-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.agent-file-tag {
  font-size: 10px;
  padding: 2px 8px;
  background: var(--blue-dim);
  color: var(--blue);
  border-radius: 10px;
}
.agents-empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 20px 0;
  text-align: center;
}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <h1>ContextMem</h1>
    <nav class="nav-links">
      <a href="/" class="nav-link active">Home</a>
      <a href="/graph" class="nav-link">Graph</a>
      <a href="/timeline" class="nav-link">Timeline</a>
    </nav>
  </div>
  <div style="display:flex;align-items:center;gap:12px;">
    <div class="refresh-indicator" id="refreshInfo">auto-refresh: 3s</div>
    <button class="theme-toggle" id="themeToggle" title="Toggle light/dark theme">L</button>
    <button class="export-btn" onclick="document.getElementById('shortcutsOverlay').classList.add('open')" title="Keyboard shortcuts">?</button>
    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="statusText">connected</span>
    </div>
  </div>
</div>

<!-- Project switcher bar -->
<div class="project-bar" id="projectBar">
  <div class="project-bar-inner">
    <div class="project-bar-label" id="projectLabel">Project</div>
    <div class="project-pills" id="projectPills"></div>
  </div>
</div>

<div class="main">
  <!-- Stats cards -->
  <div class="stats-grid" id="statsGrid">
    <div class="stat-card">
      <div class="stat-label">Observations</div>
      <div class="stat-value blue" id="statObs">-</div>
      <div class="stat-sub" id="statObsSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Tokens saved</div>
      <div class="stat-value green" id="statSaved">-</div>
      <div class="stat-sub" id="statSavedSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Savings</div>
      <div class="stat-value green" id="statPct">-</div>
      <div class="stat-sub">compression ratio</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Searches</div>
      <div class="stat-value purple" id="statSearches">-</div>
      <div class="stat-sub" id="statSearchSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">DB size</div>
      <div class="stat-value orange" id="statDb">-</div>
      <div class="stat-sub" id="statDbSub"></div>
    </div>
    <div class="stat-card" id="health-card">
      <div class="stat-label">Health Score</div>
      <div class="stat-value" id="health-score" style="font-size:2em">--</div>
    </div>
  </div>

  <!-- Init banner -->
  <div class="init-banner" id="initBanner" style="display:none;">
    <div class="init-banner-icon">!</div>
    <div class="init-banner-text">
      <div><strong>Setup recommended</strong> — Run <code>context-mem init</code> to auto-configure editor rules and project settings.</div>
      <div class="init-editors" id="initEditors"></div>
    </div>
    <div class="init-banner-progress" id="initProgress">
      <div class="spinner"></div>
      Running init...
    </div>
    <button class="init-banner-btn" id="initBtn" onclick="runInit()">Run Init</button>
  </div>

  <!-- Vector search banner -->
  <div class="vector-banner available" id="vectorBanner" style="display:none;">
    <div class="vector-banner-icon" id="vectorIcon">V</div>
    <div class="vector-banner-text" id="vectorText"></div>
    <div class="vector-banner-progress" id="vectorProgress">
      <div class="spinner"></div>
      Updating config...
    </div>
    <button class="vector-banner-btn" id="vectorBtn" style="display:none;"></button>
  </div>

  <!-- Savings calculator -->
  <div class="savings-callout" id="savingsCallout" style="display:none;">
    <div class="savings-callout-icon">S</div>
    <div class="savings-callout-text" id="savingsText"></div>
  </div>

  <!-- Token economics -->
  <div class="token-bar-section">
    <div class="section-title">
      <div class="icon" style="background:var(--green-dim);color:var(--green);">T</div>
      Token Economics
    </div>
    <div class="token-comparison" id="tokenBars">
      <div class="token-row">
        <div class="token-label">Original</div>
        <div class="token-bar-bg"><div class="token-bar-fill original" id="barOriginal" style="width:100%"></div></div>
        <div class="token-number" id="numOriginal">-</div>
      </div>
      <div class="token-row">
        <div class="token-label">Summarized</div>
        <div class="token-bar-bg"><div class="token-bar-fill summary" id="barSummary" style="width:0%"></div></div>
        <div class="token-number" id="numSummary">-</div>
      </div>
      <div class="token-row">
        <div class="token-label">Saved</div>
        <div class="token-bar-bg"><div class="token-bar-fill saved" id="barSaved" style="width:0%"></div></div>
        <div class="token-number" id="numSaved">-</div>
      </div>
    </div>
  </div>

  <!-- Type breakdown + Sessions -->
  <div class="two-col">
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--blue-dim);color:var(--blue);" id="typeCountIcon">0</div>
        Observation Types
      </div>
      <div class="type-grid" id="typeGrid"></div>
    </div>

    <div class="sessions-section">
      <div class="section-title">
        <div class="icon" style="background:var(--purple-dim);color:var(--purple);" id="sessionCountIcon">0</div>
        Sessions
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;" id="sessionFilterHint"></span>
      </div>
      <div id="sessionsList"></div>
    </div>
  </div>

  <!-- Compression + Files + Privacy -->
  <div class="three-col">
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--green-dim);color:var(--green);">%</div>
        Compression by Type
      </div>
      <div id="compressionBars"></div>
    </div>

    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">F</div>
        Top Files
      </div>
      <div id="topFiles"></div>
    </div>

    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--orange-dim);color:var(--orange);">P</div>
        Privacy
      </div>
      <div id="privacyBreakdown"></div>
    </div>
  </div>

  <!-- Budget Status -->
  <div class="token-bar-section budget-section">
    <div class="section-title">
      <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">B</div>
      Token Budget
      <span id="budgetStrategyBadge" class="budget-strategy"></span>
    </div>
    <div id="budgetContent">
      <div class="empty-state"><p>Loading...</p></div>
    </div>
  </div>

  <!-- Knowledge Base + Content Index -->
  <div class="two-col">
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--purple-dim);color:var(--purple);">K</div>
        Knowledge Base
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;" id="knowledgeCount">0 entries</span>
      </div>
      <div style="position:relative;margin-bottom:8px;">
        <input id="knowledgeSearchInput" type="text" placeholder="Search knowledge..." style="width:100%;padding:6px 28px 6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--font);font-size:11px;outline:none;" />
        <span id="knowledgeSearchClear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--text-muted);font-size:12px;display:none;">&times;</span>
      </div>
      <div id="knowledgeCategories" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;"></div>
      <div id="knowledgeList" style="max-height:250px;overflow-y:auto;"></div>
    </div>

    <div class="token-bar-section" id="analytics-card">
      <div class="section-title">
        <div class="icon" style="background:var(--blue-dim);color:var(--blue);">A</div>
        Search Analytics
      </div>
      <div id="analytics-content">Loading...</div>
    </div>

    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">I</div>
        Content Index
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;" id="contentSourceCount">0 sources</span>
      </div>
      <div id="contentSourcesList" style="max-height:250px;overflow-y:auto;"></div>
    </div>
  </div>

  <!-- Events + Snapshots -->
  <div class="two-col">
    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--red-dim);color:var(--red);">E</div>
        Event Stream
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;" id="eventCount">0 events</span>
      </div>
      <div id="eventTypeDist" class="event-type-dist"></div>
      <div id="errorFixes" style="margin-bottom:8px;"></div>
      <div id="eventsList" style="max-height:250px;overflow-y:auto;"></div>
    </div>

    <div class="token-bar-section">
      <div class="section-title">
        <div class="icon" style="background:var(--pink-dim);color:var(--pink);">S</div>
        Session Snapshots
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;" id="snapshotCount">0 snapshots</span>
      </div>
      <div id="snapshotsList" style="max-height:250px;overflow-y:auto;"></div>
    </div>
  </div>

  <!-- Session Activity -->
  <div class="token-bar-section">
    <div class="section-title" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="icon" style="background:var(--purple-dim);color:var(--purple);">A</div>
        Session Activity <span style="font-weight:400;color:var(--text-muted);font-size:11px;">(7 days)</span>
      </div>
      <button class="export-btn" onclick="window.location.href='/api/export'">Export JSON</button>
    </div>
    <div class="activity-chart" id="activityChart"></div>
    <div class="activity-labels" id="activityLabels"></div>
  </div>

  <!-- DB Health -->
  <div class="token-bar-section">
    <div class="section-title">
      <div class="icon" style="background:var(--green-dim);color:var(--green);">H</div>
      Database Health
    </div>
    <div class="health-grid" id="dbHealth"></div>
  </div>

  <!-- Toast container -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- Fullscreen content viewer -->
  <div class="fullscreen-overlay" id="fullscreenOverlay">
    <div class="fullscreen-header">
      <div class="fullscreen-header-left">
        <span class="obs-type-badge" id="fullscreenBadge"></span>
        <span style="font-size:12px;color:var(--text-dim);" id="fullscreenId"></span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="copy-btn" id="fullscreenCopy">Copy content</button>
        <button class="fullscreen-close" onclick="document.getElementById('fullscreenOverlay').classList.remove('open')">Close (Esc)</button>
      </div>
    </div>
    <div class="fullscreen-content" id="fullscreenBody"></div>
  </div>

  <!-- Shortcuts modal -->
  <div class="shortcuts-overlay" id="shortcutsOverlay">
    <div class="shortcuts-panel">
      <div class="shortcuts-title">Keyboard Shortcuts</div>
      <div class="shortcut-row"><span class="shortcut-desc">Search observations</span><span class="shortcut-key">/</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Close search / panel</span><span class="shortcut-key">Esc</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Show shortcuts</span><span class="shortcut-key">?</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Refresh data</span><span class="shortcut-key">r</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Clear all filters</span><span class="shortcut-key">c</span></div>
      <div class="shortcut-row"><span class="shortcut-desc">Toggle theme</span><span class="shortcut-key">t</span></div>
      <div style="border-top:1px solid var(--border);margin:10px 0;"></div>
      <div class="shortcut-row"><span class="shortcut-desc" style="color:var(--text-muted);">Click card to expand details</span></div>
      <div class="shortcut-row"><span class="shortcut-desc" style="color:var(--text-muted);">Double-click content for fullscreen</span></div>
      <div class="shortcut-row"><span class="shortcut-desc" style="color:var(--text-muted);">Click session to filter by it</span></div>
    </div>
  </div>

  <!-- Knowledge Graph -->
  <div class="graph-section" id="graphSection">
    <div class="section-title">
      <div class="icon" style="background:var(--purple-dim);color:var(--purple);">G</div>
      Knowledge Graph
    </div>
    <div class="graph-controls">
      <input type="text" id="graphEntityFilter" placeholder="Filter entity..." />
      <select id="graphDepth">
        <option value="1">Depth 1</option>
        <option value="2" selected>Depth 2</option>
        <option value="3">Depth 3</option>
        <option value="4">Depth 4</option>
        <option value="5">Depth 5</option>
      </select>
      <button onclick="loadGraph()">Load Graph</button>
    </div>
    <div class="graph-canvas" id="graphCanvas">
      <div class="graph-empty" id="graphEmpty">Load graph data to visualize entity relationships</div>
    </div>
    <div class="graph-tooltip" id="graphTooltip">
      <div class="tt-name" id="ttName"></div>
      <div class="tt-type" id="ttType"></div>
    </div>
    <div class="graph-stats" id="graphStats"></div>
  </div>

  <!-- Agents -->
  <div class="agents-section" id="agentsSection">
    <div class="section-title">
      <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">A</div>
      Active Agents
      <span style="font-size:10px;color:var(--text-muted);margin-left:auto;" id="agentsRefreshHint">auto-refreshes</span>
    </div>
    <div id="agentsContainer">
      <div class="agents-empty">No agents registered</div>
    </div>
  </div>

  <!-- Timeline -->
  <div class="timeline-section">
    <div class="timeline-header">
      <div class="section-title" style="margin-bottom:0;flex-shrink:0;">
        <div class="icon" style="background:var(--cyan-dim);color:var(--cyan);">L</div>
        Observations
      </div>
      <div class="search-box">
        <input type="text" class="search-input" id="searchInput" placeholder="Search observations... (Enter to search)" autocomplete="off" spellcheck="false">
        <button class="search-clear" id="searchClear">Clear</button>
      </div>
    </div>
    <div class="search-info" id="searchInfo">
      <span>Found <span class="count" id="searchCount">0</span> results for "<span class="query" id="searchQuery"></span>"</span>
    </div>
    <div id="timeline"></div>
  </div>
</div>

<div class="footer">
  context-mem v0.4.0 &mdash; context optimization for AI coding assistants
</div>

<script>
const API = '';
let currentFilter = null;
let currentSearch = '';
let searchDebounceTimer = null;
let openDetailId = null;
let currentSession = null;
let lastObsCount = null;
let currentTheme = localStorage.getItem('cm-theme') || 'dark';
let fullscreenData = null;

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function fetchJson(url) {
  const res = await fetch(API + url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// --- Project switcher (multi-project) ---
let activeProjectDb = localStorage.getItem('cm-active-project') || null;

function updateProjectBar(instances) {
  var label = document.getElementById('projectLabel');
  if (!label) return;
  if (!instances || instances.length <= 1) {
    var name = instances && instances[0] ? instances[0].projectName : '${path.basename(PROJECT_DIR).replace(/[<>&"]/g, '')}';
    label.textContent = 'Project  ' + name;
  } else {
    label.textContent = 'Projects';
  }
}

async function loadProjects() {
  try {
    const instances = await fetchJson('/api/instances');
    const container = document.getElementById('projectPills');
    const bar = document.getElementById('projectBar');

    if (!instances.length) {
      activeProjectDb = null;
      container.innerHTML = '';
      updateProjectBar(instances);
      return;
    }

    // Validate persisted selection
    if (activeProjectDb) {
      var validSelection = instances.some(function(i) { return i.dbPath === activeProjectDb; });
      if (!validSelection) activeProjectDb = instances[0].dbPath;
    } else {
      activeProjectDb = instances[0].dbPath;
    }

    if (instances.length === 1) {
      container.innerHTML = '';
    } else {
      container.innerHTML = instances.map(i => {
        const isActive = i.dbPath === activeProjectDb;
        return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + escHtml(i.dbPath) + '" title="' + escHtml(i.projectDir) + '">' +
          '<span class="pill-dot"></span>' +
          escHtml(i.projectName) +
        '</div>';
      }).join('');
    }

    updateProjectBar(instances);

    container.querySelectorAll('.project-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const db = pill.getAttribute('data-db');
        if (db === activeProjectDb) return;
        try {
          await fetchJson('/api/switch-project?db=' + encodeURIComponent(db));
          activeProjectDb = db;
          localStorage.setItem('cm-active-project', activeProjectDb);
          container.querySelectorAll('.project-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          updateProjectBar(instances);
          refresh();
        } catch {}
      });
    });
  } catch {}
}

function switchToProject(projectDir) {
  fetchJson('/api/instances').then(instances => {
    const inst = instances.find(i => i.projectDir === projectDir);
    if (inst) {
      fetchJson('/api/switch-project?db=' + encodeURIComponent(inst.dbPath)).then(() => {
        activeProjectDb = inst.dbPath;
        localStorage.setItem('cm-active-project', activeProjectDb);
        loadProjects();
        refresh();
        checkVectorStatus();
      });
    }
  });
}

loadProjects();
setInterval(loadProjects, 10000);

async function refresh() {
  try {
    // --- Project view ---
    // Determine if searching or browsing
    const isSearching = currentSearch.length > 0;

    const fetches = [
      fetchJson('/api/stats'),
      fetchJson('/api/sessions'),
      fetchJson('/api/compression'),
      fetchJson('/api/top-files'),
      fetchJson('/api/privacy'),
      fetchJson('/api/activity'),
      fetchJson('/api/db-health'),
      fetchJson('/api/budget'),
      fetchJson('/api/knowledge-stats'),
      fetchJson('/api/knowledge'),
      fetchJson('/api/event-stats'),
      fetchJson('/api/events?limit=30'),
      fetchJson('/api/snapshots'),
      fetchJson('/api/content-sources'),
    ];

    if (isSearching) {
      let searchUrl = '/api/search?q=' + encodeURIComponent(currentSearch);
      if (currentFilter) searchUrl += '&type=' + currentFilter;
      if (currentSession) searchUrl += '&session=' + currentSession;
      fetches.push(fetchJson(searchUrl));
    } else {
      let tlUrl = '/api/timeline?limit=50';
      if (currentFilter) tlUrl += '&type=' + currentFilter;
      if (currentSession) tlUrl += '&session=' + currentSession;
      fetches.push(fetchJson(tlUrl));
    }

    const [stats, sessions, compression, topFiles, privacy, activity, dbHealth, budget, knowledgeStats, knowledge, eventStats, events, snapshots, contentSources, timeline] = await Promise.all(fetches);

    // Stats cards
    document.getElementById('statObs').textContent = fmt(stats.observations);
    document.getElementById('statObsSub').textContent = stats.sessions + ' session' + (stats.sessions !== 1 ? 's' : '');
    document.getElementById('statSaved').textContent = fmt(stats.tokens_saved);
    document.getElementById('statSavedSub').textContent = fmt(stats.tokens_in) + ' original tokens';
    document.getElementById('statPct').textContent = stats.savings_pct + '%';
    document.getElementById('statSearches').textContent = fmt(stats.searches);
    document.getElementById('statSearchSub').textContent = stats.embedded_count > 0
      ? stats.reads + ' reads · ' + stats.embedded_count + ' embedded'
      : stats.reads + ' full reads';
    document.getElementById('statDb').textContent = stats.db_size_kb < 1024
      ? stats.db_size_kb + ' KB'
      : (stats.db_size_kb / 1024).toFixed(1) + ' MB';
    document.getElementById('statDbSub').textContent = stats.store_events + ' store events';

    // Health score
    fetch('/api/health-score').then(r => r.json()).then(data => {
      const el = document.getElementById('health-score');
      if (el) {
        el.textContent = data.score;
        el.style.color = data.score > 70 ? 'var(--green)' : data.score > 40 ? 'var(--orange)' : 'var(--red)';
      }
    }).catch(() => {});

    // Search analytics
    fetch('/api/search-analytics').then(r => r.json()).then(data => {
      const el = document.getElementById('analytics-content');
      if (el && data.top_entries) {
        el.innerHTML = data.top_entries.slice(0, 5).map(e =>
          '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">' +
            '<span style="color:var(--text)">' + escHtml(e.title.slice(0, 40)) + '</span>' +
            '<span style="color:var(--text-dim)">' + e.access_count + 'x</span>' +
          '</div>'
        ).join('') || '<span style="color:var(--text-dim)">No data yet</span>';
      }
    }).catch(() => {});

    // --- Savings Calculator ---
    const savingsCallout = document.getElementById('savingsCallout');
    if (stats.tokens_saved > 0) {
      // Claude context window: ~200K tokens. Average read: ~4K tokens per tool call.
      // tokens_saved = tokens we didn't need to send. At ~750 tokens/minute reading speed:
      const minutesSaved = (stats.tokens_saved / 750).toFixed(1);
      const pctOfContext = ((stats.tokens_saved / 200000) * 100).toFixed(1);
      document.getElementById('savingsText').innerHTML =
        'Saved <strong>' + fmt(stats.tokens_saved) + ' tokens</strong> (' + stats.savings_pct + '% compression) — ' +
        'equivalent to <strong>~' + minutesSaved + ' min</strong> of context window, ' +
        'or <strong>' + pctOfContext + '%</strong> of Claude\\'s 200K context.';
      savingsCallout.style.display = 'flex';
    } else {
      savingsCallout.style.display = 'none';
    }

    // --- Toast: new observations ---
    if (lastObsCount !== null && stats.observations > lastObsCount) {
      const diff = stats.observations - lastObsCount;
      showToast('+' + diff + ' new observation' + (diff > 1 ? 's' : ''));
    }
    lastObsCount = stats.observations;

    // Token bars
    const maxTokens = Math.max(stats.tokens_in, 1);
    document.getElementById('barOriginal').style.width = '100%';
    document.getElementById('barSummary').style.width = Math.round((stats.tokens_out / maxTokens) * 100) + '%';
    document.getElementById('barSaved').style.width = Math.round((stats.tokens_saved / maxTokens) * 100) + '%';
    document.getElementById('numOriginal').textContent = fmt(stats.tokens_in);
    document.getElementById('numSummary').textContent = fmt(stats.tokens_out);
    document.getElementById('numSaved').textContent = fmt(stats.tokens_saved);

    // Type breakdown
    const typeGrid = document.getElementById('typeGrid');
    document.getElementById('typeCountIcon').textContent = stats.by_type.length;
    typeGrid.innerHTML = stats.by_type.map(t =>
      '<div class="type-tag' + (currentFilter === t.type ? ' active' : '') + '" data-type="' + t.type + '">' +
        '<div class="type-dot type-' + t.type + '"></div>' +
        t.type +
        '<span class="count">' + t.count + '</span>' +
      '</div>'
    ).join('');

    typeGrid.querySelectorAll('.type-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const type = tag.dataset.type;
        currentFilter = currentFilter === type ? null : type;
        refresh();
      });
    });

    // Sessions (clickable for filtering)
    document.getElementById('sessionCountIcon').textContent = sessions.length;
    document.getElementById('sessionFilterHint').textContent = currentSession ? 'click to clear filter' : 'click to filter';
    const sessionsList = document.getElementById('sessionsList');
    if (sessions.length === 0) {
      sessionsList.innerHTML = '<div class="empty-state"><p>No sessions yet</p></div>';
    } else {
      sessionsList.innerHTML = sessions.map(s =>
        '<div class="session-row' + (currentSession === s.session_id ? ' active' : '') + '" data-sid="' + s.session_id + '">' +
          '<div class="session-id">' + s.session_id.slice(0, 12) + '...</div>' +
          '<div class="session-meta">' +
            '<span>' + s.obs_count + ' obs</span>' +
            '<span>' + timeAgo(s.last_at) + '</span>' +
          '</div>' +
        '</div>'
      ).join('');

      sessionsList.querySelectorAll('.session-row').forEach(row => {
        row.addEventListener('click', () => {
          const sid = row.dataset.sid;
          currentSession = currentSession === sid ? null : sid;
          refresh();
        });
      });
    }

    // --- Compression by Type ---
    const compressionEl = document.getElementById('compressionBars');
    if (compression.length === 0) {
      compressionEl.innerHTML = '<div class="empty-state"><p>No data yet</p></div>';
    } else {
      const typeColors = { code: 'var(--blue)', error: 'var(--red)', log: 'var(--orange)', test: 'var(--green)', commit: 'var(--purple)', decision: 'var(--pink)', context: 'var(--cyan)' };
      compressionEl.innerHTML = compression.map(c =>
        '<div class="compression-row">' +
          '<div class="compression-type">' + c.type + '</div>' +
          '<div class="compression-bar-bg">' +
            '<div class="compression-bar-fill" style="width:' + Math.max(c.compression_pct, 2) + '%;background:' + (typeColors[c.type] || 'var(--accent)') + ';">' +
              (c.compression_pct > 15 ? c.compression_pct + '%' : '') +
            '</div>' +
          '</div>' +
          '<div class="compression-stats">' + c.compression_pct + '%</div>' +
        '</div>'
      ).join('');
    }

    // --- Top Files ---
    const topFilesEl = document.getElementById('topFiles');
    if (topFiles.length === 0) {
      topFilesEl.innerHTML = '<div class="empty-state"><p>No file data</p></div>';
    } else {
      topFilesEl.innerHTML = topFiles.map((f, i) =>
        '<div class="file-row">' +
          '<div class="file-rank">' + (i + 1) + '</div>' +
          '<div class="file-path" title="' + escHtml(f.file_path) + '">' + escHtml(f.file_path.split('/').slice(-2).join('/')) + '</div>' +
          '<div class="file-count">' + f.count + 'x</div>' +
        '</div>'
      ).join('');
    }

    // --- Privacy Breakdown ---
    const privacyEl = document.getElementById('privacyBreakdown');
    const privTotal = privacy.reduce((s, p) => s + p.count, 0);
    if (privTotal === 0) {
      privacyEl.innerHTML = '<div class="empty-state"><p>No data</p></div>';
    } else {
      const privColors = { public: 'privacy-public', private: 'privacy-private', redacted: 'privacy-redacted' };
      privacyEl.innerHTML =
        '<div class="privacy-bar">' +
          privacy.map(p =>
            '<div class="privacy-segment ' + (privColors[p.level] || 'privacy-public') + '" style="width:' + Math.max(Math.round((p.count / privTotal) * 100), 5) + '%;">' +
              Math.round((p.count / privTotal) * 100) + '%' +
            '</div>'
          ).join('') +
        '</div>' +
        '<div class="privacy-legend">' +
          privacy.map(p =>
            '<div class="privacy-legend-item">' +
              '<div class="privacy-legend-dot ' + (privColors[p.level] || 'privacy-public') + '"></div>' +
              p.level + ' (' + p.count + ')' +
            '</div>'
          ).join('') +
        '</div>';
    }

    // --- Activity Chart ---
    const activityEl = document.getElementById('activityChart');
    const activityLabelsEl = document.getElementById('activityLabels');
    if (activity.length === 0) {
      activityEl.innerHTML = '<div class="empty-state" style="height:60px;display:flex;align-items:center;justify-content:center;width:100%;"><p>No recent activity</p></div>';
      activityLabelsEl.innerHTML = '';
    } else {
      const maxCount = Math.max(...activity.map(a => a.count), 1);
      activityEl.innerHTML = activity.map(a => {
        const h = Math.max(Math.round((a.count / maxCount) * 56), 3);
        return '<div class="activity-bar" style="height:' + h + 'px;" title="' + a.count + ' observations"></div>';
      }).join('');

      if (activity.length > 1) {
        const first = new Date(activity[0].hour_bucket);
        const last = new Date(activity[activity.length - 1].hour_bucket);
        activityLabelsEl.innerHTML =
          '<span>' + first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>' +
          '<span>' + last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>';
      }
    }

    // --- DB Health ---
    const dbHealthEl = document.getElementById('dbHealth');
    const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB';
    dbHealthEl.innerHTML =
      '<div class="health-item"><span class="health-label">Schema</span><span class="health-value">v' + dbHealth.schema_version + '</span></div>' +
      '<div class="health-item"><span class="health-label">DB Size</span><span class="health-value">' + fmtBytes(dbHealth.db_size_bytes) + '</span></div>' +
      '<div class="health-item"><span class="health-label">WAL</span><span class="health-value">' + (dbHealth.wal_size_bytes > 0 ? fmtBytes(dbHealth.wal_size_bytes) : 'clean') + '</span></div>' +
      '<div class="health-item"><span class="health-label">Observations</span><span class="health-value">' + dbHealth.observations + '</span></div>' +
      '<div class="health-item"><span class="health-label">FTS5 Index</span><span class="health-value ' + (dbHealth.fts5_ok ? 'health-ok' : 'health-err') + '">' + (dbHealth.fts5_ok ? 'OK' : 'ERROR') + '</span></div>' +
      '<div class="health-item"><span class="health-label">Trigram</span><span class="health-value ' + (dbHealth.trigram_ok ? 'health-ok' : 'health-err') + '">' + (dbHealth.trigram_ok ? 'OK' : 'ERROR') + '</span></div>' +
      (dbHealth.oldest_at ? '<div class="health-item"><span class="health-label">Oldest</span><span class="health-value">' + formatDate(dbHealth.oldest_at) + '</span></div>' : '') +
      (dbHealth.newest_at ? '<div class="health-item"><span class="health-label">Newest</span><span class="health-value">' + formatDate(dbHealth.newest_at) + '</span></div>' : '');

    // --- Budget Status ---
    const budgetEl = document.getElementById('budgetContent');
    const budgetBadge = document.getElementById('budgetStrategyBadge');
    if (budget && budget.limit > 0) {
      const barClass = budget.blocked ? 'danger' : budget.throttled ? 'warn' : 'ok';
      const statusLabel = budget.blocked ? 'BLOCKED' : budget.throttled ? 'THROTTLED' : 'OK';
      budgetBadge.textContent = budget.strategy;
      budgetBadge.className = 'budget-strategy strategy-' + budget.strategy;
      budgetEl.innerHTML =
        '<div class="budget-bar-bg">' +
          '<div class="budget-bar-fill ' + barClass + '" style="width:' + Math.min(budget.pct, 100) + '%;">' +
            (budget.pct > 10 ? budget.pct + '%' : '') +
          '</div>' +
        '</div>' +
        '<div class="budget-meta">' +
          '<span>' + fmt(budget.used) + ' / ' + fmt(budget.limit) + ' tokens</span>' +
          '<span style="font-weight:600;color:var(--' + (budget.blocked ? 'red' : budget.throttled ? 'orange' : 'green') + ');">' + statusLabel + '</span>' +
        '</div>';
    } else {
      budgetBadge.textContent = '';
      budgetEl.innerHTML = '<div class="empty-state"><p>No budget configured</p></div>';
    }

    // --- Knowledge Base ---
    document.getElementById('knowledgeCount').textContent = knowledgeStats.total + ' entries' + (knowledgeStats.archived > 0 ? ' (' + knowledgeStats.archived + ' archived)' : '');
    const kCatsEl = document.getElementById('knowledgeCategories');
    const catColors = { pattern: 'cat-pattern', decision: 'cat-decision', error: 'cat-error', api: 'cat-api', component: 'cat-component' };
    kCatsEl.innerHTML = knowledgeStats.categories.map(c =>
      '<div class="knowledge-category ' + (catColors[c.category] || '') + '">' +
        c.category +
        '<span class="cat-count">' + c.count + '</span>' +
      '</div>'
    ).join('');

    // Only update the knowledge list if no active search query
    if (!knowledgeSearchQuery) {
      renderKnowledgeList(knowledge);
    }

    // --- Content Sources ---
    document.getElementById('contentSourceCount').textContent = contentSources.length + ' sources';
    const csListEl = document.getElementById('contentSourcesList');
    if (contentSources.length === 0) {
      csListEl.innerHTML = '<div class="empty-state"><p>No indexed content yet</p></div>';
    } else {
      csListEl.innerHTML = contentSources.map(cs =>
        '<div class="source-item">' +
          '<div class="source-name" title="' + escHtml(cs.source) + '">' + escHtml(cs.source) + '</div>' +
          '<div class="source-meta">' +
            '<span class="source-chunks">' + cs.chunk_count + ' chunks</span>' +
            (cs.code_chunks > 0 ? '<span class="source-code">' + cs.code_chunks + ' code</span>' : '') +
            '<span>' + fmtBytes(cs.total_bytes || 0) + '</span>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    // --- Events ---
    document.getElementById('eventCount').textContent = eventStats.total + ' events';
    const evtDistEl = document.getElementById('eventTypeDist');
    evtDistEl.innerHTML = eventStats.by_type.map(t =>
      '<div class="event-type-tag">' + t.event_type + ' <span style="color:var(--text-muted);">' + t.count + '</span></div>'
    ).join('');

    const errFixEl = document.getElementById('errorFixes');
    if (eventStats.error_fixes.length > 0) {
      errFixEl.innerHTML = '<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">Error-Fix Patterns:</div>' +
        eventStats.error_fixes.slice(0, 5).map(ef =>
          '<div class="error-fix-item">' +
            '<span class="error-fix-icon">F</span>' +
            '<span>' + escHtml(ef.file) + '</span>' +
            '<span style="color:var(--text-muted);">' + (ef.time_to_fix_ms / 1000).toFixed(1) + 's</span>' +
          '</div>'
        ).join('');
    } else {
      errFixEl.innerHTML = '';
    }

    const evtListEl = document.getElementById('eventsList');
    if (events.length === 0) {
      evtListEl.innerHTML = '<div class="empty-state"><p>No events yet</p></div>';
    } else {
      evtListEl.innerHTML = events.map(ev => {
        const pClass = 'event-p' + Math.min(ev.priority || 4, 4);
        const dataStr = ev.data && typeof ev.data === 'object' ? Object.entries(ev.data).slice(0, 3).map(([k,v]) => k + ': ' + String(v).slice(0, 30)).join(', ') : '';
        return '<div class="event-item">' +
          '<div class="event-priority ' + pClass + '">P' + (ev.priority || 4) + '</div>' +
          '<div class="event-body">' +
            '<span class="event-type">' + ev.event_type + '</span>' +
            (ev.agent ? ' <span style="color:var(--text-muted);font-size:10px;">@' + escHtml(ev.agent) + '</span>' : '') +
            (dataStr ? '<div class="event-data">' + escHtml(dataStr) + '</div>' : '') +
          '</div>' +
          '<span class="event-time">' + timeAgo(ev.timestamp) + '</span>' +
        '</div>';
      }).join('');
    }

    // --- Snapshots ---
    document.getElementById('snapshotCount').textContent = snapshots.length + ' snapshots';
    const snapListEl = document.getElementById('snapshotsList');
    if (snapshots.length === 0) {
      snapListEl.innerHTML = '<div class="empty-state"><p>No snapshots saved yet</p></div>';
    } else {
      snapListEl.innerHTML = snapshots.map(snap => {
        const d = snap.data || {};
        const statsStr = typeof d.stats === 'string' ? d.stats : '';
        const intentStr = typeof d.intent === 'string' ? d.intent : '';
        return '<div class="snapshot-item">' +
          '<div class="snapshot-header">' +
            '<span class="snapshot-session">' + snap.session_id.slice(0, 14) + '...</span>' +
            '<span class="snapshot-time">' + timeAgo(snap.created_at) + '</span>' +
          '</div>' +
          (statsStr ? '<div class="snapshot-stats"><span style="color:var(--green);font-weight:600;">' + escHtml(statsStr) + '</span></div>' : '') +
          (intentStr ? '<div style="margin-top:2px;font-size:9px;color:var(--text-muted);">' + escHtml(intentStr) + '</div>' : '') +
          (d.files && typeof d.files === 'string' && d.files !== '' ?
            '<div style="margin-top:4px;font-size:9px;color:var(--text-muted);max-height:60px;overflow:hidden;">' +
              d.files.split('\\n').slice(0, 3).map(f => '&bull; ' + escHtml(f.replace(/^- /, '').slice(0, 70))).join('<br>') +
            '</div>' : '') +
        '</div>';
      }).join('');
    }

    // Search info bar
    const searchInfo = document.getElementById('searchInfo');
    const searchClear = document.getElementById('searchClear');
    if (isSearching) {
      document.getElementById('searchCount').textContent = timeline.length;
      document.getElementById('searchQuery').textContent = currentSearch;
      searchInfo.classList.add('visible');
      searchClear.classList.add('visible');
    } else {
      searchInfo.classList.remove('visible');
      searchClear.classList.remove('visible');
    }

    // Timeline / Search results
    const timelineEl = document.getElementById('timeline');
    if (timeline.length === 0) {
      const msg = isSearching
        ? 'No results for "' + escHtml(currentSearch) + '"'
        : 'No observations' + (currentFilter ? ' of type "' + currentFilter + '"' : '');
      timelineEl.innerHTML = '<div class="empty-state"><p>' + msg + '</p></div>';
    } else {
      timelineEl.innerHTML = timeline.map(obs => {
        let display = obs.summary || obs.content_preview || '(no content)';
        // Highlight search terms
        if (isSearching) {
          const terms = currentSearch.split(/\\s+/).filter(t => t.length > 0);
          let escaped = escHtml(display);
          for (const term of terms) {
            const re = new RegExp('(' + term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
            escaped = escaped.replace(re, '<span class="highlight">$1</span>');
          }
          display = null; // signal to use pre-escaped
          var displayHtml = escaped;
        }
        return '<div class="obs-item" data-obs-id="' + obs.id + '">' +
          '<div class="obs-type-indicator type-' + obs.type + '"></div>' +
          '<div class="obs-body">' +
            '<div class="obs-header">' +
              '<span class="obs-type-badge badge-' + obs.type + '">' + obs.type + '</span>' +
              (obs.rank !== undefined && obs.rank !== 0 ? '<span style="font-size:10px;color:var(--text-muted);">score: ' + Math.abs(obs.rank).toFixed(2) + '</span>' : '') +
              '<span class="obs-time">' + timeAgo(obs.indexed_at) + '</span>' +
            '</div>' +
            '<div class="obs-summary">' + (display !== null ? escHtml(display) : displayHtml) + '</div>' +
            '<div class="obs-id">' + obs.id + '</div>' +
            '<div class="obs-detail" id="detail-' + obs.id + '"></div>' +
          '</div>' +
        '</div>';
      }).join('');

      // Attach click handlers (event delegation)
      timelineEl.onclick = handleObsClick;

      // Restore open detail panel after re-render
      if (openDetailId) {
        const detailEl = document.getElementById('detail-' + openDetailId);
        if (detailEl && detailCache[openDetailId]) {
          detailEl.innerHTML = detailCache[openDetailId];
          detailEl.classList.add('open');
        }
      }
    }

    document.getElementById('statusText').textContent = 'connected';
    document.getElementById('refreshInfo').textContent = 'updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById('statusText').textContent = 'error: ' + err.message;
  }
}

// --- Detail panel: lazy-load on click ---
const detailCache = {};

async function handleObsClick(e) {
  const item = e.target.closest('.obs-item');
  if (!item) return;

  const id = item.dataset.obsId;
  if (!id) return;

  const detailEl = document.getElementById('detail-' + id);
  if (!detailEl) return;

  // Toggle: if already open, close it
  if (detailEl.classList.contains('open')) {
    detailEl.classList.remove('open');
    openDetailId = null;
    return;
  }

  // Close any other open panels
  document.querySelectorAll('.obs-detail.open').forEach(el => el.classList.remove('open'));

  // Track which panel is open (survives re-render)
  openDetailId = id;

  // Check cache first (no re-fetch)
  if (detailCache[id]) {
    detailEl.innerHTML = detailCache[id];
    detailEl.classList.add('open');
    return;
  }

  // Loading state
  detailEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:8px;">Loading...</div>';
  detailEl.classList.add('open');

  try {
    const obs = await fetchJson('/api/observation?id=' + encodeURIComponent(id));
    if (obs.error) {
      detailEl.innerHTML = '<div style="color:var(--red);font-size:11px;">' + escHtml(obs.error) + '</div>';
      return;
    }

    const meta = obs.metadata || {};
    const savings = meta.tokens_original && meta.tokens_summarized
      ? Math.round((1 - meta.tokens_summarized / meta.tokens_original) * 100)
      : null;

    let html = '<div class="detail-meta">';

    // Metadata chips
    if (meta.source) html += '<div class="detail-chip"><span class="label">source</span><span class="value">' + escHtml(meta.source) + '</span></div>';
    if (meta.file_path) html += '<div class="detail-chip"><span class="label">file</span><span class="value">' + escHtml(meta.file_path) + '</span></div>';
    if (meta.language) html += '<div class="detail-chip"><span class="label">lang</span><span class="value">' + escHtml(meta.language) + '</span></div>';
    html += '<div class="detail-chip"><span class="label">privacy</span><span class="value">' + (obs.privacy_level || 'public') + '</span></div>';
    if (meta.tokens_original) html += '<div class="detail-chip"><span class="label">tokens</span><span class="value">' + meta.tokens_original + '</span></div>';
    if (savings !== null) html += '<div class="detail-chip savings"><span class="label">saved</span><span class="value">' + savings + '%</span></div>';
    html += '<div class="detail-chip"><span class="label">chars</span><span class="value">' + fmt(obs.content_length) + '</span></div>';
    html += '<div class="detail-chip"><span class="label">session</span><span class="value">' + obs.session_id.slice(0, 10) + '...</span></div>';
    html += '</div>';

    // Summary (if different from content)
    if (obs.summary && obs.summary !== obs.content) {
      html += '<div class="detail-label">Summary</div>';
      html += '<div class="detail-summary-text">' + escHtml(obs.summary) + '</div>';
    }

    // Content with action buttons
    html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
    html += '<div class="detail-label" style="margin-top:0;">Content</div>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<button class="copy-btn" data-copy-id="' + obs.id + '" data-copy="content">Copy</button>';
    html += '<button class="copy-btn" data-copy-id="' + obs.id + '" data-copy="id">Copy ID</button>';
    if (obs.content.length > 500) {
      html += '<button class="copy-btn" data-fullscreen="' + obs.id + '">Fullscreen</button>';
    }
    html += '</div></div>';
    const truncated = obs.content.length > 2000;
    html += '<div class="detail-content">' + escHtml(truncated ? obs.content.slice(0, 2000) + '\\n...(' + (obs.content.length - 2000) + ' more chars)' : obs.content) + '</div>';

    // Timestamp
    html += '<div style="margin-top:8px;font-size:10px;color:var(--text-muted);">' + formatDate(obs.indexed_at) + '</div>';

    detailEl.innerHTML = html;
    detailCache[id] = html;

    // Attach copy/fullscreen handlers
    detailEl.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const obsId = btn.dataset.copyId;
        const what = btn.dataset.copy;
        if (what === 'id') {
          navigator.clipboard.writeText(obsId).then(() => {
            btn.textContent = 'Copied!'; btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy ID'; btn.classList.remove('copied'); }, 1500);
          });
        } else {
          fetchJson('/api/observation?id=' + encodeURIComponent(obsId)).then(o => {
            if (o.error) return;
            navigator.clipboard.writeText(o.content).then(() => {
              btn.textContent = 'Copied!'; btn.classList.add('copied');
              setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
            });
          });
        }
      });
    });

    detailEl.querySelectorAll('[data-fullscreen]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullscreen(btn.dataset.fullscreen);
      });
    });
  } catch (err) {
    detailEl.innerHTML = '<div style="color:var(--red);font-size:11px;">Failed to load: ' + escHtml(err.message) + '</div>';
  }
}

// Search input handling
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClear');

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    currentSearch = searchInput.value.trim();
    refresh();
  }
  if (e.key === 'Escape') {
    searchInput.value = '';
    currentSearch = '';
    refresh();
    searchInput.blur();
  }
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  currentSearch = '';
  refresh();
  searchInput.focus();
});

// --- Knowledge search ---
const knowledgeSearchInput = document.getElementById('knowledgeSearchInput');
const knowledgeSearchClear = document.getElementById('knowledgeSearchClear');
let knowledgeSearchQuery = '';
let knowledgeSearchTimer = null;

function renderKnowledgeList(items) {
  const catColors = { pattern: 'cat-pattern', decision: 'cat-decision', error: 'cat-error', api: 'cat-api', component: 'cat-component' };
  const kListEl = document.getElementById('knowledgeList');
  if (items.length === 0) {
    kListEl.innerHTML = '<div class="empty-state"><p>' + (knowledgeSearchQuery ? 'No results for "' + escHtml(knowledgeSearchQuery) + '"' : 'No knowledge entries yet') + '</p></div>';
  } else {
    kListEl.innerHTML = items.map(k => {
      const catClass = catColors[k.category] || '';
      const catBg = k.category === 'pattern' ? 'var(--blue-dim)' : k.category === 'decision' ? 'var(--purple-dim)' : k.category === 'error' ? 'var(--red-dim)' : k.category === 'api' ? 'var(--cyan-dim)' : 'var(--green-dim)';
      let contentText = escHtml(k.content.slice(0, 120));
      if (knowledgeSearchQuery) {
        const terms = knowledgeSearchQuery.split(/\\s+/).filter(t => t.length > 0);
        for (const term of terms) {
          const re = new RegExp('(' + term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
          contentText = contentText.replace(re, '<span class="highlight">$1</span>');
        }
      }
      return '<div class="knowledge-item">' +
        '<div class="knowledge-item-header">' +
          '<span class="knowledge-item-cat ' + catClass + '" style="background:' + catBg + ';">' + k.category + '</span>' +
          '<span class="knowledge-item-title">' + escHtml(k.title) + '</span>' +
        '</div>' +
        '<div class="knowledge-item-content">' + contentText + '</div>' +
        '<div class="knowledge-item-meta">' +
          '<span>score: ' + (k.relevance_score || 0).toFixed(2) + '</span>' +
          '<span>accessed: ' + (k.access_count || 0) + 'x</span>' +
          (k.tags ? '<span>tags: ' + escHtml(k.tags) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }
}

async function doKnowledgeSearch() {
  const q = knowledgeSearchInput.value.trim();
  knowledgeSearchQuery = q;
  knowledgeSearchClear.style.display = q ? 'block' : 'none';
  if (!q) {
    // Restore default knowledge list from last refresh
    const items = await fetchJson('/api/knowledge?limit=20');
    renderKnowledgeList(items);
    return;
  }
  const results = await fetchJson('/api/knowledge/search?q=' + encodeURIComponent(q) + '&limit=50');
  renderKnowledgeList(results);
}

knowledgeSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(knowledgeSearchTimer);
    doKnowledgeSearch();
  }
  if (e.key === 'Escape') {
    knowledgeSearchInput.value = '';
    knowledgeSearchQuery = '';
    knowledgeSearchClear.style.display = 'none';
    doKnowledgeSearch();
    knowledgeSearchInput.blur();
  }
});

knowledgeSearchInput.addEventListener('input', () => {
  clearTimeout(knowledgeSearchTimer);
  knowledgeSearchTimer = setTimeout(doKnowledgeSearch, 300);
});

knowledgeSearchClear.addEventListener('click', () => {
  knowledgeSearchInput.value = '';
  knowledgeSearchQuery = '';
  knowledgeSearchClear.style.display = 'none';
  doKnowledgeSearch();
  knowledgeSearchInput.focus();
});

// --- Toast notifications ---
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<div class="dot"></div>' + escHtml(msg);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- Theme toggle ---
function setTheme(theme) {
  currentTheme = theme;
  document.body.classList.toggle('light', theme === 'light');
  document.getElementById('themeToggle').textContent = theme === 'light' ? 'D' : 'L';
  localStorage.setItem('cm-theme', theme);
}

setTheme(currentTheme);
document.getElementById('themeToggle').addEventListener('click', () => {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// --- Knowledge Graph (pure JS/SVG force-directed layout) ---
const GRAPH_COLORS = {
  person: '#ec4899',
  technology: '#3b82f6',
  concept: '#a855f7',
  file: '#22c55e',
  project: '#f59e0b',
  organization: '#06b6d4',
  default: '#6366f1',
};

let graphNodes = [];
let graphEdges = [];
let graphSim = null;

function getNodeColor(type) {
  return GRAPH_COLORS[type] || GRAPH_COLORS[(type || '').toLowerCase()] || GRAPH_COLORS.default;
}

async function loadGraph() {
  const entity = document.getElementById('graphEntityFilter').value;
  const depth = document.getElementById('graphDepth').value;
  let url = '/api/graph?depth=' + depth;
  if (entity) url += '&entity=' + encodeURIComponent(entity);
  const data = await fetchJson(url);
  graphNodes = data.nodes || [];
  graphEdges = data.edges || [];
  renderGraph();
}

function renderGraph() {
  const canvas = document.getElementById('graphCanvas');
  const empty = document.getElementById('graphEmpty');
  const statsEl = document.getElementById('graphStats');
  const tooltip = document.getElementById('graphTooltip');

  if (graphNodes.length === 0) {
    canvas.innerHTML = '';
    canvas.appendChild(empty);
    empty.style.display = 'flex';
    statsEl.textContent = '';
    return;
  }
  empty.style.display = 'none';

  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 400;

  // Build SVG
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  canvas.innerHTML = '';
  canvas.appendChild(svg);

  // Arrow marker
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '20');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS(ns, 'path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', 'var(--text-muted)');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Create node id map
  const nodeMap = {};
  graphNodes.forEach((n, i) => {
    nodeMap[n.id] = i;
    n.x = w / 2 + (Math.random() - 0.5) * w * 0.6;
    n.y = h / 2 + (Math.random() - 0.5) * h * 0.6;
    n.vx = 0;
    n.vy = 0;
  });

  // Draw edges
  const edgeEls = [];
  for (const e of graphEdges) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('stroke', 'var(--text-muted)');
    line.setAttribute('stroke-width', Math.max(1, Math.min(e.weight || 1, 3)));
    line.setAttribute('stroke-opacity', '0.4');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    svg.appendChild(line);
    edgeEls.push({ el: line, source: nodeMap[e.source], target: nodeMap[e.target], data: e });
  }

  // Draw nodes
  const nodeEls = [];
  for (let i = 0; i < graphNodes.length; i++) {
    const n = graphNodes[i];
    const g = document.createElementNS(ns, 'g');
    g.style.cursor = 'pointer';
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('r', 8);
    circle.setAttribute('fill', getNodeColor(n.type));
    circle.setAttribute('stroke', 'var(--bg)');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    const label = document.createElementNS(ns, 'text');
    label.setAttribute('class', 'graph-node-label');
    label.setAttribute('dy', '22');
    label.textContent = (n.name || '').slice(0, 20);
    g.appendChild(label);

    // Tooltip on hover
    g.addEventListener('mouseenter', function(ev) {
      tooltip.style.display = 'block';
      document.getElementById('ttName').textContent = n.name;
      document.getElementById('ttType').textContent = n.type + (n.knowledge_id ? ' (linked to knowledge)' : '');
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = (ev.clientX - rect.left + 12) + 'px';
      tooltip.style.top = (ev.clientY - rect.top - 10) + 'px';
    });
    g.addEventListener('mouseleave', function() { tooltip.style.display = 'none'; });

    // Click for detail
    g.addEventListener('click', function() {
      if (n.knowledge_id) {
        // Filter graph to this entity
        document.getElementById('graphEntityFilter').value = n.name;
        loadGraph();
      }
    });

    svg.appendChild(g);
    nodeEls.push({ el: g, data: n });
  }

  // Simple force simulation (inline, no D3)
  let running = true;
  let iterations = 0;
  const maxIter = 200;

  function tick() {
    if (!running || iterations >= maxIter) return;
    iterations++;

    // Repulsion between all nodes
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const dx = graphNodes[j].x - graphNodes[i].x;
        const dy = graphNodes[j].y - graphNodes[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 800 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        graphNodes[i].vx -= fx;
        graphNodes[i].vy -= fy;
        graphNodes[j].vx += fx;
        graphNodes[j].vy += fy;
      }
    }

    // Attraction along edges
    for (const e of edgeEls) {
      if (e.source == null || e.target == null) continue;
      const s = graphNodes[e.source];
      const t = graphNodes[e.target];
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 100) * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Center gravity
    for (const n of graphNodes) {
      n.vx += (w / 2 - n.x) * 0.002;
      n.vy += (h / 2 - n.y) * 0.002;
    }

    // Apply velocities with damping
    const damping = 0.85;
    for (const n of graphNodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(20, Math.min(w - 20, n.x));
      n.y = Math.max(20, Math.min(h - 20, n.y));
    }

    // Update DOM
    for (const e of edgeEls) {
      if (e.source == null || e.target == null) continue;
      const s = graphNodes[e.source];
      const t = graphNodes[e.target];
      e.el.setAttribute('x1', s.x);
      e.el.setAttribute('y1', s.y);
      e.el.setAttribute('x2', t.x);
      e.el.setAttribute('y2', t.y);
    }
    for (let i = 0; i < nodeEls.length; i++) {
      nodeEls[i].el.setAttribute('transform', 'translate(' + graphNodes[i].x + ',' + graphNodes[i].y + ')');
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  // Enable drag
  let dragNode = null;
  svg.addEventListener('mousedown', function(ev) {
    const target = ev.target.closest('g');
    if (!target) return;
    const idx = nodeEls.findIndex(n => n.el === target);
    if (idx >= 0) { dragNode = idx; running = false; }
  });
  svg.addEventListener('mousemove', function(ev) {
    if (dragNode == null) return;
    const rect = svg.getBoundingClientRect();
    graphNodes[dragNode].x = ev.clientX - rect.left;
    graphNodes[dragNode].y = ev.clientY - rect.top;
    // Update positions
    for (const e of edgeEls) {
      if (e.source == null || e.target == null) continue;
      const s = graphNodes[e.source];
      const t = graphNodes[e.target];
      e.el.setAttribute('x1', s.x);
      e.el.setAttribute('y1', s.y);
      e.el.setAttribute('x2', t.x);
      e.el.setAttribute('y2', t.y);
    }
    for (let i = 0; i < nodeEls.length; i++) {
      nodeEls[i].el.setAttribute('transform', 'translate(' + graphNodes[i].x + ',' + graphNodes[i].y + ')');
    }
  });
  svg.addEventListener('mouseup', function() {
    if (dragNode != null) {
      dragNode = null;
      running = true;
      iterations = Math.max(iterations, maxIter - 50);
      requestAnimationFrame(tick);
    }
  });

  statsEl.innerHTML = '<span>Nodes: ' + graphNodes.length + '</span><span>Edges: ' + graphEdges.length + '</span>';
}

// Load graph on startup
loadGraph();

// --- Agents Panel ---
async function refreshAgents() {
  try {
    const agents = await fetchJson('/api/agents');
    const container = document.getElementById('agentsContainer');
    if (!agents || agents.length === 0) {
      container.innerHTML = '<div class="agents-empty">No agents registered</div>';
      return;
    }
    container.innerHTML = '<div class="agents-grid">' + agents.map(function(a) {
      const now = Date.now();
      const hb = a.last_heartbeat || a.lastHeartbeat || 0;
      const stale = hb > 0 && (now - hb) > 30000;
      const statusClass = stale ? 'idle' : (hb > 0 ? 'active' : 'offline');
      const statusLabel = stale ? 'stale' : (hb > 0 ? 'active' : 'unknown');
      const files = a.claimed_files || a.claimedFiles || [];
      const filesHtml = files.length > 0
        ? '<div class="agent-files">' + files.map(function(f) { return '<span class="agent-file-tag">' + escHtml(f) + '</span>'; }).join('') + '</div>'
        : '';
      return '<div class="agent-card">' +
        '<div class="agent-name"><span class="agent-status-dot ' + statusClass + '"></span>' + escHtml(a.name || a.id || 'Agent') + '</div>' +
        '<div class="agent-detail"><strong>Task:</strong> ' + escHtml(a.task || a.current_task || 'idle') + '</div>' +
        (hb > 0 ? '<div class="agent-detail"><strong>Heartbeat:</strong> ' + timeAgo(hb) + ' (' + statusLabel + ')</div>' : '') +
        filesHtml +
        '</div>';
    }).join('') + '</div>';
  } catch { /* agents api optional */ }
}

// Poll agents every 5 seconds
refreshAgents();
setInterval(refreshAgents, 5000);

// --- Fullscreen content viewer ---
const fullscreenOverlay = document.getElementById('fullscreenOverlay');

function openFullscreen(id) {
  const obs = detailCache[id] ? null : null; // We need raw data
  fetchJson('/api/observation?id=' + encodeURIComponent(id)).then(obs => {
    if (obs.error) return;
    fullscreenData = obs;
    document.getElementById('fullscreenBadge').className = 'obs-type-badge badge-' + obs.type;
    document.getElementById('fullscreenBadge').textContent = obs.type;
    document.getElementById('fullscreenId').textContent = obs.id;
    document.getElementById('fullscreenBody').textContent = obs.content;
    fullscreenOverlay.classList.add('open');
  });
}

document.getElementById('fullscreenCopy').addEventListener('click', function() {
  if (!fullscreenData) return;
  navigator.clipboard.writeText(fullscreenData.content).then(() => {
    this.textContent = 'Copied!';
    this.classList.add('copied');
    setTimeout(() => { this.textContent = 'Copy content'; this.classList.remove('copied'); }, 1500);
  });
});

// --- Copy helper for detail panels ---
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  });
}

// Keyboard shortcuts
const shortcutsOverlay = document.getElementById('shortcutsOverlay');

document.addEventListener('keydown', (e) => {
  const inSearch = document.activeElement === searchInput;

  if (e.key === '/' && !inSearch) {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === '?' && !inSearch) {
    e.preventDefault();
    shortcutsOverlay.classList.toggle('open');
  }
  if (e.key === 'Escape') {
    if (fullscreenOverlay.classList.contains('open')) {
      fullscreenOverlay.classList.remove('open');
    } else if (shortcutsOverlay.classList.contains('open')) {
      shortcutsOverlay.classList.remove('open');
    }
  }
  if (e.key === 'r' && !inSearch) {
    e.preventDefault();
    refresh();
  }
  if (e.key === 'c' && !inSearch) {
    e.preventDefault();
    currentFilter = null;
    currentSession = null;
    currentSearch = '';
    searchInput.value = '';
    refresh();
  }
  if (e.key === 't' && !inSearch) {
    e.preventDefault();
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }
});

shortcutsOverlay.addEventListener('click', (e) => {
  if (e.target === shortcutsOverlay) shortcutsOverlay.classList.remove('open');
});

fullscreenOverlay.addEventListener('click', (e) => {
  if (e.target === fullscreenOverlay) fullscreenOverlay.classList.remove('open');
});

// --- Vector search banner ---
async function checkVectorStatus() {
  try {
    const data = await fetchJson('/api/vector-status');
    const banner = document.getElementById('vectorBanner');
    const icon = document.getElementById('vectorIcon');
    const text = document.getElementById('vectorText');
    const btn = document.getElementById('vectorBtn');
    const progress = document.getElementById('vectorProgress');

    // Reset
    banner.className = 'vector-banner ' + data.status;
    btn.style.display = 'none';
    btn.disabled = false;
    progress.style.display = 'none';

    if (data.status === 'active') {
      // Level 3: fully active
      const pct = data.totalCount > 0 ? Math.round((data.embeddedCount / data.totalCount) * 100) : 0;
      icon.textContent = '\\u2713';
      text.innerHTML = '<div><strong>Semantic search active</strong> — ' + data.embeddedCount + ' of ' + data.totalCount + ' observations embedded (' + pct + '%)</div>' +
        '<div class="vector-banner-sub">Search finds meaning, not just keywords — e.g. "auth problem" matches "login token expired"</div>';
      banner.style.display = 'flex';
    } else if (data.status === 'ready') {
      // Vector enabled + HF installed but no embeddings yet (first use)
      icon.textContent = '\\u2026';
      text.innerHTML = '<div><strong>Semantic search ready</strong> — waiting for first observation to download model (~22MB, one-time)</div>' +
        '<div class="vector-banner-sub">New observations will be embedded automatically</div>';
      banner.style.display = 'flex';
    } else if (data.status === 'missing-pkg') {
      // Level 2: config has vector but package missing
      icon.textContent = '!';
      text.innerHTML = '<div><strong>Vector search configured but package missing</strong></div>' +
        '<div class="vector-banner-sub">Run: <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:3px;">npm install @huggingface/transformers</code> — then restart the server</div>';
      btn.textContent = 'Copy Command';
      btn.style.display = 'inline-block';
      btn.onclick = function() {
        navigator.clipboard.writeText('npm install @huggingface/transformers').then(function() {
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy Command'; }, 2000);
        });
      };
      banner.style.display = 'flex';
    } else if (data.status === 'available') {
      // Level 1: not configured at all (upsell)
      icon.textContent = 'V';
      text.innerHTML = '<div><strong>Unlock semantic search</strong> — find "auth problem" when stored as "login token expired"</div>' +
        '<div class="vector-banner-sub">Local embeddings via all-MiniLM-L6-v2 — no cloud, no cost, ~22MB one-time download</div>';
      btn.textContent = 'Enable Vector Search';
      btn.style.display = 'inline-block';
      btn.onclick = enableVectorSearch;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  } catch {}
}

async function enableVectorSearch() {
  const btn = document.getElementById('vectorBtn');
  const progress = document.getElementById('vectorProgress');
  const text = document.getElementById('vectorText');

  btn.disabled = true;
  btn.style.display = 'none';
  progress.style.display = 'flex';

  try {
    // Step 1: Add "vector" to config
    const res = await fetch(API + '/api/enable-vector', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      showToast('Failed to update config: ' + (data.error || 'Unknown'));
      btn.style.display = 'inline-block';
      btn.disabled = false;
      progress.style.display = 'none';
      return;
    }

    // Step 2: Show next steps
    progress.style.display = 'none';
    const icon = document.getElementById('vectorIcon');
    const banner = document.getElementById('vectorBanner');
    banner.className = 'vector-banner missing-pkg';
    icon.textContent = '\\u2192';
    text.innerHTML = '<div><strong>Config updated!</strong> "vector" added to search plugins.</div>' +
      '<div class="vector-banner-sub">Next: run <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:3px;">npm install @huggingface/transformers</code> in your project, then restart the server.</div>';
    btn.textContent = 'Copy Command';
    btn.style.display = 'inline-block';
    btn.disabled = false;
    btn.className = 'vector-banner-btn';
    btn.onclick = function() {
      navigator.clipboard.writeText('npm install @huggingface/transformers').then(function() {
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy Command'; }, 2000);
      });
    };

    showToast('Vector search enabled in config');
  } catch (err) {
    progress.style.display = 'none';
    btn.style.display = 'inline-block';
    btn.disabled = false;
    showToast('Failed: ' + err.message);
  }
}

// Check vector status once on load and on project switch
checkVectorStatus();

// --- Init banner ---
let initChecked = false;
async function checkInitStatus() {
  try {
    const res = await fetch(API + '/api/init-status');
    const data = await res.json();
    const banner = document.getElementById('initBanner');
    if (data.initialized) {
      banner.style.display = 'none';
      return;
    }
    // Show banner
    const editorsEl = document.getElementById('initEditors');
    if (data.detectedEditors && data.detectedEditors.length > 0) {
      editorsEl.textContent = 'Detected: ' + data.detectedEditors.join(', ') + ' — init will configure MCP + rules for ' + (data.detectedEditors.length === 1 ? 'it' : 'all of them');
    }
    banner.style.display = 'flex';
  } catch {}
}

async function runInit() {
  const btn = document.getElementById('initBtn');
  const progress = document.getElementById('initProgress');
  const banner = document.getElementById('initBanner');

  btn.disabled = true;
  btn.style.display = 'none';
  progress.style.display = 'flex';

  try {
    const res = await fetch(API + '/api/run-init', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      banner.classList.add('success');
      banner.querySelector('.init-banner-icon').textContent = '\\u2713';
      banner.querySelector('.init-banner-text').innerHTML = '<div><strong>Setup complete!</strong> Editor configs and rules have been configured.</div>' +
        (data.output ? '<div class="init-editors" style="white-space:pre-line;">' + escHtml(data.output) + '</div>' : '');
      progress.style.display = 'none';
      showToast('Init completed successfully');
      setTimeout(() => { banner.style.display = 'none'; }, 5000);
    } else {
      progress.style.display = 'none';
      btn.style.display = 'inline-block';
      btn.disabled = false;
      showToast('Init failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    progress.style.display = 'none';
    btn.style.display = 'inline-block';
    btn.disabled = false;
    showToast('Init failed: ' + err.message);
  }
}

// Check init status once on load
checkInitStatus();

// Auto-refresh: 3s default, 10s when WebSocket is connected
let pollInterval = 3000;
let pollTimer = null;

function startPolling(interval) {
  if (pollTimer) clearInterval(pollTimer);
  pollInterval = interval;
  pollTimer = setInterval(() => {
    if (document.activeElement !== searchInput) refresh();
  }, pollInterval);
}

refresh();
startPolling(3000);

// --- WebSocket real-time connection ---
(function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = proto + '//127.0.0.1:' + location.port + '/ws';
  let reconnectDelay = 1000;
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    try { ws = new WebSocket(wsUrl); } catch { return; }

    ws.onopen = function() {
      reconnectDelay = 1000; // reset backoff
      // Reduce HTTP polling when WS is active
      startPolling(10000);
      document.getElementById('statusText').textContent = 'live';
    };

    ws.onmessage = function(evt) {
      try {
        const event = JSON.parse(evt.data);
        if (event.type === 'observation:new' && event.data) {
          // Prepend to timeline without full refresh
          const tlEl = document.getElementById('timeline');
          if (tlEl) {
            const obs = event.data;
            const time = new Date(obs.indexed_at || Date.now()).toLocaleTimeString();
            const summary = escHtml(obs.summary || (obs.content || '').substring(0, 120));
            const html = '<div class="obs-row" onclick="toggleDetail(\\'' + escHtml(obs.id || '') + '\\')" style="opacity:0;transition:opacity 0.3s;">' +
              '<div class="obs-header">' +
                '<span class="obs-type-badge badge-' + escHtml(obs.type || 'unknown') + '">' + escHtml(obs.type || '?') + '</span>' +
                '<span class="obs-time">' + time + '</span>' +
              '</div>' +
              '<div class="obs-summary">' + summary + '</div>' +
            '</div>';
            tlEl.insertAdjacentHTML('afterbegin', html);
            // Fade in
            const first = tlEl.firstElementChild;
            if (first) requestAnimationFrame(() => { first.style.opacity = '1'; });
          }
        }
        if (event.type === 'stats:update' && event.data) {
          const stats = event.data;
          const el = (id) => document.getElementById(id);
          if (el('statObs')) el('statObs').textContent = fmt(stats.observations);
          if (el('statSaved')) el('statSaved').textContent = fmt(stats.tokens_saved);
          if (el('statPct')) el('statPct').textContent = stats.savings_pct + '%';
          if (el('statSearches')) el('statSearches').textContent = fmt(stats.searches);
          if (el('refreshInfo')) el('refreshInfo').textContent = 'ws ' + new Date().toLocaleTimeString();
        }
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = function() {
      ws = null;
      // Restore fast HTTP polling
      startPolling(3000);
      document.getElementById('statusText').textContent = 'connected';
      scheduleReconnect();
    };

    ws.onerror = function() {
      // onclose will fire after onerror
      try { ws.close(); } catch {}
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connect();
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }, reconnectDelay);
  }

  connect();
})();
</script>
</body>
</html>`;
}

// --- Graph Page HTML ---
function getGraphPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Knowledge Graph</title>
<style>
  :root {
    --bg: #0a0a0f;
    --bg-card: #12121a;
    --bg-card-hover: #1a1a25;
    --border: #1e1e2e;
    --text: #e2e2e8;
    --text-dim: #6b6b80;
    --text-muted: #44445a;
    --accent: #6366f1;
    --accent-dim: #4f46e5;
    --green: #22c55e;
    --green-dim: rgba(34, 197, 94, 0.15);
    --orange: #f59e0b;
    --orange-dim: rgba(245, 158, 11, 0.15);
    --red: #ef4444;
    --red-dim: rgba(239, 68, 68, 0.15);
    --blue: #3b82f6;
    --blue-dim: rgba(59, 130, 246, 0.15);
    --purple: #a855f7;
    --purple-dim: rgba(168, 85, 247, 0.15);
    --cyan: #06b6d4;
    --cyan-dim: rgba(6, 182, 212, 0.15);
    --pink: #ec4899;
    --pink-dim: rgba(236, 72, 153, 0.15);
    --radius: 10px;
    --font: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    flex-shrink: 0;
    z-index: 100;
    backdrop-filter: blur(12px);
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 28px; height: 28px; background: var(--accent); border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; color: white;
  }
  .header h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.3px; }
  .header h1 span { color: var(--text-dim); font-weight: 400; }
  .nav-links { display: flex; align-items: center; gap: 4px; margin-left: 20px; }
  .nav-link {
    font-size: 12px; color: var(--text-dim); text-decoration: none;
    padding: 5px 12px; border-radius: 6px; transition: all 0.15s ease; font-family: var(--font);
  }
  .nav-link:hover { color: var(--text); background: var(--bg); }
  .nav-link.active { color: var(--accent); background: rgba(99,102,241,0.1); }

  .graph-toolbar {
    display: flex; align-items: center; gap: 10px; padding: 12px 24px;
    background: var(--bg-card); border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .graph-toolbar input, .graph-toolbar select {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 12px; font-size: 12px; color: var(--text); font-family: var(--font);
  }
  .graph-toolbar input { width: 240px; }
  .graph-toolbar button {
    background: var(--accent); border: none; border-radius: 6px;
    padding: 6px 16px; color: #fff; font-size: 12px; cursor: pointer;
    font-family: var(--font); transition: background 0.15s;
  }
  .graph-toolbar button:hover { background: var(--accent-dim); }
  .graph-toolbar .stats {
    margin-left: auto; font-size: 11px; color: var(--text-dim);
    display: flex; gap: 16px;
  }

  .theme-toggle {
    background: none; border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-dim); font-size: 13px; width: 32px; height: 32px;
    cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

  body.light {
    --bg: #f5f5f8; --bg-card: #ffffff; --bg-card-hover: #f0f0f5;
    --border: #e0e0e8; --text: #1a1a2e; --text-dim: #5a5a70; --text-muted: #8888a0;
  }

  .graph-container {
    flex: 1; position: relative; overflow: hidden; background: var(--bg);
  }

  #graphCanvas {
    width: 100%; height: 100%; display: block; cursor: grab;
  }
  #graphCanvas.dragging { cursor: grabbing; }

  .graph-legend {
    position: absolute; bottom: 16px; left: 16px; background: var(--bg-card);
    border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px;
    font-size: 11px; display: flex; flex-direction: column; gap: 6px;
    opacity: 0.9;
  }
  .legend-item { display: flex; align-items: center; gap: 8px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  .node-detail {
    position: absolute; top: 16px; right: 16px; width: 320px;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 20px; font-size: 12px; display: none; z-index: 50;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); max-height: calc(100vh - 140px); overflow-y: auto;
  }
  .node-detail.open { display: block; }
  .node-detail-close {
    position: absolute; top: 10px; right: 14px; background: none; border: none;
    color: var(--text-dim); font-size: 16px; cursor: pointer; font-family: var(--font);
  }
  .node-detail-name { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .node-detail-type {
    display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px;
    margin-bottom: 12px;
  }
  .node-detail-section { margin-top: 12px; }
  .node-detail-section-title { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .node-detail-rel {
    font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 6px;
  }
  .node-detail-rel:last-child { border-bottom: none; }
  .rel-type-badge {
    font-size: 9px; padding: 1px 6px; border-radius: 8px;
    background: var(--border); color: var(--text-dim);
  }

  .graph-empty-state {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    text-align: center; color: var(--text-muted); font-size: 14px;
  }
  .graph-empty-state p { margin-top: 8px; font-size: 12px; }

  /* --- Project Bar --- */
  .project-bar { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 8px 24px; flex-shrink: 0; }
  .project-bar-inner { display: flex; align-items: center; gap: 12px; max-width: 1400px; margin: 0 auto; }
  .project-bar-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); flex-shrink: 0; }
  .project-pills { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; overflow-x: auto; }
  .project-pill { display: flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); transition: all 0.15s ease; white-space: nowrap; user-select: none; }
  .project-pill:hover { border-color: var(--cyan); color: var(--text); background: var(--bg-card); }
  .project-pill.active { background: var(--cyan-dim, rgba(0,212,255,0.1)); border-color: var(--cyan); color: var(--cyan); font-weight: 600; }
  .project-pill .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green, #4ade80); flex-shrink: 0; }
  .project-pill.skeleton { opacity: 0.4; cursor: default; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <h1>ContextMem</h1>
    <nav class="nav-links">
      <a href="/" class="nav-link">Home</a>
      <a href="/graph" class="nav-link active">Graph</a>
      <a href="/timeline" class="nav-link">Timeline</a>
    </nav>
  </div>
  <button class="theme-toggle" id="themeToggle" title="Toggle light/dark theme">L</button>
</div>

<div class="project-bar" id="projectBar">
  <div class="project-bar-inner">
    <div class="project-bar-label" id="projectLabel">Project</div>
    <div class="project-pills" id="projectPills"></div>
  </div>
</div>

<div class="graph-toolbar">
  <input type="text" id="entityFilter" placeholder="Filter by entity name..." />
  <select id="depthSelect">
    <option value="1">Depth 1</option>
    <option value="2" selected>Depth 2</option>
    <option value="3">Depth 3</option>
    <option value="4">Depth 4</option>
    <option value="5">Depth 5</option>
  </select>
  <select id="typeFilter">
    <option value="">All types</option>
    <option value="file">File</option>
    <option value="module">Module</option>
    <option value="pattern">Pattern</option>
    <option value="decision">Decision</option>
    <option value="bug">Bug</option>
    <option value="api">API</option>
    <option value="person">Person</option>
    <option value="concept">Concept</option>
  </select>
  <button onclick="loadGraph()">Load</button>
  <button onclick="resetZoom()" style="background:var(--border);color:var(--text);">Reset View</button>
  <div class="stats" id="graphStats"></div>
</div>

<div class="graph-container" id="graphContainer">
  <canvas id="graphCanvas"></canvas>
  <div class="graph-empty-state" id="emptyState">
    <div style="font-size:32px;margin-bottom:12px;">*</div>
    <div>Knowledge Graph</div>
    <p>Click "Load" to visualize entity relationships</p>
  </div>

  <div class="graph-legend" id="graphLegend">
    <div class="legend-item"><div class="legend-dot" style="background:#22c55e"></div> file</div>
    <div class="legend-item"><div class="legend-dot" style="background:#3b82f6"></div> module</div>
    <div class="legend-item"><div class="legend-dot" style="background:#a855f7"></div> pattern / concept</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> decision</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> bug</div>
    <div class="legend-item"><div class="legend-dot" style="background:#06b6d4"></div> api</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ec4899"></div> person</div>
  </div>

  <div class="node-detail" id="nodeDetail">
    <button class="node-detail-close" onclick="closeDetail()">&times;</button>
    <div class="node-detail-name" id="detailName"></div>
    <div class="node-detail-type" id="detailType"></div>
    <div class="node-detail-section" id="detailMeta"></div>
    <div class="node-detail-section" id="detailRels"></div>
  </div>
</div>

<script>
(function() {
  'use strict';

  const TYPE_COLORS = {
    file: '#22c55e', module: '#3b82f6', pattern: '#a855f7', concept: '#a855f7',
    decision: '#f59e0b', bug: '#ef4444', api: '#06b6d4', person: '#ec4899',
    project: '#f59e0b', organization: '#06b6d4', technology: '#3b82f6',
  };
  const DEFAULT_COLOR = '#6366f1';

  function getColor(type) { return TYPE_COLORS[type] || TYPE_COLORS[(type||'').toLowerCase()] || DEFAULT_COLOR; }

  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('graphContainer');

  let nodes = [], edges = [], nodeMap = {};
  let simRunning = false, simIterations = 0;
  let panX = 0, panY = 0, zoom = 1;
  let dragNode = null, isPanning = false, lastMouse = {x:0,y:0};
  let hoveredNode = null, selectedNode = null;
  let animFrame = null;

  function resize() {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);

  function screenToWorld(sx, sy) {
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  }

  function worldToScreen(wx, wy) {
    return { x: wx * zoom + panX, y: wy * zoom + panY };
  }

  function findNodeAt(sx, sy) {
    const w = screenToWorld(sx, sy);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - w.x, dy = n.y - w.y;
      const r = (n._radius || 8) + 4;
      if (dx*dx + dy*dy < r*r) return n;
    }
    return null;
  }

  // --- Force simulation ---
  function initSim() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);

    nodes.forEach(n => {
      n.x = w / 2 + (Math.random() - 0.5) * w * 0.5;
      n.y = h / 2 + (Math.random() - 0.5) * h * 0.5;
      n.vx = 0; n.vy = 0;
      // Scale node size by connection count
      const connCount = edges.filter(e => e.source === n.id || e.target === n.id).length;
      n._radius = Math.max(6, Math.min(20, 6 + connCount * 2));
    });

    panX = 0; panY = 0; zoom = 1;
    simIterations = 0;
    simRunning = true;
    if (animFrame) cancelAnimationFrame(animFrame);
    tickSim();
  }

  function tickSim() {
    if (!simRunning || simIterations >= 300) { simRunning = false; draw(); return; }
    simIterations++;

    const cw = canvas.width / (window.devicePixelRatio || 1);
    const ch = canvas.height / (window.devicePixelRatio || 1);

    // Repulsion (Barnes-Hut-like, but simple O(n^2) for small graphs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 1);
        const force = 1200 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }

    // Edge attraction
    for (const e of edges) {
      const s = nodeMap[e.source], t = nodeMap[e.target];
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 1);
      const force = (dist - 120) * 0.008;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (cw / 2 - n.x) * 0.001;
      n.vy += (ch / 2 - n.y) * 0.001;
    }

    // Apply velocities + damping
    const damping = 0.88;
    for (const n of nodes) {
      if (n === dragNode) continue;
      n.vx *= damping; n.vy *= damping;
      n.x += n.vx; n.y += n.vy;
    }

    draw();
    animFrame = requestAnimationFrame(tickSim);
  }

  // --- Drawing ---
  function draw() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw edges
    for (const e of edges) {
      const s = nodeMap[e.source], t = nodeMap[e.target];
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = 'rgba(100,100,130,0.3)';
      ctx.lineWidth = Math.max(0.5, Math.min((e.weight || 1) * 0.8, 3));
      ctx.stroke();

      // Edge label (relationship type)
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(100,100,130,0.5)';
      ctx.textAlign = 'center';
      ctx.fillText(e.type || '', mx, my - 4);

      // Arrowhead
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const tr = (t._radius || 8) + 4;
      const ax = t.x - Math.cos(angle) * tr;
      const ay = t.y - Math.sin(angle) * tr;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 8 * Math.cos(angle - 0.4), ay - 8 * Math.sin(angle - 0.4));
      ctx.lineTo(ax - 8 * Math.cos(angle + 0.4), ay - 8 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = 'rgba(100,100,130,0.4)';
      ctx.fill();
    }

    // Draw nodes
    for (const n of nodes) {
      const r = n._radius || 8;
      const color = getColor(n.type);

      // Glow for hovered/selected
      if (n === hoveredNode || n === selectedNode) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(')', ',0.2)').replace('rgb', 'rgba');
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = n === selectedNode ? '#fff' : 'rgba(10,10,15,0.8)';
      ctx.lineWidth = n === selectedNode ? 2.5 : 1.5;
      ctx.stroke();

      // Label
      ctx.font = '10px monospace';
      ctx.fillStyle = '#e2e2e8';
      ctx.textAlign = 'center';
      const label = (n.name || '').length > 24 ? (n.name || '').slice(0, 22) + '..' : (n.name || '');
      ctx.fillText(label, n.x, n.y + r + 14);
    }

    ctx.restore();

    // Tooltip for hovered node
    if (hoveredNode && hoveredNode !== selectedNode) {
      const sp = worldToScreen(hoveredNode.x, hoveredNode.y);
      ctx.fillStyle = 'rgba(18,18,26,0.95)';
      const tipW = 200, tipH = 44;
      const tx = Math.min(sp.x + 16, w - tipW - 8);
      const ty = Math.max(sp.y - 10, 8);
      ctx.beginPath();
      ctx.roundRect(tx, ty, tipW, tipH, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,30,46,1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#e2e2e8';
      ctx.textAlign = 'left';
      ctx.fillText(hoveredNode.name || '', tx + 10, ty + 16);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#6b6b80';
      ctx.fillText(hoveredNode.type + (hoveredNode.knowledge_id ? ' (linked)' : ''), tx + 10, ty + 32);
    }
  }

  // --- Interaction ---
  canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    if (node) {
      dragNode = node;
      simRunning = false;
      canvas.classList.add('dragging');
    } else {
      isPanning = true;
      canvas.classList.add('dragging');
    }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (dragNode) {
      const w = screenToWorld(sx, sy);
      dragNode.x = w.x; dragNode.y = w.y;
      draw();
    } else if (isPanning) {
      panX += e.clientX - lastMouse.x;
      panY += e.clientY - lastMouse.y;
      draw();
    } else {
      const prev = hoveredNode;
      hoveredNode = findNodeAt(sx, sy);
      if (hoveredNode !== prev) {
        canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
        draw();
      }
    }
    lastMouse = {x: e.clientX, y: e.clientY};
  });

  canvas.addEventListener('mouseup', function() {
    if (dragNode) {
      // Clicking a node (not dragging far) selects it
      const node = dragNode;
      dragNode = null;
      showDetail(node);
    }
    isPanning = false;
    canvas.classList.remove('dragging');
    // Resume simulation briefly
    if (nodes.length > 0 && simIterations < 300) {
      simIterations = Math.max(simIterations, 250);
      simRunning = true;
      tickSim();
    }
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const oldZoom = zoom;
    zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.max(0.1, Math.min(5, zoom));
    // Zoom toward cursor
    panX = sx - (sx - panX) * (zoom / oldZoom);
    panY = sy - (sy - panY) * (zoom / oldZoom);
    draw();
  }, { passive: false });

  // --- Detail panel ---
  function showDetail(node) {
    selectedNode = node;
    const panel = document.getElementById('nodeDetail');
    const nameEl = document.getElementById('detailName');
    const typeEl = document.getElementById('detailType');
    const metaEl = document.getElementById('detailMeta');
    const relsEl = document.getElementById('detailRels');

    nameEl.textContent = node.name;
    typeEl.textContent = node.type;
    typeEl.style.background = getColor(node.type).replace(')', ',0.15)').replace('#', 'rgba(').replace('rgba(', function() {
      // Convert hex to rgba
      const c = getColor(node.type);
      const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
      return 'rgba(' + r + ',' + g + ',' + b + ',0.15)';
    }());
    // Fix: just use a simpler approach
    const c = getColor(node.type);
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    typeEl.style.background = 'rgba(' + r + ',' + g + ',' + b + ',0.15)';
    typeEl.style.color = c;

    // Metadata
    let metaHtml = '<div class="node-detail-section-title">Metadata</div>';
    if (node.knowledge_id) metaHtml += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Knowledge ID: ' + node.knowledge_id + '</div>';
    if (node.created_at) metaHtml += '<div style="font-size:11px;color:var(--text-dim);">Created: ' + new Date(node.created_at).toLocaleString() + '</div>';
    if (node.metadata && Object.keys(node.metadata).length > 0) {
      metaHtml += '<pre style="font-size:10px;color:var(--text-dim);margin-top:6px;white-space:pre-wrap;word-break:break-all;">' + JSON.stringify(node.metadata, null, 2) + '</pre>';
    }
    metaEl.innerHTML = metaHtml;

    // Relationships
    const rels = edges.filter(e => e.source === node.id || e.target === node.id);
    let relsHtml = '<div class="node-detail-section-title">Relationships (' + rels.length + ')</div>';
    if (rels.length === 0) {
      relsHtml += '<div style="font-size:11px;color:var(--text-muted);">No relationships</div>';
    } else {
      for (const rel of rels) {
        const isSource = rel.source === node.id;
        const otherId = isSource ? rel.target : rel.source;
        const other = nodeMap[otherId];
        const otherName = other ? other.name : otherId.slice(0, 12) + '...';
        const arrow = isSource ? ' -> ' : ' <- ';
        relsHtml += '<div class="node-detail-rel">' +
          '<span class="rel-type-badge">' + (rel.type || 'related') + '</span>' +
          '<span style="color:var(--text-dim);">' + arrow + '</span>' +
          '<span style="cursor:pointer;color:var(--accent);" onclick="selectNodeById(\\'' + otherId + '\\')">' + otherName + '</span>' +
        '</div>';
      }
    }
    relsEl.innerHTML = relsHtml;
    panel.classList.add('open');
    draw();
  }

  window.closeDetail = function() {
    selectedNode = null;
    document.getElementById('nodeDetail').classList.remove('open');
    draw();
  };

  window.selectNodeById = function(id) {
    const n = nodeMap[id];
    if (n) showDetail(n);
  };

  window.resetZoom = function() {
    panX = 0; panY = 0; zoom = 1;
    draw();
  };

  // --- Load data ---
  let activeProjectDb = localStorage.getItem('cm-active-project') || null;

  window.loadGraph = async function() {
    const entity = document.getElementById('entityFilter').value;
    const depth = document.getElementById('depthSelect').value;
    const typeF = document.getElementById('typeFilter').value;

    let url = '/api/graph?depth=' + depth;
    if (entity) url += '&entity=' + encodeURIComponent(entity);
    if (activeProjectDb && activeProjectDb !== '__all__') url += '&db=' + encodeURIComponent(activeProjectDb);

    try {
      const data = await fetch(url).then(r => r.json());
      nodes = data.nodes || [];
      edges = data.edges || [];

      // Type filter (client-side)
      if (typeF) {
        const keep = new Set(nodes.filter(n => n.type === typeF).map(n => n.id));
        // Also keep connected nodes
        edges.forEach(e => { if (keep.has(e.source)) keep.add(e.target); if (keep.has(e.target)) keep.add(e.source); });
        nodes = nodes.filter(n => keep.has(n.id));
        edges = edges.filter(e => keep.has(e.source) && keep.has(e.target));
      }

      nodeMap = {};
      nodes.forEach(n => { nodeMap[n.id] = n; });

      document.getElementById('emptyState').style.display = nodes.length === 0 ? '' : 'none';
      document.getElementById('graphLegend').style.display = nodes.length === 0 ? 'none' : '';
      document.getElementById('graphStats').innerHTML = nodes.length > 0
        ? '<span>Nodes: ' + nodes.length + '</span><span>Edges: ' + edges.length + '</span><span>Types: ' + [...new Set(nodes.map(n=>n.type))].join(', ') + '</span>'
        : '';

      if (nodes.length > 0) {
        selectedNode = null;
        document.getElementById('nodeDetail').classList.remove('open');
        initSim();
      }
    } catch (err) {
      console.error('Graph load failed:', err);
    }
  };

  // --- Project switcher ---
  function escHtml(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  function updateProjectBar(instances) {
    var label = document.getElementById('projectLabel');
    if (!label) return;
    if (!instances || instances.length <= 1) {
      var name = instances && instances[0] ? instances[0].projectName : '${path.basename(PROJECT_DIR).replace(/[<>&"]/g, '')}';
      label.textContent = 'Project  ' + name;
    } else {
      label.textContent = 'Projects';
    }
  }

  async function loadProjects() {
    try {
      const res = await fetch('/api/instances');
      const instances = await res.json();
      const container = document.getElementById('projectPills');

      if (!instances.length) {
        activeProjectDb = null;
        container.innerHTML = '';
        updateProjectBar(instances);
        return;
      }

      if (activeProjectDb) {
        var validSelection = instances.some(function(i) { return i.dbPath === activeProjectDb; });
        if (!validSelection) activeProjectDb = instances[0].dbPath;
      } else {
        activeProjectDb = instances[0].dbPath;
      }

      if (instances.length === 1) {
        container.innerHTML = '';
      } else {
        container.innerHTML = instances.map(function(i) {
          const isActive = i.dbPath === activeProjectDb;
          return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + escHtml(i.dbPath) + '" title="' + escHtml(i.projectDir) + '">' +
            '<span class="pill-dot"></span>' + escHtml(i.projectName) + '</div>';
        }).join('');
      }

      updateProjectBar(instances);

      container.querySelectorAll('.project-pill').forEach(function(pill) {
        pill.addEventListener('click', async function() {
          const db = pill.getAttribute('data-db');
          if (db === activeProjectDb) return;
          try { await fetch('/api/switch-project?db=' + encodeURIComponent(db)); } catch {}
          activeProjectDb = db;
          localStorage.setItem('cm-active-project', activeProjectDb);
          container.querySelectorAll('.project-pill').forEach(function(p) { p.classList.remove('active'); });
          pill.classList.add('active');
          updateProjectBar(instances);
          loadGraph();
        });
      });
    } catch {}
  }

  // --- Theme ---
  const savedTheme = localStorage.getItem('cm-theme') || 'dark';
  document.body.classList.toggle('light', savedTheme === 'light');
  document.getElementById('themeToggle').textContent = savedTheme === 'light' ? 'D' : 'L';
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    document.body.classList.toggle('light', next === 'light');
    document.getElementById('themeToggle').textContent = next === 'light' ? 'D' : 'L';
    localStorage.setItem('cm-theme', next);
  });

  // --- Init ---
  resize();
  loadProjects();
  loadGraph();
})();
</script>
</body>
</html>`;
}

// --- Timeline Page HTML ---
function getTimelinePageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>context-mem - Timeline</title>
<style>
  :root {
    --bg: #0a0a0f;
    --bg-card: #12121a;
    --bg-card-hover: #1a1a25;
    --border: #1e1e2e;
    --text: #e2e2e8;
    --text-dim: #6b6b80;
    --text-muted: #44445a;
    --accent: #6366f1;
    --accent-dim: #4f46e5;
    --green: #22c55e;
    --green-dim: rgba(34, 197, 94, 0.15);
    --orange: #f59e0b;
    --orange-dim: rgba(245, 158, 11, 0.15);
    --red: #ef4444;
    --red-dim: rgba(239, 68, 68, 0.15);
    --blue: #3b82f6;
    --blue-dim: rgba(59, 130, 246, 0.15);
    --purple: #a855f7;
    --purple-dim: rgba(168, 85, 247, 0.15);
    --cyan: #06b6d4;
    --cyan-dim: rgba(6, 182, 212, 0.15);
    --pink: #ec4899;
    --pink-dim: rgba(236, 72, 153, 0.15);
    --radius: 10px;
    --font: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
    position: sticky; top: 0; z-index: 100;
    backdrop-filter: blur(12px);
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 28px; height: 28px; background: var(--accent); border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; color: white;
  }
  .header h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.3px; }
  .header h1 span { color: var(--text-dim); font-weight: 400; }
  .nav-links { display: flex; align-items: center; gap: 4px; margin-left: 20px; }
  .nav-link {
    font-size: 12px; color: var(--text-dim); text-decoration: none;
    padding: 5px 12px; border-radius: 6px; transition: all 0.15s ease; font-family: var(--font);
  }
  .nav-link:hover { color: var(--text); background: var(--bg); }
  .nav-link.active { color: var(--accent); background: rgba(99,102,241,0.1); }

  .theme-toggle {
    background: none; border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-dim); font-size: 13px; width: 32px; height: 32px;
    cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

  body.light {
    --bg: #f5f5f8; --bg-card: #ffffff; --bg-card-hover: #f0f0f5;
    --border: #e0e0e8; --text: #1a1a2e; --text-dim: #5a5a70; --text-muted: #8888a0;
  }

  .header-right {
    display: flex; align-items: center; gap: 10px;
  }
  .status-badge {
    display: flex; align-items: center; gap: 6px; font-size: 11px;
    color: var(--green); background: rgba(34,197,94,0.15);
    padding: 4px 10px; border-radius: 20px;
  }
  .status-dot { width: 6px; height: 6px; background: var(--green); border-radius: 50%; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .toolbar {
    display: flex; align-items: center; gap: 10px; padding: 12px 24px;
    background: var(--bg-card); border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .toolbar input, .toolbar select {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 12px; font-size: 12px; color: var(--text); font-family: var(--font);
  }
  .toolbar input[type="text"] { width: 240px; }
  .toolbar input[type="date"] { width: 150px; }
  .toolbar button {
    background: var(--accent); border: none; border-radius: 6px;
    padding: 6px 16px; color: #fff; font-size: 12px; cursor: pointer;
    font-family: var(--font); transition: background 0.15s;
  }
  .toolbar button:hover { background: var(--accent-dim); }
  .toolbar button.secondary { background: var(--border); color: var(--text); }
  .toolbar .spacer { flex: 1; }
  .toolbar .result-count { font-size: 11px; color: var(--text-dim); }
  .toolbar .auto-refresh-indicator {
    font-size: 10px; color: var(--green); display: flex; align-items: center; gap: 4px;
  }

  .type-filter-row {
    display: flex; gap: 6px; padding: 10px 24px; flex-wrap: wrap;
    border-bottom: 1px solid var(--border); background: var(--bg-card);
  }
  .type-pill {
    font-size: 11px; padding: 4px 12px; border-radius: 16px;
    border: 1px solid var(--border); cursor: pointer; transition: all 0.15s;
    user-select: none;
  }
  .type-pill:hover { border-color: var(--accent); }
  .type-pill.active { background: rgba(99,102,241,0.15); border-color: var(--accent); color: var(--accent); }

  .main { max-width: 1200px; margin: 0 auto; padding: 24px; }

  .timeline-line {
    position: relative;
    padding-left: 28px;
  }
  .timeline-line::before {
    content: '';
    position: absolute; left: 8px; top: 0; bottom: 0;
    width: 2px; background: var(--border);
  }

  .tl-group-header {
    font-size: 12px; font-weight: 600; color: var(--text-dim);
    padding: 16px 0 8px; position: relative;
  }
  .tl-group-header::before {
    content: '';
    position: absolute; left: -24px; top: 20px; width: 10px; height: 10px;
    background: var(--accent); border-radius: 50%; border: 2px solid var(--bg);
  }

  .tl-entry {
    position: relative; background: var(--bg-card);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px 18px; margin-bottom: 8px;
    transition: all 0.15s ease; cursor: pointer;
  }
  .tl-entry:hover { background: var(--bg-card-hover); border-color: var(--accent); }
  .tl-entry::before {
    content: '';
    position: absolute; left: -24px; top: 18px; width: 8px; height: 8px;
    background: var(--border); border-radius: 50%;
  }

  .tl-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;
  }
  .tl-badge {
    font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600;
  }
  .tl-badge.code_change { background: var(--blue-dim); color: var(--blue); }
  .tl-badge.error { background: var(--red-dim); color: var(--red); }
  .tl-badge.decision { background: var(--purple-dim); color: var(--purple); }
  .tl-badge.pattern { background: var(--cyan-dim); color: var(--cyan); }
  .tl-badge.dependency { background: var(--orange-dim); color: var(--orange); }
  .tl-badge.config { background: var(--green-dim); color: var(--green); }
  .tl-badge.debug { background: var(--red-dim); color: var(--orange); }
  .tl-badge.architecture { background: var(--purple-dim); color: var(--pink); }
  .tl-badge.default { background: var(--border); color: var(--text-dim); }

  .tl-time { font-size: 10px; color: var(--text-muted); margin-left: auto; white-space: nowrap; }
  .tl-summary { font-size: 12px; color: var(--text); line-height: 1.5; }
  .tl-meta { font-size: 10px; color: var(--text-muted); margin-top: 6px; display: flex; gap: 12px; flex-wrap: wrap; }

  .tl-detail {
    display: none; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--border); font-size: 11px;
  }
  .tl-detail.open { display: block; }
  .tl-detail-content {
    background: var(--bg); border-radius: 6px; padding: 10px 14px;
    font-size: 11px; color: var(--text-dim); white-space: pre-wrap; word-break: break-all;
    max-height: 300px; overflow-y: auto; margin-top: 8px;
  }
  .tl-detail-chips {
    display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
  }
  .tl-detail-chip {
    font-size: 10px; padding: 2px 8px; border-radius: 8px;
    background: var(--border); color: var(--text-dim);
  }

  .empty-state {
    text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 13px;
  }

  .load-more {
    text-align: center; padding: 16px;
  }
  .load-more button {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 24px; color: var(--text-dim); font-size: 12px; cursor: pointer;
    font-family: var(--font); transition: all 0.15s;
  }
  .load-more button:hover { border-color: var(--accent); color: var(--text); }

  /* --- Project Bar --- */
  .project-bar { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 8px 24px; }
  .project-bar-inner { display: flex; align-items: center; gap: 12px; max-width: 1400px; margin: 0 auto; }
  .project-bar-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); flex-shrink: 0; }
  .project-pills { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; overflow-x: auto; }
  .project-pill { display: flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); transition: all 0.15s ease; white-space: nowrap; user-select: none; }
  .project-pill:hover { border-color: var(--cyan); color: var(--text); background: var(--bg-card); }
  .project-pill.active { background: var(--cyan-dim, rgba(0,212,255,0.1)); border-color: var(--cyan); color: var(--cyan); font-weight: 600; }
  .project-pill .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green, #4ade80); flex-shrink: 0; }
  .project-pill.skeleton { opacity: 0.4; cursor: default; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <h1>ContextMem</h1>
    <nav class="nav-links">
      <a href="/" class="nav-link">Home</a>
      <a href="/graph" class="nav-link">Graph</a>
      <a href="/timeline" class="nav-link active">Timeline</a>
    </nav>
  </div>
  <div class="header-right">
    <div class="status-badge" id="statusBadge">
      <div class="status-dot"></div>
      <span id="statusText">auto-refresh</span>
    </div>
    <button class="theme-toggle" id="themeToggle" title="Toggle light/dark theme">L</button>
  </div>
</div>

<div class="project-bar" id="projectBar">
  <div class="project-bar-inner">
    <div class="project-bar-label" id="projectLabel">Project</div>
    <div class="project-pills" id="projectPills"></div>
  </div>
</div>

<div class="toolbar">
  <input type="text" id="searchInput" placeholder="Search observations..." />
  <input type="date" id="dateFrom" title="From date" />
  <input type="date" id="dateTo" title="To date" />
  <select id="limitSelect">
    <option value="50">50 entries</option>
    <option value="100" selected>100 entries</option>
    <option value="250">250 entries</option>
    <option value="500">500 entries</option>
  </select>
  <button onclick="applyFilters()">Apply</button>
  <button class="secondary" onclick="clearFilters()">Clear</button>
  <div class="spacer"></div>
  <div class="result-count" id="resultCount"></div>
  <div class="auto-refresh-indicator">
    <div class="status-dot" style="width:4px;height:4px;"></div>
    <span id="refreshTimer">5s</span>
  </div>
</div>

<div class="type-filter-row" id="typeFilters"></div>

<div class="main">
  <div class="timeline-line" id="timeline">
    <div class="empty-state">Loading timeline...</div>
  </div>
  <div class="load-more" id="loadMore" style="display:none;">
    <button onclick="loadMoreEntries()">Load more</button>
  </div>
</div>

<script>
(function() {
  'use strict';

  let entries = [];
  let currentType = '';
  let currentLimit = 100;
  let lastRefresh = 0;
  let refreshInterval = null;
  let activeProjectDb = localStorage.getItem('cm-active-project') || null;

  const BADGE_CLASSES = {
    code_change: 'code_change', error: 'error', decision: 'decision',
    pattern: 'pattern', dependency: 'dependency', config: 'config',
    debug: 'debug', architecture: 'architecture'
  };

  function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDayGroup(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function badgeClass(type) { return BADGE_CLASSES[type] || 'default'; }

  // --- Fetch timeline data ---
  async function fetchTimeline() {
    const search = document.getElementById('searchInput').value.trim();
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const limit = document.getElementById('limitSelect').value;
    currentLimit = parseInt(limit, 10);

    let url;
    if (search) {
      url = '/api/search?q=' + encodeURIComponent(search) + '&limit=' + limit;
      if (currentType) url += '&type=' + encodeURIComponent(currentType);
    } else if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom).getTime() : 0;
      const to = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Date.now();
      url = '/api/timeline-range?from=' + from + '&to=' + to + '&limit=' + limit;
      if (currentType) url += '&type=' + encodeURIComponent(currentType);
    } else {
      url = '/api/timeline?limit=' + limit;
      if (currentType) url += '&type=' + encodeURIComponent(currentType);
    }

    if (activeProjectDb && activeProjectDb !== '__all__') url += '&db=' + encodeURIComponent(activeProjectDb);

    try {
      const res = await fetch(url);
      entries = await res.json();
      renderTimeline();
      lastRefresh = Date.now();
      document.getElementById('statusText').textContent = 'updated ' + new Date().toLocaleTimeString();
    } catch (err) {
      document.getElementById('statusText').textContent = 'error';
      console.error(err);
    }
  }

  // --- Render timeline ---
  function renderTimeline() {
    const container = document.getElementById('timeline');
    const countEl = document.getElementById('resultCount');
    countEl.textContent = entries.length + ' observation' + (entries.length !== 1 ? 's' : '');

    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state">No observations found</div>';
      document.getElementById('loadMore').style.display = 'none';
      return;
    }

    // Group by day
    let html = '';
    let lastDay = '';
    for (const entry of entries) {
      const day = formatDayGroup(entry.indexed_at);
      if (day !== lastDay) {
        html += '<div class="tl-group-header">' + esc(day) + '</div>';
        lastDay = day;
      }

      const display = entry.summary || entry.content_preview || '(no content)';
      let meta = {};
      try { meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : (entry.metadata || {}); } catch {}

      html += '<div class="tl-entry" data-id="' + entry.id + '">' +
        '<div class="tl-header">' +
          '<span class="tl-badge ' + badgeClass(entry.type) + '">' + esc(entry.type) + '</span>' +
          (entry.privacy_level && entry.privacy_level !== 'public'
            ? '<span class="tl-badge default">' + esc(entry.privacy_level) + '</span>' : '') +
          '<span class="tl-time">' + formatDate(entry.indexed_at) + ' (' + timeAgo(entry.indexed_at) + ')</span>' +
        '</div>' +
        '<div class="tl-summary">' + esc(display) + '</div>' +
        '<div class="tl-meta">' +
          '<span>id: ' + entry.id.slice(0, 12) + '...</span>' +
          '<span>session: ' + (entry.session_id || '').slice(0, 10) + '...</span>' +
          (meta.file_path ? '<span>file: ' + esc(meta.file_path) + '</span>' : '') +
        '</div>' +
        '<div class="tl-detail" id="detail-' + entry.id + '"></div>' +
      '</div>';
    }

    container.innerHTML = html;
    document.getElementById('loadMore').style.display = entries.length >= currentLimit ? '' : 'none';

    // Click handlers
    container.querySelectorAll('.tl-entry').forEach(el => {
      el.addEventListener('click', function() { toggleDetail(this.dataset.id); });
    });
  }

  // --- Detail toggle ---
  async function toggleDetail(id) {
    const detailEl = document.getElementById('detail-' + id);
    if (!detailEl) return;

    if (detailEl.classList.contains('open')) {
      detailEl.classList.remove('open');
      return;
    }

    // Close others
    document.querySelectorAll('.tl-detail.open').forEach(el => el.classList.remove('open'));

    if (detailEl.dataset.loaded) {
      detailEl.classList.add('open');
      return;
    }

    detailEl.innerHTML = '<div style="color:var(--text-muted);padding:4px;">Loading...</div>';
    detailEl.classList.add('open');

    try {
      const res = await fetch('/api/observation?id=' + encodeURIComponent(id));
      const obs = await res.json();
      if (obs.error) { detailEl.innerHTML = '<div style="color:var(--red);">' + esc(obs.error) + '</div>'; return; }

      const meta = obs.metadata || {};
      let html = '<div class="tl-detail-chips">';
      if (meta.source) html += '<div class="tl-detail-chip">source: ' + esc(meta.source) + '</div>';
      if (meta.language) html += '<div class="tl-detail-chip">lang: ' + esc(meta.language) + '</div>';
      if (meta.tokens_original) html += '<div class="tl-detail-chip">tokens: ' + meta.tokens_original + '</div>';
      if (meta.tokens_original && meta.tokens_summarized) {
        const saved = Math.round((1 - meta.tokens_summarized / meta.tokens_original) * 100);
        html += '<div class="tl-detail-chip" style="color:var(--green);">saved: ' + saved + '%</div>';
      }
      html += '<div class="tl-detail-chip">chars: ' + (obs.content_length || 0) + '</div>';
      html += '</div>';

      if (obs.summary && obs.summary !== obs.content) {
        html += '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px;">Summary</div>';
        html += '<div style="font-size:11px;color:var(--text);margin-bottom:10px;">' + esc(obs.summary) + '</div>';
      }

      html += '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px;">Content</div>';
      const content = obs.content || '';
      const truncated = content.length > 2000;
      html += '<div class="tl-detail-content">' + esc(truncated ? content.slice(0, 2000) + '\\n...(' + (content.length - 2000) + ' more chars)' : content) + '</div>';

      detailEl.innerHTML = html;
      detailEl.dataset.loaded = '1';
    } catch (err) {
      detailEl.innerHTML = '<div style="color:var(--red);">Failed: ' + esc(err.message) + '</div>';
    }
  }

  // --- Type filter pills ---
  async function loadTypeFilters() {
    try {
      var statsUrl = '/api/stats';
      if (activeProjectDb && activeProjectDb !== '__all__') statsUrl += '?db=' + encodeURIComponent(activeProjectDb);
      const stats = await fetch(statsUrl).then(r => r.json());
      const types = stats.by_type || [];
      const container = document.getElementById('typeFilters');
      let html = '<div class="type-pill' + (!currentType ? ' active' : '') + '" data-type="">All (' + (stats.observations || 0) + ')</div>';
      for (const t of types) {
        html += '<div class="type-pill' + (currentType === t.type ? ' active' : '') + '" data-type="' + esc(t.type) + '">' + esc(t.type) + ' (' + t.count + ')</div>';
      }
      container.innerHTML = html;

      container.querySelectorAll('.type-pill').forEach(pill => {
        pill.addEventListener('click', function() {
          currentType = this.dataset.type;
          container.querySelectorAll('.type-pill').forEach(p => p.classList.remove('active'));
          this.classList.add('active');
          fetchTimeline();
        });
      });
    } catch {}
  }

  // --- Actions ---
  window.applyFilters = function() { fetchTimeline(); };
  window.clearFilters = function() {
    document.getElementById('searchInput').value = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    currentType = '';
    loadTypeFilters();
    fetchTimeline();
  };
  window.loadMoreEntries = function() {
    const sel = document.getElementById('limitSelect');
    const curr = parseInt(sel.value, 10);
    const next = Math.min(curr + 100, 500);
    sel.value = String(next);
    fetchTimeline();
  };

  // --- Search on Enter ---
  document.getElementById('searchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); fetchTimeline(); }
    if (e.key === 'Escape') { this.value = ''; fetchTimeline(); this.blur(); }
  });

  // --- Auto-refresh via SSE ---
  function connectSSE() {
    try {
      const es = new EventSource('/sse');
      es.addEventListener('stats:update', function() {
        // Refresh timeline data silently
        fetchTimeline();
      });
      es.onerror = function() {
        es.close();
        // Fallback to polling
        if (!refreshInterval) {
          refreshInterval = setInterval(fetchTimeline, 5000);
        }
      };
    } catch {
      // SSE not available, use polling
      refreshInterval = setInterval(fetchTimeline, 5000);
    }
  }

  // --- Theme ---
  const savedTheme = localStorage.getItem('cm-theme') || 'dark';
  document.body.classList.toggle('light', savedTheme === 'light');
  document.getElementById('themeToggle').textContent = savedTheme === 'light' ? 'D' : 'L';
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    document.body.classList.toggle('light', next === 'light');
    document.getElementById('themeToggle').textContent = next === 'light' ? 'D' : 'L';
    localStorage.setItem('cm-theme', next);
  });

  // --- Project switcher ---
  function updateProjectBar(instances) {
    var label = document.getElementById('projectLabel');
    if (!label) return;
    if (!instances || instances.length <= 1) {
      var name = instances && instances[0] ? instances[0].projectName : '${path.basename(PROJECT_DIR).replace(/[<>&"]/g, '')}';
      label.textContent = 'Project  ' + name;
    } else {
      label.textContent = 'Projects';
    }
  }

  async function loadProjects() {
    try {
      const res = await fetch('/api/instances');
      const instances = await res.json();
      const container = document.getElementById('projectPills');

      if (!instances.length) {
        activeProjectDb = null;
        container.innerHTML = '';
        updateProjectBar(instances);
        return;
      }

      if (activeProjectDb) {
        var validSelection = instances.some(function(i) { return i.dbPath === activeProjectDb; });
        if (!validSelection) activeProjectDb = instances[0].dbPath;
      } else {
        activeProjectDb = instances[0].dbPath;
      }

      if (instances.length === 1) {
        container.innerHTML = '';
      } else {
        container.innerHTML = instances.map(function(i) {
          const isActive = i.dbPath === activeProjectDb;
          return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + esc(i.dbPath) + '" title="' + esc(i.projectDir) + '">' +
            '<span class="pill-dot"></span>' + esc(i.projectName) + '</div>';
        }).join('');
      }

      updateProjectBar(instances);

      container.querySelectorAll('.project-pill').forEach(function(pill) {
        pill.addEventListener('click', async function() {
          const db = pill.getAttribute('data-db');
          if (db === activeProjectDb) return;
          try { await fetch('/api/switch-project?db=' + encodeURIComponent(db)); } catch {}
          activeProjectDb = db;
          localStorage.setItem('cm-active-project', activeProjectDb);
          container.querySelectorAll('.project-pill').forEach(function(p) { p.classList.remove('active'); });
          pill.classList.add('active');
          updateProjectBar(instances);
          fetchTimeline();
          loadTypeFilters();
        });
      });
    } catch {}
  }

  // --- Init ---
  loadProjects();
  loadTypeFilters();
  fetchTimeline();
  connectSSE();

  // Countdown display
  setInterval(function() {
    const s = Math.max(0, 5 - Math.floor((Date.now() - lastRefresh) / 1000));
    document.getElementById('refreshTimer').textContent = s + 's';
  }, 1000);
})();
</script>
</body>
</html>`;
}

// --- SSE for real-time push (lightweight alternative to WebSocket) ---
// Uses ObservationStream-compatible protocol: { type: string, data: unknown }
// Event types: 'observation:new', 'stats:update'
const sseClients = new Set();

function sseHandleRequest(req, res) {
  if (req.method !== 'GET' || req.url !== '/sse') return false;

  if (sseClients.size >= 50) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Too many clients');
    return true;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  sseClients.add(res);

  // Send initial stats
  try {
    const payload = `event: stats:update\ndata: ${JSON.stringify(getStats())}\n\n`;
    res.write(payload);
  } catch {}

  req.on('close', () => {
    sseClients.delete(res);
  });

  return true;
}

function sseBroadcast(event) {
  if (sseClients.size === 0) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

// SSE heartbeat — comment line every 30s to keep connections alive
const sseHeartbeatInterval = setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      sseClients.delete(res);
      try { res.end(); } catch {}
    }
  }
}, 30000);
sseHeartbeatInterval.unref();

// SSE stats push every 3s (same cadence as WebSocket)
const sseStatsPushInterval = setInterval(() => {
  if (sseClients.size === 0) return;
  sseBroadcast({ type: 'stats:update', data: getStats() });
}, 3000);
sseStatsPushInterval.unref();

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    return handleApi(req, res);
  }
  // SSE endpoint
  if (sseHandleRequest(req, res)) return;

  // Page routing
  const pagePath = req.url.split('?')[0];
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (pagePath === '/graph') {
    res.end(getGraphPageHtml());
  } else if (pagePath === '/timeline') {
    res.end(getTimelinePageHtml());
  } else {
    res.end(getDashboardHtml());
  }
});

// --- WebSocket for real-time push (optional, requires 'ws' package) ---
// Uses ObservationStream-compatible protocol: { type: string, data: unknown }
// Event types: 'observation:new', 'stats:update'
let wsClients = new Set();
let wsHeartbeatInterval = null;

if (WebSocketServer) {
  try {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
      wsClients.add(ws);
      // Send initial stats on connect
      try { ws.send(JSON.stringify({ type: 'stats:update', data: getStats() })); } catch {}

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => { wsClients.delete(ws); });
      ws.on('error', () => {
        wsClients.delete(ws);
        try { ws.close(); } catch {}
      });
    });

    // Heartbeat ping/pong every 30s (RFC 6455)
    wsHeartbeatInterval = setInterval(() => {
      for (const ws of wsClients) {
        if (!ws.isAlive) {
          wsClients.delete(ws);
          try { ws.terminate(); } catch {}
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      }
    }, 30000);
    wsHeartbeatInterval.unref();

    // Broadcast stats every 3s to connected WS clients
    const statsPushInterval = setInterval(() => {
      if (wsClients.size === 0) return;
      try {
        const data = JSON.stringify({ type: 'stats:update', data: getStats() });
        for (const ws of wsClients) {
          if (ws.readyState === 1) ws.send(data);
        }
      } catch {}
    }, 3000);
    statsPushInterval.unref();
  } catch {}
}

// --- Start ---
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.error(`context-mem dashboard: ${url}`);
  console.error(`context-mem dashboard: Database ${dbPath}`);

  // Auto-open in browser (unless --no-open)
  if (!NO_OPEN) {
    try {
      const { spawn: spawnProc } = require('child_process');
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawnProc(opener, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
    } catch {}
  }
});

// Graceful shutdown
function shutdown() {
  if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
  for (const ws of wsClients) { try { ws.close(1000, 'server stopping'); } catch {} }
  wsClients.clear();
  clearInterval(sseHeartbeatInterval);
  clearInterval(sseStatsPushInterval);
  for (const res of sseClients) { try { res.end(); } catch {} }
  sseClients.clear();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
