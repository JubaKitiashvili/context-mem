import type { SearchResult } from '../../core/types.js';

/**
 * Softmax: competitive normalization over an array of scores.
 * Returns probabilities that sum to 1.
 */
export function softmax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores); // numerical stability
  const exps = scores.map(s => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/**
 * Normalize search results within a block to 0-1 range.
 * Prevents blocks with many entries from dominating via raw score magnitude.
 */
export function normalizeBlock(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;
  if (results.length === 1) return [{ ...results[0], relevance_score: 1.0 }];

  const scores = results.map(r => r.relevance_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min + 1e-8;

  return results.map(r => ({
    ...r,
    relevance_score: (r.relevance_score - min) / range,
  }));
}

/**
 * Select blocks whose softmax attention exceeds the threshold.
 * Returns indices of selected blocks.
 */
export function selectBlocks(blockScores: number[], threshold: number = 0.05): number[] {
  const attention = softmax(blockScores);
  return attention
    .map((a, i) => ({ index: i, attention: a }))
    .filter(b => b.attention >= threshold)
    .map(b => b.index);
}
