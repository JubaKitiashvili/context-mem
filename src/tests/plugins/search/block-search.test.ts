import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { softmax, normalizeBlock, selectBlocks } from '../../../plugins/search/block-selector.js';
import type { SearchResult } from '../../../core/types.js';

function makeResult(id: string, score: number, timestamp?: number): SearchResult {
  return {
    id,
    title: `Title ${id}`,
    snippet: `Snippet ${id}`,
    relevance_score: score,
    type: 'code',
    timestamp: timestamp ?? Date.now(),
  };
}

describe('softmax', () => {
  it('returns probabilities that sum to 1', () => {
    const result = softmax([1.0, 2.0, 3.0]);
    const sum = result.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-6, `sum should be ~1.0, got ${sum}`);
  });

  it('highest input gets highest probability', () => {
    const result = softmax([1.0, 5.0, 2.0]);
    assert.ok(result[1] > result[0], 'index 1 (5.0) should have highest probability');
    assert.ok(result[1] > result[2], 'index 1 (5.0) should beat index 2 (2.0)');
  });

  it('equal inputs produce equal probabilities', () => {
    const result = softmax([1.0, 1.0, 1.0]);
    assert.ok(Math.abs(result[0] - result[1]) < 1e-6, 'equal inputs should produce equal outputs');
    assert.ok(Math.abs(result[1] - result[2]) < 1e-6, 'equal inputs should produce equal outputs');
  });

  it('handles single element', () => {
    const result = softmax([3.0]);
    assert.ok(Math.abs(result[0] - 1.0) < 1e-6, 'single element should be 1.0');
  });

  it('handles empty array', () => {
    const result = softmax([]);
    assert.equal(result.length, 0);
  });
});

describe('normalizeBlock', () => {
  it('normalizes scores to 0-1 range', () => {
    const results = [makeResult('a', 3.0), makeResult('b', 1.0), makeResult('c', 5.0)];
    const normalized = normalizeBlock(results);

    const scores = normalized.map(r => r.relevance_score);
    assert.ok(Math.min(...scores) >= 0, 'min score should be >= 0');
    assert.ok(Math.max(...scores) <= 1.0 + 1e-6, 'max score should be <= 1.0');
  });

  it('single result gets score 1.0', () => {
    const results = [makeResult('a', 0.5)];
    const normalized = normalizeBlock(results);
    assert.ok(Math.abs(normalized[0].relevance_score - 1.0) < 1e-6, 'single result should get 1.0');
  });

  it('empty array returns empty', () => {
    assert.equal(normalizeBlock([]).length, 0);
  });

  it('preserves relative ordering', () => {
    const results = [makeResult('a', 1.0), makeResult('b', 3.0), makeResult('c', 2.0)];
    const normalized = normalizeBlock(results);

    const bScore = normalized.find(r => r.id === 'b')!.relevance_score;
    const cScore = normalized.find(r => r.id === 'c')!.relevance_score;
    const aScore = normalized.find(r => r.id === 'a')!.relevance_score;

    assert.ok(bScore > cScore, 'b (3.0) should still beat c (2.0) after normalization');
    assert.ok(cScore > aScore, 'c (2.0) should still beat a (1.0) after normalization');
  });
});

describe('selectBlocks', () => {
  it('skips blocks with attention below threshold', () => {
    const blockScores = [5.0, 0.01, 0.01, 0.01];
    const selected = selectBlocks(blockScores, 0.05);

    assert.ok(selected.includes(0), 'high-scoring block should be selected');
    assert.ok(selected.length < 4, 'low-scoring blocks should be skipped');
  });

  it('selects all blocks when scores are equal', () => {
    const blockScores = [1.0, 1.0, 1.0, 1.0];
    const selected = selectBlocks(blockScores, 0.05);

    assert.equal(selected.length, 4, 'all equal blocks should be selected (each gets 0.25)');
  });

  it('returns all for all-zero scores', () => {
    const blockScores = [0, 0, 0, 0];
    const selected = selectBlocks(blockScores, 0.05);

    assert.equal(selected.length, 4, 'all-zero should produce equal attention above threshold');
  });
});
