/**
 * Wake-Up Primer — auto-generated, importance-scored, token-budgeted
 * context injected at session start.
 *
 * 4-layer structure:
 * - L0 Profile (~15%): Project profile
 * - L1 Critical (~40%): Top knowledge entries by combined score
 * - L2 Recent (~30%): Last session decisions + open TODOs
 * - L3 Entities (~15%): Top entities by relationship count
 */

import type { StoragePlugin } from './types.js';
import { estimateTokens } from './utils.js';

export interface WakeUpPayload {
  l0_profile: string;
  l1_critical: string;
  l2_recent: string;
  l3_entities: string;
  total_tokens: number;
}

export interface WakeUpConfig {
  total_budget_tokens?: number; // default 700
}

const DEFAULT_BUDGET = 700;
const HALF_LIFE_DAYS = 7;

/**
 * Assemble a wake-up primer from the database.
 */
export function assembleWakeUp(
  storage: StoragePlugin,
  config?: WakeUpConfig,
): WakeUpPayload {
  const budget = config?.total_budget_tokens ?? DEFAULT_BUDGET;

  // Budget allocation: L0=15%, L1=40%, L2=30%, L3=15%
  const l0Budget = Math.floor(budget * 0.15);
  const l1Budget = Math.floor(budget * 0.40);
  const l2Budget = Math.floor(budget * 0.30);
  const l3Budget = Math.floor(budget * 0.15);

  const l0 = buildL0Profile(storage, l0Budget);
  const l1 = buildL1Critical(storage, l1Budget);
  const l2 = buildL2Recent(storage, l2Budget);
  const l3 = buildL3Entities(storage, l3Budget);

  return {
    l0_profile: l0,
    l1_critical: l1,
    l2_recent: l2,
    l3_entities: l3,
    total_tokens: estimateTokens(l0) + estimateTokens(l1) + estimateTokens(l2) + estimateTokens(l3),
  };
}

/**
 * L0: Project profile from project_profile table.
 */
function buildL0Profile(storage: StoragePlugin, budgetTokens: number): string {
  try {
    const row = storage.prepare('SELECT content FROM project_profile WHERE id = 1').get() as { content: string } | undefined;
    if (row && row.content.trim()) {
      return truncateToTokens(row.content.trim(), budgetTokens);
    }
  } catch { /* table may not exist */ }
  return '';
}

/**
 * L1: Top knowledge entries ranked by importance * recency * access.
 */
function buildL1Critical(storage: StoragePlugin, budgetTokens: number): string {
  try {
    const rows = storage.prepare(`
      SELECT id, title, content, relevance_score, access_count, last_accessed, created_at
      FROM knowledge
      WHERE archived = 0 AND (valid_to IS NULL)
      ORDER BY relevance_score DESC, access_count DESC
      LIMIT 20
    `).all() as Array<{
      id: string; title: string; content: string;
      relevance_score: number; access_count: number; last_accessed: number; created_at: number;
    }>;

    if (rows.length === 0) return '';

    // Score each entry: importance * (1 + log(access_count+1)) * recency_weight
    const now = Date.now();
    const scored = rows.map(r => {
      const ageDays = Math.max(0, (now - (r.last_accessed || r.created_at)) / (24 * 60 * 60 * 1000));
      const recencyWeight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const accessFactor = 1 + Math.log2(Math.max(1, r.access_count + 1));
      const score = r.relevance_score * accessFactor * recencyWeight;
      return { ...r, score };
    }).sort((a, b) => b.score - a.score).slice(0, 10);

    const lines: string[] = [];
    let usedTokens = 0;
    for (const entry of scored) {
      const line = `- ${entry.title}: ${entry.content.slice(0, 120)}`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens > budgetTokens) break;
      lines.push(line);
      usedTokens += lineTokens;
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * L2: Last session's key decisions and open TODOs from snapshot.
 */
function buildL2Recent(storage: StoragePlugin, budgetTokens: number): string {
  try {
    // Get latest snapshot
    const snapshot = storage.prepare(
      'SELECT snapshot FROM snapshots ORDER BY created_at DESC LIMIT 1'
    ).get() as { snapshot: string } | undefined;

    if (!snapshot) return '';

    const data = JSON.parse(snapshot.snapshot);
    const parts: string[] = [];

    // Include decisions if present
    if (data.decisions && Array.isArray(data.decisions)) {
      for (const d of data.decisions.slice(0, 3)) {
        parts.push(`Decision: ${typeof d === 'string' ? d : (d.summary || d.content || '').slice(0, 100)}`);
      }
    }

    // Include pending tasks if present
    if (data.tasks && Array.isArray(data.tasks)) {
      for (const t of data.tasks.slice(0, 3)) {
        parts.push(`TODO: ${typeof t === 'string' ? t : (t.name || t.data || '').slice(0, 100)}`);
      }
    }

    // Include recent errors
    if (data.errors && Array.isArray(data.errors)) {
      for (const e of data.errors.slice(0, 2)) {
        parts.push(`Error: ${typeof e === 'string' ? e : (e.summary || e.content || '').slice(0, 100)}`);
      }
    }

    return truncateToTokens(parts.join('\n'), budgetTokens);
  } catch {
    return '';
  }
}

/**
 * L3: Top entities by recent relationship count.
 */
function buildL3Entities(storage: StoragePlugin, budgetTokens: number): string {
  try {
    const rows = storage.prepare(`
      SELECT e.name, e.entity_type,
             (SELECT COUNT(*) FROM relationships r WHERE r.from_entity = e.id OR r.to_entity = e.id) as rel_count
      FROM entities e
      ORDER BY rel_count DESC, e.updated_at DESC
      LIMIT 5
    `).all() as Array<{ name: string; entity_type: string; rel_count: number }>;

    if (rows.length === 0) return '';

    const lines = rows
      .filter(r => r.rel_count > 0)
      .map(r => `- ${r.name} (${r.entity_type}, ${r.rel_count} connections)`);

    return truncateToTokens(lines.join('\n'), budgetTokens);
  } catch {
    return '';
  }
}

/**
 * Truncate text to fit within a token budget.
 */
function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;

  // Binary search for the right truncation point
  const chars = Math.floor(maxTokens * 4); // rough estimate: 1 token ≈ 4 chars
  return text.slice(0, chars);
}
