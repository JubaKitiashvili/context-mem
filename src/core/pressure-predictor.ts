/**
 * Memory Pressure Predictor — score entries by loss risk.
 *
 * Risk = inverse of (importance × recency × access_frequency × usefulness).
 * High-risk entries are most likely to be forgotten or archived.
 */

import type { StoragePlugin } from './types.js';

export interface PressureEntry {
  id: string;
  title: string;
  type: 'observation' | 'knowledge';
  risk_score: number;
  reasons: string[];
  age_days: number;
  access_count: number;
  importance_score: number;
}

const HALF_LIFE_DAYS = 14;

/**
 * Predict which entries are at highest risk of loss.
 */
export function predictLoss(
  storage: StoragePlugin,
  limit = 10,
): PressureEntry[] {
  const entries: PressureEntry[] = [];
  const now = Date.now();

  // Score observations
  try {
    const obs = storage.prepare(`
      SELECT id, type, summary, content, indexed_at, importance_score, access_count, pinned, last_useful_at
      FROM observations
      WHERE pinned = 0
      ORDER BY importance_score ASC, indexed_at ASC
      LIMIT 50
    `).all() as Array<{
      id: string; type: string; summary: string | null; content: string;
      indexed_at: number; importance_score: number; access_count: number;
      pinned: number; last_useful_at: number | null;
    }>;

    for (const o of obs) {
      const ageDays = (now - o.indexed_at) / (24 * 60 * 60 * 1000);
      const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const accessFactor = Math.log2(Math.max(1, o.access_count + 1)) / 5;
      const usefulFactor = o.last_useful_at ? 0.5 : 0;
      const importance = o.importance_score || 0.5;

      const survivalScore = importance * 0.4 + recency * 0.3 + accessFactor * 0.2 + usefulFactor * 0.1;
      const riskScore = Math.max(0, Math.min(1, 1 - survivalScore));

      const reasons: string[] = [];
      if (importance < 0.4) reasons.push('low importance');
      if (ageDays > 30) reasons.push(`${Math.round(ageDays)} days old`);
      if (o.access_count === 0) reasons.push('never accessed');
      if (!o.last_useful_at) reasons.push('never marked useful');

      entries.push({
        id: o.id,
        title: (o.summary || o.content).slice(0, 100),
        type: 'observation',
        risk_score: Math.round(riskScore * 100) / 100,
        reasons,
        age_days: Math.round(ageDays),
        access_count: o.access_count,
        importance_score: o.importance_score,
      });
    }
  } catch { /* non-critical */ }

  // Score knowledge entries
  try {
    const kn = storage.prepare(`
      SELECT id, title, relevance_score, access_count, created_at, last_useful_at
      FROM knowledge
      WHERE archived = 0
      ORDER BY relevance_score ASC, created_at ASC
      LIMIT 30
    `).all() as Array<{
      id: string; title: string; relevance_score: number;
      access_count: number; created_at: number; last_useful_at: number | null;
    }>;

    for (const k of kn) {
      const ageDays = (now - k.created_at) / (24 * 60 * 60 * 1000);
      const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const accessFactor = Math.log2(Math.max(1, k.access_count + 1)) / 5;
      const usefulFactor = k.last_useful_at ? 0.5 : 0;
      const importance = Math.min(1, k.relevance_score);

      const survivalScore = importance * 0.4 + recency * 0.3 + accessFactor * 0.2 + usefulFactor * 0.1;
      const riskScore = Math.max(0, Math.min(1, 1 - survivalScore));

      const reasons: string[] = [];
      if (importance < 0.5) reasons.push('low relevance');
      if (ageDays > 60) reasons.push(`${Math.round(ageDays)} days old`);
      if (k.access_count === 0) reasons.push('never accessed');

      entries.push({
        id: k.id,
        title: k.title,
        type: 'knowledge',
        risk_score: Math.round(riskScore * 100) / 100,
        reasons,
        age_days: Math.round(ageDays),
        access_count: k.access_count,
        importance_score: importance,
      });
    }
  } catch { /* non-critical */ }

  // Sort by risk descending, return top N
  return entries.sort((a, b) => b.risk_score - a.risk_score).slice(0, limit);
}
