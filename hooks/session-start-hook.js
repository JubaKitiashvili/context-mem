#!/usr/bin/env node
'use strict';

/**
 * context-mem SessionStart hook
 *
 * Injects last session's context on Claude Code startup.
 * Priority order:
 *   0. Quick Profile — project summary from knowledge base
 *   1. Activity Journal (.context-mem/journal.md) — richest, most recent
 *   2. DB snapshot + observations — historical context
 *   3. Minimal stats — always available
 *
 * Reads directly from filesystem + SQLite — works before MCP serve starts.
 */

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const journalPath = path.join(cwd, '.context-mem', 'journal.md');

// --- Shared DB helpers (hoisted to avoid double I/O) ---
function findDb() {
  const configPath = path.join(cwd, '.context-mem.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const dbPath = cfg.db_path || '.context-mem/store.db';
      const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(cwd, dbPath);
      if (fs.existsSync(resolved)) return resolved;
    } catch {}
  }
  const defaultPath = path.join(cwd, '.context-mem', 'store.db');
  if (fs.existsSync(defaultPath)) return defaultPath;
  return null;
}

function loadDatabase() {
  const paths = [
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),
    'better-sqlite3',
  ];
  for (const p of paths) {
    try { return require(p); } catch {}
  }
  return null;
}

// Resolve DB once for all functions
const _dbPath = findDb();
const _Database = loadDatabase();

function openDb() {
  if (!_dbPath || !_Database) return null;
  try { return new _Database(_dbPath, { readonly: true }); } catch { return null; }
}

// --- Journal (primary source — richest context) ---
function getJournal() {
  if (!fs.existsSync(journalPath)) return null;
  try {
    const content = fs.readFileSync(journalPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (lines.length === 0) return null;

    // Take last 40 entries (most recent work)
    const recent = lines.slice(-40);

    // Extract unique files touched
    const files = new Set();
    const edits = [];
    const bashes = [];
    for (const line of recent) {
      const editMatch = line.match(/EDIT (.+?):/);
      const writeMatch = line.match(/WRITE (.+?)[\s(]/);
      const readMatch = line.match(/READ (.+?)[\s(]/);
      if (editMatch) { files.add(editMatch[1]); edits.push(line); }
      if (writeMatch) files.add(writeMatch[1]);
      if (readMatch) files.add(readMatch[1]);
      if (line.includes('BASH')) bashes.push(line);
    }

    const sections = [];

    // Summary stats
    sections.push(`Last session: ${lines.length} actions, ${files.size} files touched, ${edits.length} edits`);

    // Recent edits (most valuable — shows WHAT changed)
    if (edits.length > 0) {
      sections.push('');
      sections.push('## Recent Changes');
      // Deduplicate — show unique edits only
      const uniqueEdits = [...new Set(edits)].slice(-15);
      for (const e of uniqueEdits) {
        sections.push(e);
      }
    }

    // Recent bash commands (show what was run)
    if (bashes.length > 0) {
      sections.push('');
      sections.push('## Recent Commands');
      const uniqueBashes = [...new Set(bashes)].slice(-8);
      for (const b of uniqueBashes) {
        sections.push(b);
      }
    }

    // Files touched
    if (files.size > 0) {
      sections.push('');
      sections.push('## Files Touched');
      for (const f of [...files].slice(0, 15)) {
        sections.push(`- ${f}`);
      }
    }

    return sections.join('\n');
  } catch {
    return null;
  }
}

// --- Quick Profile (project summary from knowledge base) ---
function getProfile() {
  const db = openDb();
  if (!db) return null;

  try {
    // Try stored profile first
    try {
      const profile = db.prepare('SELECT content, updated_at FROM project_profile WHERE id = 1').get();
      if (profile && profile.content && profile.content.trim()) {
        return profile.content.trim();
      }
    } catch {
      // table might not exist yet (pre-v5)
    }

    // Auto-generate from knowledge base
    try {
      const lines = [];

      const decisions = db.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category = 'decision' ORDER BY created_at DESC LIMIT 5"
      ).all();
      if (decisions.length > 0) {
        lines.push('Decisions: ' + decisions.map(d => d.title).join(', '));
      }

      const patterns = db.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category = 'pattern' ORDER BY access_count DESC LIMIT 5"
      ).all();
      if (patterns.length > 0) {
        lines.push('Patterns: ' + patterns.map(p => p.title).join(', '));
      }

      const errors = db.prepare(
        "SELECT title FROM knowledge WHERE archived = 0 AND category = 'error' ORDER BY created_at DESC LIMIT 3"
      ).all();
      if (errors.length > 0) {
        lines.push('Recent issues: ' + errors.map(e => e.title).join(', '));
      }

      if (lines.length === 0) return null;
      return lines.join('\n');
    } catch {
      // knowledge table might not exist (pre-v3)
      return null;
    }
  } catch {
    return null;
  } finally {
    try { db.close(); } catch {}
  }
}

function getPromotionNotifications() {
  const logPath = path.join(cwd, '.context-mem', 'promotion-log.json');
  try {
    if (!fs.existsSync(logPath)) return null;
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (!log.entries || !log.entries.length) return null;

    // Only show if not yet notified (within last 24h)
    const now = Date.now();
    if (log.notified_at && now - log.notified_at < 24 * 60 * 60 * 1000) return null;

    const lines = ['[Auto-promoted to global knowledge]'];
    for (const e of log.entries.slice(0, 5)) {
      lines.push(`  - "${e.title}" (${e.sessions} sessions)`);
    }

    // Mark as notified
    log.notified_at = now;
    fs.writeFileSync(logPath, JSON.stringify(log), 'utf8');

    return lines.join('\n');
  } catch {
    return null;
  }
}

// --- DB context (secondary — historical) ---
function getDbContext() {
  const db = openDb();
  if (!db) return null;

  try {
    const lines = [];

    // Stats
    const obsCount = db.prepare('SELECT COUNT(*) as c FROM observations').get();
    const tokenStats = db.prepare(`
      SELECT COALESCE(SUM(tokens_in),0) as t_in, COALESCE(SUM(tokens_out),0) as t_out
      FROM token_stats WHERE event_type = 'store'
    `).get();
    const savingsPct = tokenStats.t_in > 0
      ? Math.round(((tokenStats.t_in - tokenStats.t_out) / tokenStats.t_in) * 100)
      : 0;
    lines.push(`${obsCount.c} total observations, ${savingsPct}% token savings`);

    // Snapshot
    const snapshot = db.prepare(
      'SELECT snapshot FROM snapshots ORDER BY created_at DESC LIMIT 1'
    ).get();

    if (snapshot) {
      try {
        const data = JSON.parse(snapshot.snapshot);
        if (data.decisions) {
          lines.push('');
          lines.push('## Decisions');
          lines.push(String(data.decisions));
        }
        if (data.errors) {
          lines.push('');
          lines.push('## Errors');
          lines.push(String(data.errors));
        }
        if (data.knowledge) {
          lines.push('');
          lines.push('## Knowledge');
          lines.push(String(data.knowledge));
        }
      } catch {}
    }

    // Recent decision/error observations (not in snapshot)
    const important = db.prepare(`
      SELECT type, substr(COALESCE(summary, content), 1, 200) as text
      FROM observations
      WHERE type IN ('decision', 'error')
      ORDER BY indexed_at DESC LIMIT 5
    `).all();

    if (important.length > 0) {
      lines.push('');
      lines.push('## Recent Decisions & Errors');
      for (const obs of important) {
        lines.push(`- [${obs.type}] ${obs.text.replace(/\n/g, ' ').trim()}`);
      }
    }

    return lines.join('\n');
  } catch {
    return null;
  } finally {
    try { db.close(); } catch {}
  }
}

// --- Session chain auto-restore ---
let chainContext = '';
try {
  const db = openDb();
  if (db) {
    try {
      // Load config for thresholds
      let config = {};
      const cfgPath = path.join(cwd, '.context-mem.json');
      if (fs.existsSync(cfgPath)) {
        try { config = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
      }

      // Check if session_chains table exists
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='session_chains'"
      ).get();

      if (tableExists) {
        const projectDir = cwd;
        const latestChain = db.prepare(
          'SELECT * FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
        ).get(projectDir);

        if (latestChain && latestChain.session_id) {
          // created_at is INTEGER (unixepoch seconds)
          const chainCreatedMs = latestChain.created_at * 1000;
          const hoursSince = (Date.now() - chainCreatedMs) / (1000 * 60 * 60);

          const autoThreshold = (config.session_continuity && config.session_continuity.auto_restore_threshold_hours) || 2;
          const lightThreshold = (config.session_continuity && config.session_continuity.light_restore_threshold_hours) || 24;

          if (hoursSince < autoThreshold) {
            // Full auto-restore
            const snapshot = db.prepare(
              'SELECT snapshot FROM snapshots WHERE session_id = ?'
            ).get(latestChain.session_id);

            const lines = [`[Session Continuity — continuing from previous session (${Math.round(hoursSince * 60)}m ago)]`];

            if (latestChain.summary) {
              lines.push(`Previous session: ${latestChain.summary}`);
            }

            if (snapshot) {
              try {
                const data = JSON.parse(snapshot.snapshot);
                if (data.tasks) lines.push(`Pending tasks:\n${data.tasks}`);
                if (data.plan) lines.push(`Active plan: ${String(data.plan).slice(0, 300)}`);
                if (data.decisions) lines.push(`Key decisions:\n${data.decisions}`);
                if (data.files) lines.push(`Working files:\n${data.files}`);
              } catch {}
            }

            chainContext = lines.join('\n');
          } else if (hoursSince < lightThreshold) {
            // Light restore — just chain summary
            if (latestChain.summary) {
              chainContext = `[Previous session (${Math.round(hoursSince)}h ago)]: ${latestChain.summary}`;
            }
          }
          // > lightThreshold: clean start, no chain context
        }
      }
    } finally {
      try { db.close(); } catch {}
    }
  }
} catch {
  // Chain restore is non-critical
}
// --- End session chain auto-restore ---

// --- Main ---
const output = [];

// 0. Quick Profile (project context — always first)
const profile = getProfile();
if (profile) {
  output.push('## Project Profile');
  output.push(profile);
  output.push('');
}

// Promotion notifications
const promotionNote = getPromotionNotifications();
if (promotionNote) {
  output.push(promotionNote);
  output.push('');
}

// 1. Journal (primary — what was done)
const journal = getJournal();
if (journal) {
  output.push('# context-mem — Previous Session Activity');
  output.push('');
  output.push(journal);
}

// 2. DB context (secondary — historical stats + decisions)
const dbCtx = getDbContext();
if (dbCtx) {
  if (journal) {
    output.push('');
    output.push('## Historical Context');
  } else {
    output.push('# context-mem — Session Context');
    output.push('');
  }
  output.push(dbCtx);
}

// 3. Dashboard
const dashPort = parseInt(process.env.CONTEXT_MEM_DASHBOARD_PORT || '51893', 10);
output.push('');
output.push(`View Dashboard @ http://localhost:${dashPort}`);

if (chainContext) {
  output.push('');
  output.push(chainContext);
}

// --- Update check (via bin/update-check.js) ---
try {
  const { execSync } = require('child_process');
  const updateScript = path.join(__dirname, '..', 'bin', 'update-check.js');
  const updateResult = execSync(`node "${updateScript}" 2>/dev/null`, {
    timeout: 6000,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (updateResult) {
    for (const line of updateResult.split('\n')) {
      const parts = line.split(' ');
      if (parts[0] === 'JUST_UPGRADED') {
        output.push('');
        output.push(`context-mem upgraded: ${parts[1]} → ${parts[2]}`);
      } else if (parts[0] === 'UPGRADE_AVAILABLE') {
        output.push('');
        output.push(`Update available: ${parts[1]} → ${parts[2]}  —  npm update context-mem`);
      }
    }
  }
} catch {}

if (output.length > 2) {
  console.log(output.join('\n'));
} else {
  console.log('context-mem configured — no data yet.');
  console.log(`Dashboard: http://localhost:${dashPort}`);
}
