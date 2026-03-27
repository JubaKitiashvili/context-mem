#!/usr/bin/env node
'use strict';

/**
 * context-mem Proactive Context Injection — PostToolUse hook
 *
 * Fires after Read, Edit, Bash tools. Searches the knowledge base,
 * entity graph, and recent observations for relevant context about
 * the file/command being worked on. Injects results into Claude's
 * context via stdout.
 *
 * Rate-limited: max 3 injections/min, 5-min cooldown per file.
 * State stored in .context-mem/inject-state.json.
 *
 * Zero external dependencies — reads SQLite directly via better-sqlite3.
 * All wrapped in try/catch — never blocks Claude.
 */

const fs = require('fs');
const path = require('path');

try {
  main();
} catch {
  // Never block Claude
  process.exit(0);
}

function main() {
  // --- Read stdin ---
  let input = '';
  try {
    input = fs.readFileSync(0, 'utf8');
  } catch { process.exit(0); }

  if (!input.trim()) process.exit(0);

  let data;
  try {
    data = JSON.parse(input);
  } catch { process.exit(0); }

  const toolName = data.tool_name;
  const toolInput = data.tool_input || {};

  // --- Load config ---
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  // Check if disabled
  if (config.enabled === false) process.exit(0);

  // Check if this tool type should trigger injection
  const injectOn = config.inject_on || ['Read', 'Edit'];
  if (!injectOn.includes(toolName) && toolName !== 'Bash') process.exit(0);
  if (toolName === 'Bash' && !injectOn.includes('Bash')) process.exit(0);

  // --- Extract query context ---
  const queryInfo = extractQueryFromAction(toolName, toolInput);
  if (!queryInfo || !queryInfo.query) process.exit(0);

  // --- Rate limit check ---
  const maxPerMinute = config.max_injections_per_minute || 3;
  const cooldownMs = (config.file_cooldown_seconds || 300) * 1000;
  const statePath = path.join(cwd, '.context-mem', 'inject-state.json');
  const state = loadState(statePath);
  const now = Date.now();

  // Clean old injection timestamps (older than 1 minute)
  state.last_injections = (state.last_injections || []).filter(t => now - t < 60000);

  // Check per-minute limit
  if (state.last_injections.length >= maxPerMinute) process.exit(0);

  // Check per-file cooldown
  state.file_cooldowns = state.file_cooldowns || {};
  if (queryInfo.filePath && state.file_cooldowns[queryInfo.filePath]) {
    if (now - state.file_cooldowns[queryInfo.filePath] < cooldownMs) process.exit(0);
  }

  // --- Open database ---
  const db = openDatabase(cwd);
  if (!db) process.exit(0);

  try {
    // --- Search for relevant context ---
    const threshold = config.relevance_threshold || 0.6;
    const maxChars = config.max_injection_chars || 500;
    const results = searchRelevantContext(db, queryInfo.query, queryInfo.filePath);

    // Filter by relevance threshold
    const relevant = results.filter(r => r.score >= threshold);
    if (relevant.length === 0) process.exit(0);

    // Format and output
    const injection = formatInjection(relevant, maxChars);
    if (!injection) process.exit(0);

    // Update state
    state.last_injections.push(now);
    if (queryInfo.filePath) {
      state.file_cooldowns[queryInfo.filePath] = now;
    }
    // Clean old file cooldowns (older than cooldown period)
    for (const fp of Object.keys(state.file_cooldowns)) {
      if (now - state.file_cooldowns[fp] > cooldownMs) {
        delete state.file_cooldowns[fp];
      }
    }
    saveState(statePath, state);

    console.log(injection);
  } finally {
    try { db.close(); } catch {}
  }
}

// --- Config ---

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.context-mem.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return cfg.proactive_injection || {};
    }
  } catch {}
  return {};
}

// --- State management ---

function loadState(statePath) {
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch {}
  return { last_injections: [], file_cooldowns: {} };
}

function saveState(statePath, state) {
  try {
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
  } catch {}
}

// --- Database ---

function openDatabase(cwd) {
  const dbPath = findDb(cwd);
  if (!dbPath) return null;

  const Database = loadBetterSqlite3();
  if (!Database) return null;

  try {
    return new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

function findDb(cwd) {
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

function loadBetterSqlite3() {
  const paths = [
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),
    'better-sqlite3',
  ];
  for (const p of paths) {
    try { return require(p); } catch {}
  }
  return null;
}

// --- Query extraction ---

function extractQueryFromAction(toolName, input) {
  switch (toolName) {
    case 'Read':
    case 'Edit': {
      const filePath = input.file_path;
      if (!filePath) return null;
      const parts = filePath.split('/');
      const filename = parts[parts.length - 1].replace(/\.\w+$/, '');
      const dirContext = parts.slice(-3, -1).join(' ');
      return { query: `${filename} ${dirContext}`.trim(), filePath };
    }

    case 'Bash': {
      const cmd = input.command || '';
      if (cmd.includes('test')) return { query: 'test failures known issues', filePath: null };
      if (cmd.includes('build') || cmd.includes('npm run')) return { query: 'build errors dependencies', filePath: null };
      return null; // Skip other bash commands
    }

    default:
      return null;
  }
}

// --- FTS5 sanitization ---

function sanitizeFTS5(query) {
  // Remove special FTS5 characters, keep words
  return query
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 1)
    .map(w => `"${w}"`)
    .join(' OR ');
}

// --- Search pipeline ---

function searchRelevantContext(db, query, filePath) {
  const results = [];

  // 1. Knowledge base search via FTS5
  try {
    const ftsQuery = sanitizeFTS5(query);
    if (ftsQuery) {
      const knowledge = db.prepare(`
        SELECT title, content, category, access_count
        FROM knowledge WHERE archived = 0
        AND id IN (SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH ?)
        ORDER BY access_count DESC LIMIT 3
      `).all(ftsQuery);

      for (const k of knowledge) {
        results.push({
          text: `${k.category}: ${k.title}`,
          score: 0.8,
        });
      }
    }
  } catch {}

  // 2. Graph neighbors (if file entity exists)
  if (filePath) {
    try {
      const fileEntity = db.prepare(
        "SELECT id FROM entities WHERE name = ? AND entity_type = 'file'"
      ).get(filePath);

      if (fileEntity) {
        const neighbors = db.prepare(`
          SELECT e.name, e.entity_type, r.relationship_type
          FROM relationships r
          JOIN entities e ON (e.id = r.from_entity OR e.id = r.to_entity) AND e.id != ?
          WHERE r.from_entity = ? OR r.to_entity = ?
          LIMIT 5
        `).all(fileEntity.id, fileEntity.id, fileEntity.id);

        for (const n of neighbors) {
          results.push({
            text: `${n.relationship_type}: ${n.name} (${n.entity_type})`,
            score: 0.7,
          });
        }
      }
    } catch {}
  }

  // 3. Recent observations about this file
  if (filePath) {
    try {
      const recentObs = db.prepare(`
        SELECT substr(COALESCE(summary, content), 1, 200) as text
        FROM observations
        WHERE json_extract(metadata, '$.file_path') = ?
        AND type IN ('error', 'decision')
        ORDER BY indexed_at DESC LIMIT 2
      `).all(filePath);

      for (const o of recentObs) {
        results.push({
          text: o.text,
          score: 0.6,
        });
      }
    } catch {}
  }

  return results;
}

// --- Output formatting ---

function formatInjection(results, maxChars) {
  const lines = [];
  let totalChars = 0;
  const header = '[context-mem] Relevant context:';
  totalChars += header.length;

  for (const r of results.slice(0, 3)) {
    const line = `- ${r.text}`;
    if (totalChars + line.length + 1 > maxChars) {
      // Truncate this line to fit
      const remaining = maxChars - totalChars - 4; // "- " + "..."
      if (remaining > 10) {
        lines.push(`- ${r.text.slice(0, remaining)}...`);
      }
      break;
    }
    lines.push(line);
    totalChars += line.length + 1; // +1 for newline
  }

  if (lines.length === 0) return null;
  return `${header}\n${lines.join('\n')}`;
}
