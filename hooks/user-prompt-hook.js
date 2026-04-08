#!/usr/bin/env node
'use strict';

/**
 * context-mem Context-Triggered Wake-Up — UserPromptSubmit hook
 *
 * Fires on every user message. Extracts key terms, queries the knowledge
 * base and recent observations for relevant context, and injects up to
 * 3 relevant memories (max 300 tokens) into the conversation.
 *
 * Rate-limited: max 2 injections/minute, 5-min cooldown per topic.
 * State stored in .context-mem/prompt-hook-state.json.
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
  // Read user message from stdin (hook receives the prompt)
  const input = getStdinInput();
  if (!input || input.length < 10) {
    process.exit(0);
  }

  const projectDir = findProjectDir();
  if (!projectDir) process.exit(0);

  const dbPath = path.join(projectDir, '.context-mem', 'store.db');
  if (!fs.existsSync(dbPath)) process.exit(0);

  // Rate limiting
  const statePath = path.join(projectDir, '.context-mem', 'prompt-hook-state.json');
  const state = loadState(statePath);
  if (isRateLimited(state)) process.exit(0);

  // Extract key terms from user message
  const terms = extractTerms(input);
  if (terms.length === 0) process.exit(0);

  // Check topic cooldown
  const topicKey = terms.slice(0, 3).join(',');
  if (isTopicCooling(state, topicKey)) process.exit(0);

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    process.exit(0);
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');
  } catch {
    process.exit(0);
  }

  try {
    const memories = searchMemories(db, terms);
    if (memories.length === 0) {
      db.close();
      process.exit(0);
    }

    // Format output (max 300 tokens ≈ 1200 chars)
    const output = formatMemories(memories);
    if (output.length > 0) {
      process.stdout.write(output);
      updateState(statePath, state, topicKey);
    }
  } catch {
    // Non-critical
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function getStdinInput() {
  try {
    // In hook context, the user's message is passed as an environment variable or arg
    if (process.env.CLAUDE_USER_PROMPT) {
      return process.env.CLAUDE_USER_PROMPT;
    }
    // Fallback: try to read from argv
    if (process.argv.length > 2) {
      return process.argv.slice(2).join(' ');
    }
    return '';
  } catch {
    return '';
  }
}

function findProjectDir() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.context-mem'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function extractTerms(text) {
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'did', 'does',
    'have', 'has', 'had', 'been', 'be', 'will', 'would', 'could', 'should',
    'can', 'may', 'might', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
    'by', 'from', 'about', 'we', 'our', 'us', 'i', 'you', 'it', 'this',
    'that', 'what', 'when', 'who', 'why', 'how', 'which', 'where', 'not',
    'but', 'and', 'or', 'if', 'then', 'so', 'no', 'yes', 'all', 'any',
    'some', 'me', 'my', 'your', 'his', 'her', 'its', 'just', 'also',
    'please', 'help', 'need', 'want', 'know', 'think', 'make', 'like',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 10);
}

function searchMemories(db, terms) {
  const memories = [];

  // Search knowledge base
  try {
    const query = terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
    const rows = db.prepare(`
      SELECT k.title, k.content, k.relevance_score
      FROM knowledge_fts kf
      JOIN knowledge k ON k.rowid = kf.rowid
      WHERE knowledge_fts MATCH ?
        AND k.archived = 0
        AND k.valid_to IS NULL
      ORDER BY k.relevance_score DESC
      LIMIT 3
    `).all(query);

    for (const row of rows) {
      memories.push({
        type: 'knowledge',
        title: row.title,
        content: row.content.slice(0, 200),
        score: row.relevance_score,
      });
    }
  } catch { /* FTS may fail on unusual queries */ }

  // Search recent observations
  if (memories.length < 3) {
    try {
      const query = terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
      const rows = db.prepare(`
        SELECT o.type, o.summary, o.content, o.importance_score
        FROM obs_fts of2
        JOIN observations o ON o.rowid = of2.rowid
        WHERE obs_fts MATCH ?
        ORDER BY o.importance_score DESC, o.indexed_at DESC
        LIMIT ?
      `).all(query, 3 - memories.length);

      for (const row of rows) {
        memories.push({
          type: 'observation',
          title: row.type,
          content: (row.summary || row.content || '').slice(0, 200),
          score: row.importance_score || 0.5,
        });
      }
    } catch { /* non-critical */ }
  }

  return memories;
}

function formatMemories(memories) {
  if (memories.length === 0) return '';

  const lines = ['[context-mem] Relevant memories:'];
  let chars = 40;

  for (const m of memories) {
    const line = `${m.type === 'knowledge' ? 'Knowledge' : 'Observation'}: ${m.title} — ${m.content}`;
    if (chars + line.length > 1200) break; // ~300 tokens
    lines.push(line);
    chars += line.length;
  }

  return lines.join('\n');
}

function loadState(statePath) {
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch { /* ignore */ }
  return { injections: [], topic_cooldowns: {} };
}

function isRateLimited(state) {
  const now = Date.now();
  const recentInjections = (state.injections || []).filter(t => now - t < 60000);
  return recentInjections.length >= 2; // max 2 per minute
}

function isTopicCooling(state, topicKey) {
  const cooldowns = state.topic_cooldowns || {};
  const lastInjection = cooldowns[topicKey];
  if (!lastInjection) return false;
  return Date.now() - lastInjection < 5 * 60 * 1000; // 5-min cooldown
}

function updateState(statePath, state, topicKey) {
  const now = Date.now();
  state.injections = [...(state.injections || []).filter(t => now - t < 60000), now];
  state.topic_cooldowns = state.topic_cooldowns || {};
  state.topic_cooldowns[topicKey] = now;

  // Prune old cooldowns
  for (const key of Object.keys(state.topic_cooldowns)) {
    if (now - state.topic_cooldowns[key] > 10 * 60 * 1000) {
      delete state.topic_cooldowns[key];
    }
  }

  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}
