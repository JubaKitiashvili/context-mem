#!/usr/bin/env node
'use strict';

/**
 * context-mem SessionStart hook
 *
 * Injects last session's context on Claude Code startup.
 * Priority order:
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

// --- DB context (secondary — historical) ---
function getDbContext() {
  const dbPath = findDb();
  if (!dbPath) return null;

  const Database = loadDatabase();
  if (!Database) return null;

  let db;
  try { db = new Database(dbPath, { readonly: true }); } catch { return null; }

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

// --- Main ---
const output = [];

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
output.push('');
output.push('Dashboard: http://localhost:51893');

if (output.length > 2) {
  console.log(output.join('\n'));
} else {
  console.log('context-mem configured — no data yet.');
  console.log('Dashboard: http://localhost:51893');
}
