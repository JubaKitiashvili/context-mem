#!/usr/bin/env node
'use strict';

/**
 * context-mem Activity Journal — PostToolUse hook
 *
 * Appends structured, human-readable entries to .context-mem/journal.md
 * Captures WHAT was done (tool_input semantics), not just raw output.
 *
 * Zero dependencies on serve, DB, or MCP — writes directly to filesystem.
 * Works in claude -p mode, after serve crash, everywhere.
 */

const fs = require('fs');
const path = require('path');

const MAX_JOURNAL_BYTES = 32768; // 32KB — rotate when exceeded
const MAX_DIFF_CHARS = 120;      // Max chars for old→new preview

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
const toolOutput = data.tool_response || data.tool_output || {};

// --- Build journal entry ---
function buildEntry(name, inp, out) {
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const stdout = out.stdout || out.content || out.output || '';
  const content = typeof stdout === 'string' ? stdout : JSON.stringify(stdout);

  switch (name) {
    case 'Edit': {
      const file = shortPath(inp.file_path);
      const old = truncate(inp.old_string || '', 60);
      const neu = truncate(inp.new_string || '', 60);
      if (inp.replace_all) {
        return `[${time}] EDIT ${file}: replaced all "${old}" → "${neu}"`;
      }
      return `[${time}] EDIT ${file}: "${old}" → "${neu}"`;
    }

    case 'Write': {
      const file = shortPath(inp.file_path);
      const size = inp.content ? inp.content.length : 0;
      return `[${time}] WRITE ${file} (${size} chars)`;
    }

    case 'Read': {
      const file = shortPath(inp.file_path);
      const lines = content.split('\n').length;
      return `[${time}] READ ${file} (${lines} lines)`;
    }

    case 'Bash': {
      const cmd = truncate(inp.command || '', MAX_DIFF_CHARS);
      const exitCode = out.exit_code !== undefined ? out.exit_code : '?';
      const hasError = exitCode !== 0 && exitCode !== '?';
      // Extract first meaningful line of output
      const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
      const preview = truncate(firstLine, 80);
      let entry = `[${time}] BASH [exit:${exitCode}]: ${cmd}`;
      if (hasError && preview) {
        entry += `\n         ⚠ ${preview}`;
      }
      return entry;
    }

    case 'Grep': {
      const pattern = inp.pattern || '';
      const matchCount = Array.isArray(content) ? content.length : content.split('\n').filter(l => l.trim()).length;
      const dir = shortPath(inp.path || '.');
      return `[${time}] GREP "${truncate(pattern, 40)}" in ${dir} → ${matchCount} matches`;
    }

    case 'Glob': {
      const pattern = inp.pattern || '';
      const matchCount = Array.isArray(content) ? content.length : content.split('\n').filter(l => l.trim()).length;
      return `[${time}] GLOB "${pattern}" → ${matchCount} files`;
    }

    default:
      return null;
  }
}

function shortPath(p) {
  if (!p) return '?';
  // Remove cwd prefix for readability
  const cwd = process.cwd();
  if (p.startsWith(cwd)) {
    return p.slice(cwd.length + 1);
  }
  // Show last 3 path segments
  const parts = p.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
}

function truncate(s, max) {
  if (!s) return '';
  const clean = s.replace(/\n/g, '↵').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 3) + '...' : clean;
}

// --- Write to journal ---
const entry = buildEntry(toolName, toolInput, toolOutput);
if (!entry) process.exit(0);

const journalDir = path.join(process.cwd(), '.context-mem');
const journalPath = path.join(journalDir, 'journal.md');

try {
  // Ensure directory exists
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true });
  }

  // Rotate if too large
  if (fs.existsSync(journalPath)) {
    const stat = fs.statSync(journalPath);
    if (stat.size > MAX_JOURNAL_BYTES) {
      // Keep last half of the journal
      const content = fs.readFileSync(journalPath, 'utf8');
      const lines = content.split('\n');
      const half = Math.floor(lines.length / 2);
      const header = '# Activity Journal (rotated at ' + new Date().toISOString() + ')\n\n';
      fs.writeFileSync(journalPath, header + lines.slice(half).join('\n') + '\n');
    }
  } else {
    // Create with header
    const header = '# Activity Journal\n\n';
    fs.writeFileSync(journalPath, header);
  }

  // Append entry
  fs.appendFileSync(journalPath, entry + '\n');
} catch {
  // Journal write is non-critical — never block Claude
}
