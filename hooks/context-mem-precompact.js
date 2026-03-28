#!/usr/bin/env node

/**
 * context-mem PreCompact hook
 * Saves full session state before Claude Code auto-compaction.
 * This is the last chance to capture context before messages are compressed.
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join, resolve } = require('path');
const Database = require('better-sqlite3');

function main() {
  try {
    const projectDir = process.cwd();
    const configPath = join(projectDir, '.context-mem.json');

    if (!existsSync(configPath)) return;

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const dbPath = resolve(projectDir, config.db_path || '.context-mem/store.db');

    if (!existsSync(dbPath)) return;

    const db = new Database(dbPath, { readonly: false });
    db.pragma('journal_mode = WAL');

    // Find current session (most recent in session_chains)
    const latestChain = db.prepare(
      'SELECT session_id FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
    ).get(projectDir);

    if (!latestChain) {
      db.close();
      return;
    }

    const sessionId = latestChain.session_id;

    // Record compaction event
    db.prepare(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, 'compaction', 0, 0, Date.now());

    // Save compaction marker to state file for post-compaction recovery
    const stateDir = join(projectDir, '.context-mem');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    const stateFile = join(stateDir, 'compaction-state.json');
    writeFileSync(stateFile, JSON.stringify({
      session_id: sessionId,
      compacted_at: Date.now(),
      recovered: false,
    }));

    // Extract critical context for post-compaction recovery
    const critical = {};

    // Active plan
    const planEvent = db.prepare(
      "SELECT data FROM events WHERE session_id = ? AND event_type = 'plan' ORDER BY timestamp DESC LIMIT 1"
    ).get(sessionId);
    if (planEvent) {
      try {
        const planData = JSON.parse(planEvent.data);
        critical.plan = planData.content || 'Active plan exists';
      } catch {}
    }

    // Pending tasks
    const taskStarts = db.prepare(
      "SELECT data FROM events WHERE session_id = ? AND event_type = 'task_start' ORDER BY timestamp DESC LIMIT 10"
    ).all(sessionId);
    const taskCompletes = new Set(
      db.prepare(
        "SELECT data FROM events WHERE session_id = ? AND event_type = 'task_complete'"
      ).all(sessionId).map(r => {
        try { return JSON.parse(r.data).task_id; } catch { return null; }
      }).filter(Boolean)
    );
    const pending = taskStarts.filter(r => {
      try { return !taskCompletes.has(JSON.parse(r.data).task_id); } catch { return false; }
    }).map(r => {
      try { return JSON.parse(r.data).description || 'task'; } catch { return 'task'; }
    });
    if (pending.length) critical.tasks = pending;

    // Last 3 decisions
    const decisions = db.prepare(
      "SELECT summary FROM observations WHERE session_id = ? AND type = 'decision' ORDER BY indexed_at DESC LIMIT 3"
    ).all(sessionId);
    if (decisions.length) critical.decisions = decisions.map(r => r.summary);

    // Recently active files
    const files = db.prepare(`
      SELECT DISTINCT json_extract(metadata, '$.file_path') as fp
      FROM observations
      WHERE session_id = ? AND json_extract(metadata, '$.file_path') IS NOT NULL
      ORDER BY indexed_at DESC LIMIT 8
    `).all(sessionId);
    if (files.length) critical.files = files.map(r => r.fp).filter(Boolean);

    // Save critical context
    const criticalFile = join(stateDir, 'compaction-critical.json');
    writeFileSync(criticalFile, JSON.stringify(critical));

    // Update chain entry
    db.prepare(
      "UPDATE session_chains SET handoff_reason = 'compaction' WHERE session_id = ?"
    ).run(sessionId);

    db.close();
  } catch (err) {
    // PreCompact hook must never fail loudly
    if (process.env.CONTEXT_MEM_DEBUG) {
      console.error('[context-mem:precompact]', err.message);
    }
  }
}

main();
