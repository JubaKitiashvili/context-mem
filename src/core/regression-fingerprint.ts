/**
 * Regression Fingerprinting — capture "working state" snapshots at success events
 * and diff against current state when errors appear.
 */

import type { StoragePlugin } from './types.js';
import { ulid } from './utils.js';

export interface Fingerprint {
  knowledge_ids: string[];
  recent_files: string[];
  error_patterns_absent: string[];
  entity_state: string[];
  timestamp: number;
}

export interface RegressionDiff {
  added_errors: string[];
  changed_knowledge: string[];
  modified_files: string[];
  new_entities: string[];
  likely_causes: string[];
}

/**
 * Capture a snapshot of the current working state.
 */
export function captureFingerprint(
  storage: StoragePlugin,
  sessionId: string,
  trigger: string,
): Fingerprint {
  const now = Date.now();

  // Recent knowledge IDs
  const knowledgeIds = storage.prepare(
    'SELECT id FROM knowledge WHERE archived = 0 ORDER BY created_at DESC LIMIT 20'
  ).all() as Array<{ id: string }>;

  // Recent files from events
  const recentFiles = storage.prepare(`
    SELECT DISTINCT json_extract(data, '$.file') as file
    FROM events
    WHERE session_id = ? AND event_type IN ('file_read', 'file_modify')
      AND json_extract(data, '$.file') IS NOT NULL
    ORDER BY timestamp DESC LIMIT 20
  `).all(sessionId) as Array<{ file: string | null }>;

  // Current entities
  const entities = storage.prepare(
    'SELECT name FROM entities ORDER BY updated_at DESC LIMIT 20'
  ).all() as Array<{ name: string }>;

  // Error patterns (currently absent = no recent errors)
  const recentErrors = storage.prepare(`
    SELECT content FROM observations
    WHERE type = 'error' AND indexed_at > ?
    ORDER BY indexed_at DESC LIMIT 5
  `).all(now - 24 * 60 * 60 * 1000) as Array<{ content: string }>;

  const fingerprint: Fingerprint = {
    knowledge_ids: knowledgeIds.map(r => r.id),
    recent_files: recentFiles.filter(r => r.file).map(r => r.file!),
    error_patterns_absent: recentErrors.map(r => r.content.slice(0, 100)),
    entity_state: entities.map(r => r.name),
    timestamp: now,
  };

  // Store fingerprint
  storage.exec(
    `INSERT INTO working_fingerprints (id, session_id, fingerprint, trigger_event, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [ulid(), sessionId, JSON.stringify(fingerprint), trigger, now],
  );

  return fingerprint;
}

/**
 * Diff current state against a baseline fingerprint.
 */
export function diffFingerprints(
  storage: StoragePlugin,
  baseline: Fingerprint,
): RegressionDiff {
  const now = Date.now();

  // New errors since baseline
  const newErrors = storage.prepare(`
    SELECT content FROM observations
    WHERE type = 'error' AND indexed_at > ?
    ORDER BY indexed_at DESC LIMIT 10
  `).all(baseline.timestamp) as Array<{ content: string }>;

  // Changed knowledge
  const changedKnowledge: string[] = [];
  for (const kid of baseline.knowledge_ids.slice(0, 10)) {
    const entry = storage.prepare('SELECT title, archived FROM knowledge WHERE id = ?').get(kid) as { title: string; archived: number } | undefined;
    if (!entry || entry.archived) {
      changedKnowledge.push(`${kid} (archived or deleted)`);
    }
  }

  // New entities
  const currentEntities = storage.prepare(
    'SELECT name FROM entities WHERE created_at > ? ORDER BY created_at DESC LIMIT 10'
  ).all(baseline.timestamp) as Array<{ name: string }>;
  const baselineEntitySet = new Set(baseline.entity_state);

  const diff: RegressionDiff = {
    added_errors: newErrors.map(e => e.content.slice(0, 150)),
    changed_knowledge: changedKnowledge,
    modified_files: [], // Would need git integration for full file tracking
    new_entities: currentEntities.filter(e => !baselineEntitySet.has(e.name)).map(e => e.name),
    likely_causes: [],
  };

  // Infer likely causes
  if (diff.added_errors.length > 0 && diff.changed_knowledge.length > 0) {
    diff.likely_causes.push('Knowledge entries changed since last working state');
  }
  if (diff.new_entities.length > 0) {
    diff.likely_causes.push(`New components introduced: ${diff.new_entities.join(', ')}`);
  }

  return diff;
}

/**
 * Get the most recent fingerprint for a session.
 */
export function getLastFingerprint(
  storage: StoragePlugin,
  sessionId?: string,
): Fingerprint | null {
  try {
    let row: { fingerprint: string } | undefined;
    if (sessionId) {
      row = storage.prepare(
        'SELECT fingerprint FROM working_fingerprints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(sessionId) as { fingerprint: string } | undefined;
    } else {
      row = storage.prepare(
        'SELECT fingerprint FROM working_fingerprints ORDER BY created_at DESC LIMIT 1'
      ).get() as { fingerprint: string } | undefined;
    }
    return row ? JSON.parse(row.fingerprint) : null;
  } catch {
    return null;
  }
}
