/**
 * Decision Trail Builder — reconstruct the evidence chain behind decisions.
 *
 * Walks events + observations + entity graph backward from a decision
 * to find the context that led to it.
 */

import type { StoragePlugin } from './types.js';
import { ulid } from './utils.js';

export interface EvidenceItem {
  type: 'file_read' | 'error' | 'search' | 'knowledge' | 'decision' | 'fix';
  content: string;
  timestamp: number;
  source_id?: string;
}

export interface DecisionTrail {
  decision: string;
  date: number;
  evidence_chain: EvidenceItem[];
  alternatives_considered: string[];
  related_entities: string[];
  confidence: number;
}

/**
 * Build a decision trail for a query (file path or topic).
 */
export function buildTrail(
  storage: StoragePlugin,
  query: string,
): DecisionTrail | null {
  // 1. Find matching decisions (observations with DECISION flag or decision type)
  const decisions = storage.prepare(`
    SELECT id, content, summary, indexed_at, metadata, session_id
    FROM observations
    WHERE (type = 'decision' OR metadata LIKE '%DECISION%')
      AND (content LIKE ? OR summary LIKE ?)
    ORDER BY indexed_at DESC
    LIMIT 5
  `).all(`%${query}%`, `%${query}%`) as Array<{
    id: string; content: string; summary: string | null;
    indexed_at: number; metadata: string; session_id: string | null;
  }>;

  if (decisions.length === 0) {
    // Try knowledge entries
    const knowledgeDecisions = storage.prepare(`
      SELECT id, title, content, created_at
      FROM knowledge
      WHERE category = 'decision' AND (title LIKE ? OR content LIKE ?)
      ORDER BY created_at DESC
      LIMIT 3
    `).all(`%${query}%`, `%${query}%`) as Array<{
      id: string; title: string; content: string; created_at: number;
    }>;

    if (knowledgeDecisions.length === 0) return null;

    // Build minimal trail from knowledge
    const kd = knowledgeDecisions[0];
    return {
      decision: kd.title,
      date: kd.created_at,
      evidence_chain: [{
        type: 'knowledge',
        content: kd.content,
        timestamp: kd.created_at,
        source_id: kd.id,
      }],
      alternatives_considered: findAlternatives(storage, kd.id),
      related_entities: findRelatedEntities(storage, kd.content),
      confidence: 0.6,
    };
  }

  // Use most recent decision
  const decision = decisions[0];
  const evidence: EvidenceItem[] = [];
  const sessionId = decision.session_id;

  // 2. Find preceding events in the same session
  if (sessionId) {
    const precedingEvents = storage.prepare(`
      SELECT id, event_type, data, timestamp
      FROM events
      WHERE session_id = ?
        AND timestamp < ?
        AND timestamp > ?
      ORDER BY timestamp DESC
      LIMIT 20
    `).all(sessionId, decision.indexed_at, decision.indexed_at - 60 * 60 * 1000) as Array<{
      id: string; event_type: string; data: string; timestamp: number;
    }>;

    for (const event of precedingEvents) {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(event.data); } catch { /* ignore */ }

      const content = data.file
        ? `${event.event_type}: ${data.file}`
        : `${event.event_type}: ${JSON.stringify(data).slice(0, 150)}`;

      let type: EvidenceItem['type'] = 'search';
      if (event.event_type === 'file_read') type = 'file_read';
      else if (event.event_type === 'error') type = 'error';
      else if (event.event_type === 'file_modify') type = 'fix';
      else if (event.event_type === 'decision') type = 'decision';
      else if (event.event_type === 'search') type = 'search';

      evidence.push({ type, content, timestamp: event.timestamp, source_id: event.id });
    }
  }

  // 3. Find preceding error/context observations
  const precedingObs = storage.prepare(`
    SELECT id, type, summary, content, indexed_at
    FROM observations
    WHERE indexed_at < ? AND indexed_at > ?
      AND type IN ('error', 'context', 'code')
    ORDER BY indexed_at DESC
    LIMIT 5
  `).all(decision.indexed_at, decision.indexed_at - 24 * 60 * 60 * 1000) as Array<{
    id: string; type: string; summary: string | null; content: string; indexed_at: number;
  }>;

  for (const obs of precedingObs) {
    evidence.push({
      type: obs.type === 'error' ? 'error' : 'file_read',
      content: (obs.summary || obs.content).slice(0, 200),
      timestamp: obs.indexed_at,
      source_id: obs.id,
    });
  }

  // Add the decision itself
  evidence.push({
    type: 'decision',
    content: (decision.summary || decision.content).slice(0, 300),
    timestamp: decision.indexed_at,
    source_id: decision.id,
  });

  // Sort chronologically
  evidence.sort((a, b) => a.timestamp - b.timestamp);

  // 4. Find alternatives (superseded entries)
  const alternatives = findAlternatives(storage, decision.id);

  // 5. Find related entities
  const entities = findRelatedEntities(storage, decision.content);

  // 6. Store trail
  const trail: DecisionTrail = {
    decision: (decision.summary || decision.content).slice(0, 200),
    date: decision.indexed_at,
    evidence_chain: evidence,
    alternatives_considered: alternatives,
    related_entities: entities,
    confidence: Math.min(1.0, 0.3 + evidence.length * 0.1),
  };

  try {
    storage.exec(
      `INSERT INTO decision_trails (id, decision_summary, file_path, topic, trail, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ulid(), trail.decision, null, query, JSON.stringify(trail.evidence_chain), sessionId || null, Date.now()],
    );
  } catch { /* non-critical */ }

  return trail;
}

function findAlternatives(storage: StoragePlugin, decisionId: string): string[] {
  try {
    const rows = storage.prepare(`
      SELECT title FROM knowledge
      WHERE superseded_by = ? OR id IN (
        SELECT superseded_by FROM knowledge WHERE id = ?
      )
      LIMIT 5
    `).all(decisionId, decisionId) as Array<{ title: string }>;
    return rows.map(r => r.title);
  } catch {
    return [];
  }
}

function findRelatedEntities(storage: StoragePlugin, content: string): string[] {
  try {
    // Simple: find entities mentioned in the decision content
    const entities = storage.prepare(
      'SELECT name FROM entities ORDER BY updated_at DESC LIMIT 50'
    ).all() as Array<{ name: string }>;

    return entities
      .filter(e => content.toLowerCase().includes(e.name.toLowerCase()))
      .map(e => e.name)
      .slice(0, 10);
  } catch {
    return [];
  }
}
