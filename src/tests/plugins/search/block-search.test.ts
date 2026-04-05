import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { softmax, normalizeBlock, selectBlocks } from '../../../plugins/search/block-selector.js';
import { BlockSearchOrchestrator } from '../../../plugins/search/fusion.js';
import type { SearchResult } from '../../../core/types.js';
import type { SearchPlugin, SearchOpts } from '../../../core/types.js';

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

function mockBlockPlugin(
  name: string,
  results: SearchResult[],
): SearchPlugin {
  return {
    name,
    version: '1.0.0',
    type: 'search' as const,
    strategy: 'bm25' as const,
    priority: 1,
    init: async () => {},
    destroy: async () => {},
    search: async () => results,
    shouldFallback: () => false,
  };
}

describe('BlockSearchOrchestrator', () => {
  it('merges results from multiple blocks with attention weighting', async () => {
    const now = Date.now();
    const sessionResults = [makeResult('s1', 2.0, now)];
    const projectResults = [makeResult('p1', 1.0, now - 86400000)];

    const orchestrator = new BlockSearchOrchestrator({
      session: [mockBlockPlugin('bm25', sessionResults)],
      project: [mockBlockPlugin('bm25', projectResults)],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    const results = await orchestrator.execute('test query', { limit: 10 });

    assert.ok(results.length >= 2, 'should return results from multiple blocks');
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('s1'), 'should include session result');
    assert.ok(ids.includes('p1'), 'should include project result');
  });

  it('skips blocks with no relevant results', async () => {
    const sessionResults = [makeResult('s1', 3.0)];

    const orchestrator = new BlockSearchOrchestrator({
      session: [mockBlockPlugin('bm25', sessionResults)],
      project: [mockBlockPlugin('bm25', [])],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    const results = await orchestrator.execute('test query', { limit: 10 });

    assert.ok(results.length >= 1, 'should return at least session results');
    assert.equal(results[0].id, 's1');
  });

  it('normalizes scores so large block does not overwhelm small block', async () => {
    const sessionResults = [makeResult('s1', 1.0)];
    const projectResults = [
      makeResult('p1', 10.0),
      makeResult('p2', 8.0),
      makeResult('p3', 5.0),
    ];

    const orchestrator = new BlockSearchOrchestrator({
      session: [mockBlockPlugin('bm25', sessionResults)],
      project: [mockBlockPlugin('bm25', projectResults)],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    const results = await orchestrator.execute('test query', { limit: 10 });

    const s1 = results.find(r => r.id === 's1');
    assert.ok(s1, 'session result should be present');
    assert.ok(s1!.relevance_score > 0, 'session result should have positive score');
  });
});

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

describe('full pipeline integration', () => {
  it('block search + adaptive reranking produces correct ordering for causal query', async () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Session: recent error
    const sessionPlugin = mockBlockPlugin('bm25', [
      makeResult('recent-error', 1.0, now),
    ]);

    // Project: old but highly relevant pattern
    const projectPlugin = mockBlockPlugin('bm25', [
      makeResult('old-pattern', 3.0, now - 30 * DAY_MS),
    ]);

    const orchestrator = new BlockSearchOrchestrator({
      session: [sessionPlugin],
      project: [projectPlugin],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    // "why" triggers causal intent → recency favored
    const results = await orchestrator.execute('why authentication failed', { limit: 10 });

    assert.ok(results.length >= 2, 'should return results from both blocks');
    // With causal intent, the recent error should rank higher despite lower base relevance
    assert.equal(results[0].id, 'recent-error', 'causal query should prioritize recent session error');
  });

  it('block search + adaptive reranking produces correct ordering for lookup query', async () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Session: recent but low relevance
    const sessionPlugin = mockBlockPlugin('bm25', [
      makeResult('recent-mention', 0.5, now),
    ]);

    // Project: old but highly relevant
    const projectPlugin = mockBlockPlugin('bm25', [
      makeResult('authoritative-doc', 3.0, now - 30 * DAY_MS),
    ]);

    const orchestrator = new BlockSearchOrchestrator({
      session: [sessionPlugin],
      project: [projectPlugin],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    // "how" triggers lookup intent → relevance favored
    const results = await orchestrator.execute('how does authentication work', { limit: 10 });

    assert.ok(results.length >= 2, 'should return results from both blocks');
    assert.equal(results[0].id, 'authoritative-doc', 'lookup query should prioritize high-relevance project knowledge');
  });
});
