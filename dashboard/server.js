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
      // Check if process is still alive and DB exists
      let alive = false;
      try { process.kill(info.pid, 0); alive = true; } catch {}
      if (alive && fs.existsSync(info.dbPath)) {
        instances.push(info);
      } else {
        try { fs.unlinkSync(path.join(INSTANCES_DIR, file)); } catch {}
      }
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
  const dbSize = fs.statSync(dbPath).size;

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
  const dbSize = fs.statSync(dbPath).size;

  // WAL file size
  let walSize = 0;
  try { walSize = fs.statSync(dbPath + '-wal').size; } catch {}

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
    db_path: dbPath,
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
          parseInt(url.searchParams.get('limit') || '50', 10),
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
        data = getTopFiles(parseInt(url.searchParams.get('limit') || '10', 10));
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
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(exportObservations(
          parseInt(url.searchParams.get('limit') || '1000', 10)
        ), null, 2));
        return;
      case '/api/search':
        data = searchObservations(
          url.searchParams.get('q') || '',
          parseInt(url.searchParams.get('limit') || '20', 10),
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
          parseInt(url.searchParams.get('limit') || '20', 10),
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
          parseInt(url.searchParams.get('limit') || '50', 10),
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
      case '/api/instances':
        data = getRegisteredInstances().map(i => ({
          ...i,
          active: i.dbPath === db.name,
        }));
        break;
      case '/api/stats-all': {
        const allInstances = getRegisteredInstances();
        const allStats = [];
        let totalObs = 0, totalRaw = 0, totalCompressed = 0;
        for (const inst of allInstances) {
          try {
            const tmpDb = new Database(inst.dbPath, { readonly: true });
            const obsCount = tmpDb.prepare('SELECT COUNT(*) as v FROM observations').get();
            const tokens = tmpDb.prepare('SELECT COALESCE(SUM(raw_tokens),0) as raw, COALESCE(SUM(compressed_tokens),0) as comp FROM observations').get();
            tmpDb.close();
            const obs = obsCount?.v || 0;
            const raw = tokens?.raw || 0;
            const comp = tokens?.comp || 0;
            totalObs += obs;
            totalRaw += raw;
            totalCompressed += comp;
            allStats.push({ project: inst.projectName, projectDir: inst.projectDir, observations: obs, rawTokens: raw, compressedTokens: comp, savings: raw > 0 ? Math.round((1 - comp / raw) * 100) : 0 });
          } catch {}
        }
        data = {
          projects: allStats,
          total: {
            projectCount: allInstances.length,
            observations: totalObs,
            rawTokens: totalRaw,
            compressedTokens: totalCompressed,
            savings: totalRaw > 0 ? Math.round((1 - totalCompressed / totalRaw) * 100) : 0,
          },
        };
        break;
      }
      case '/api/switch-project': {
        const targetDb = url.searchParams.get('db');
        if (targetDb && switchProject(targetDb)) {
          currentProject = getRegisteredInstances().find(i => i.dbPath === targetDb)?.projectDir || '';
          data = { ok: true, db: targetDb, project: currentProject };
        } else {
          data = { ok: false, error: 'Failed to switch' };
        }
        break;
      }
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
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
    padding: 16px 24px;
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
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo">cm</div>
    <h1>context-mem <span>dashboard</span></h1>
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
    <div class="project-bar-label">Projects</div>
    <div class="project-pills" id="projectPills">
      <div class="project-pill skeleton">Loading...</div>
    </div>
    <div class="project-count" id="projectCount"></div>
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
      <div id="knowledgeCategories" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;"></div>
      <div id="knowledgeList" style="max-height:250px;overflow-y:auto;"></div>
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
  context-mem v0.1.0 &mdash; context optimization for AI coding assistants
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
let activeProjectDb = '__all__';

async function loadProjects() {
  try {
    const instances = await fetchJson('/api/instances');
    const container = document.getElementById('projectPills');
    const countEl = document.getElementById('projectCount');
    const bar = document.getElementById('projectBar');

    if (!instances.length) {
      bar.style.display = 'none';
      return;
    }

    // Show bar only if >1 project
    bar.style.display = instances.length > 1 ? '' : 'none';

    const allPill = '<div class="project-pill' + (activeProjectDb === '__all__' ? ' active' : '') + '" data-db="__all__" title="Aggregated view across all projects">' +
      '<span class="pill-dot" style="background:var(--cyan)"></span>All Projects</div>';

    container.innerHTML = allPill + instances.map(i => {
      const isActive = !!(activeProjectDb && activeProjectDb !== '__all__' && i.dbPath === activeProjectDb);
      return '<div class="project-pill' + (isActive ? ' active' : '') + '" data-db="' + escHtml(i.dbPath) + '" title="' + escHtml(i.projectDir) + '">' +
        '<span class="pill-dot"></span>' +
        escHtml(i.projectName) +
      '</div>';
    }).join('');

    countEl.textContent = instances.length + ' project' + (instances.length > 1 ? 's' : '') + ' active';

    // Click handlers
    container.querySelectorAll('.project-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const db = pill.getAttribute('data-db');
        if (db === activeProjectDb) return;

        if (db === '__all__') {
          activeProjectDb = '__all__';
          container.querySelectorAll('.project-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          refresh();
          return;
        }

        try {
          await fetchJson('/api/switch-project?db=' + encodeURIComponent(db));
          activeProjectDb = db;
          container.querySelectorAll('.project-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          refresh();
        } catch {}
      });
    });
  } catch {}
}

loadProjects();
setInterval(loadProjects, 10000);

async function refresh() {
  try {
    // --- All Projects aggregated view ---
    if (activeProjectDb === '__all__') {
      const allData = await fetchJson('/api/stats-all');
      const t = allData.total;
      document.getElementById('statObs').textContent = fmt(t.observations);
      document.getElementById('statObsSub').textContent = t.projectCount + ' project' + (t.projectCount !== 1 ? 's' : '');
      document.getElementById('statSaved').textContent = fmt(t.rawTokens - t.compressedTokens);
      document.getElementById('statSavedSub').textContent = fmt(t.rawTokens) + ' original tokens';
      document.getElementById('statPct').textContent = t.savings + '%';

      // Show per-project breakdown in timeline
      const tlEl = document.getElementById('timeline');
      if (allData.projects.length) {
        tlEl.innerHTML = '<div style="padding:12px 0;">' + allData.projects.map(p =>
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;margin:4px 0;background:var(--bg-card);border-radius:8px;border:1px solid var(--border);">' +
            '<div><span style="font-weight:600;color:var(--text);">' + escHtml(p.project) + '</span>' +
            '<span style="color:var(--text-muted);font-size:12px;margin-left:8px;">' + escHtml(p.projectDir) + '</span></div>' +
            '<div style="display:flex;gap:16px;align-items:center;">' +
              '<span style="color:var(--text-muted);font-size:13px;">' + fmt(p.observations) + ' obs</span>' +
              '<span style="color:var(--cyan);font-weight:600;font-size:14px;">' + p.savings + '% saved</span>' +
            '</div>' +
          '</div>'
        ).join('') + '</div>';
      }

      document.getElementById('refreshInfo').textContent = 'updated ' + new Date().toLocaleTimeString();
      return;
    }

    // --- Single project view ---
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
    document.getElementById('statSearchSub').textContent = stats.reads + ' full reads';
    document.getElementById('statDb').textContent = stats.db_size_kb < 1024
      ? stats.db_size_kb + ' KB'
      : (stats.db_size_kb / 1024).toFixed(1) + ' MB';
    document.getElementById('statDbSub').textContent = stats.store_events + ' store events';

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

    const kListEl = document.getElementById('knowledgeList');
    if (knowledge.length === 0) {
      kListEl.innerHTML = '<div class="empty-state"><p>No knowledge entries yet</p></div>';
    } else {
      kListEl.innerHTML = knowledge.map(k => {
        const catClass = catColors[k.category] || '';
        const catBg = k.category === 'pattern' ? 'var(--blue-dim)' : k.category === 'decision' ? 'var(--purple-dim)' : k.category === 'error' ? 'var(--red-dim)' : k.category === 'api' ? 'var(--cyan-dim)' : 'var(--green-dim)';
        return '<div class="knowledge-item">' +
          '<div class="knowledge-item-header">' +
            '<span class="knowledge-item-cat ' + catClass + '" style="background:' + catBg + ';">' + k.category + '</span>' +
            '<span class="knowledge-item-title">' + escHtml(k.title) + '</span>' +
          '</div>' +
          '<div class="knowledge-item-content">' + escHtml(k.content.slice(0, 120)) + '</div>' +
          '<div class="knowledge-item-meta">' +
            '<span>score: ' + (k.relevance_score || 0).toFixed(2) + '</span>' +
            '<span>accessed: ' + (k.access_count || 0) + 'x</span>' +
            (k.tags ? '<span>tags: ' + escHtml(k.tags) + '</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');
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
        const s = d.stats || {};
        return '<div class="snapshot-item">' +
          '<div class="snapshot-header">' +
            '<span class="snapshot-session">' + snap.session_id.slice(0, 14) + '...</span>' +
            '<span class="snapshot-time">' + timeAgo(snap.created_at) + '</span>' +
          '</div>' +
          '<div class="snapshot-stats">' +
            (s.observations !== undefined ? '<span>obs: <span class="snapshot-stat-val">' + s.observations + '</span></span>' : '') +
            (s.savings_pct !== undefined ? '<span>saved: <span class="snapshot-stat-val">' + s.savings_pct + '%</span></span>' : '') +
            (s.tokens_saved !== undefined ? '<span>tokens: <span class="snapshot-stat-val">' + fmt(s.tokens_saved) + '</span></span>' : '') +
          '</div>' +
          (d.decisions && d.decisions.length > 0 ?
            '<div style="margin-top:4px;font-size:9px;color:var(--text-muted);">' +
              d.decisions.slice(0, 2).map(dec => '&bull; ' + escHtml(String(dec).slice(0, 60))).join('<br>') +
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

// Auto-refresh every 3 seconds (pause during active search typing)
refresh();
setInterval(() => {
  if (document.activeElement !== searchInput) refresh();
}, 3000);
</script>
</body>
</html>`;
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    return handleApi(req, res);
  }
  // Serve dashboard HTML
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getDashboardHtml());
});

// --- WebSocket for real-time push (optional, requires 'ws' package) ---
if (WebSocketServer) {
  try {
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
      try { ws.send(JSON.stringify({ type: 'stats', data: getStats() })); } catch {}
    });
    setInterval(() => {
      if (wss.clients.size === 0) return;
      try {
        const data = JSON.stringify({ type: 'stats', data: getStats() });
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(data);
        }
      } catch {}
    }, 3000);
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
      const { execSync } = require('child_process');
      const platform = process.platform;
      if (platform === 'darwin') execSync(`open ${url}`);
      else if (platform === 'linux') execSync(`xdg-open ${url}`);
      else if (platform === 'win32') execSync(`start ${url}`);
    } catch {}
  }
});

// Graceful shutdown
process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
