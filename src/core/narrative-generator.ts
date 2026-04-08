/**
 * Session Narrative Generator — generate human-readable narratives from session data.
 *
 * 4 output formats: pr, standup, adr, onboarding.
 * Default: deterministic template-based rendering (zero-LLM).
 */

import type { StoragePlugin } from './types.js';

export type NarrativeFormat = 'pr' | 'standup' | 'adr' | 'onboarding';

export interface NarrativeOpts {
  sessionId?: string;
  timeRange?: { from: number; to: number };
  topic?: string;
  format: NarrativeFormat;
}

export interface NarrativeData {
  decisions: string[];
  errors: string[];
  changes: string[];
  patterns: string[];
  people: string[];
  todos: string[];
}

/**
 * Generate a narrative from session/project data.
 */
export function generateNarrative(
  storage: StoragePlugin,
  opts: NarrativeOpts,
): string {
  const data = gatherData(storage, opts);
  return renderTemplate(data, opts.format);
}

function gatherData(storage: StoragePlugin, opts: NarrativeOpts): NarrativeData {
  const data: NarrativeData = { decisions: [], errors: [], changes: [], patterns: [], people: [], todos: [] };

  let whereClause = '1=1';
  const params: unknown[] = [];

  if (opts.sessionId) {
    whereClause += ' AND session_id = ?';
    params.push(opts.sessionId);
  }
  if (opts.timeRange) {
    whereClause += ' AND indexed_at >= ? AND indexed_at <= ?';
    params.push(opts.timeRange.from, opts.timeRange.to);
  }
  if (opts.topic) {
    whereClause += ' AND (content LIKE ? OR summary LIKE ?)';
    params.push(`%${opts.topic}%`, `%${opts.topic}%`);
  }

  try {
    // Decisions
    const decisions = storage.prepare(
      `SELECT summary, content FROM observations WHERE ${whereClause} AND type = 'decision' ORDER BY indexed_at DESC LIMIT 10`
    ).all(...params) as Array<{ summary: string | null; content: string }>;
    data.decisions = decisions.map(d => (d.summary || d.content).slice(0, 150));

    // Errors
    const errors = storage.prepare(
      `SELECT summary, content FROM observations WHERE ${whereClause} AND type = 'error' ORDER BY indexed_at DESC LIMIT 5`
    ).all(...params) as Array<{ summary: string | null; content: string }>;
    data.errors = errors.map(e => (e.summary || e.content).slice(0, 150));

    // Code changes
    const changes = storage.prepare(
      `SELECT summary, content FROM observations WHERE ${whereClause} AND type IN ('code', 'commit') ORDER BY indexed_at DESC LIMIT 10`
    ).all(...params) as Array<{ summary: string | null; content: string }>;
    data.changes = changes.map(c => (c.summary || c.content).slice(0, 150));
  } catch { /* non-critical */ }

  try {
    // Patterns from knowledge
    const patterns = storage.prepare(
      "SELECT title FROM knowledge WHERE category = 'pattern' AND archived = 0 ORDER BY access_count DESC LIMIT 5"
    ).all() as Array<{ title: string }>;
    data.patterns = patterns.map(p => p.title);
  } catch { /* non-critical */ }

  try {
    // People from entities
    const people = storage.prepare(
      "SELECT name FROM entities WHERE entity_type = 'person' ORDER BY updated_at DESC LIMIT 5"
    ).all() as Array<{ name: string }>;
    data.people = people.map(p => p.name);
  } catch { /* non-critical */ }

  return data;
}

function renderTemplate(data: NarrativeData, format: NarrativeFormat): string {
  switch (format) {
    case 'pr': return renderPR(data);
    case 'standup': return renderStandup(data);
    case 'adr': return renderADR(data);
    case 'onboarding': return renderOnboarding(data);
  }
}

function renderPR(data: NarrativeData): string {
  const parts: string[] = ['## Summary'];
  if (data.changes.length > 0) {
    parts.push(data.changes.map(c => `- ${c}`).join('\n'));
  } else {
    parts.push('No code changes recorded.');
  }

  if (data.decisions.length > 0) {
    parts.push('\n## Decisions');
    parts.push(data.decisions.map(d => `- ${d}`).join('\n'));
  }

  if (data.errors.length > 0) {
    parts.push('\n## Issues Resolved');
    parts.push(data.errors.map(e => `- ${e}`).join('\n'));
  }

  parts.push('\n## Test Plan');
  parts.push('- [ ] Verify changes work as expected');
  parts.push('- [ ] Run existing test suite');

  return parts.join('\n');
}

function renderStandup(data: NarrativeData): string {
  const done = data.changes.length > 0
    ? data.changes.slice(0, 3).map(c => `- ${c}`).join('\n')
    : '- No changes recorded';

  const next = data.todos.length > 0
    ? data.todos.map(t => `- ${t}`).join('\n')
    : '- Continue current work';

  const blockers = data.errors.length > 0
    ? data.errors.slice(0, 2).map(e => `- ${e}`).join('\n')
    : '- None';

  return `**Done:**\n${done}\n\n**Next:**\n${next}\n\n**Blockers:**\n${blockers}`;
}

function renderADR(data: NarrativeData): string {
  const title = data.decisions[0] || 'Untitled Decision';
  const context = data.errors.length > 0
    ? data.errors.map(e => `- ${e}`).join('\n')
    : '- Context not recorded';
  const decision = data.decisions.length > 0
    ? data.decisions.map(d => `- ${d}`).join('\n')
    : '- Decision not recorded';
  const consequences = data.changes.length > 0
    ? data.changes.slice(0, 3).map(c => `- ${c}`).join('\n')
    : '- Consequences not yet observed';

  return `# ${title}\n\n## Context\n${context}\n\n## Decision\n${decision}\n\n## Consequences\n${consequences}`;
}

function renderOnboarding(data: NarrativeData): string {
  const parts: string[] = ['# Project Overview'];

  if (data.patterns.length > 0) {
    parts.push('\n## Architecture & Patterns');
    parts.push(data.patterns.map(p => `- ${p}`).join('\n'));
  }

  if (data.decisions.length > 0) {
    parts.push('\n## Key Decisions');
    parts.push(data.decisions.map(d => `- ${d}`).join('\n'));
  }

  if (data.people.length > 0) {
    parts.push('\n## Team');
    parts.push(data.people.map(p => `- ${p}`).join('\n'));
  }

  return parts.join('\n');
}
