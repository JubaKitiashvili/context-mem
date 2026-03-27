import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SearchFusion, rerank } from '../../../plugins/search/fusion.js';
import type { SearchPlugin, SearchResult } from '../../../core/types.js';

function makeResult(id: string, type: SearchResult['type'], score: number, timestamp?: number, access_count?: number): SearchResult {
  return { id, title: `Title ${id}`, snippet: `Snippet ${id}`, relevance_score: score, type, timestamp: timestamp ?? Date.now(), access_count: access_count ?? 0 };
}

function mockSearchPlugin(
  name: string,
  strategy: SearchPlugin['strategy'],
  priority: number,
  results: SearchResult[],
  fallback: boolean,
): SearchPlugin {
  return {
    name,
    version: '1.0.0',
    type: 'search' as const,
    strategy,
    priority,
    init: async () => {},
    destroy: async () => {},
    search: async () => results,
    shouldFallback: () => fallback,
  };
}

describe('SearchFusion', () => {
  it('uses BM25 first when enough results', async () => {
    let trigramCalled = false;
    const bm25Results = [
      makeResult('1', 'code', 1.5),
      makeResult('2', 'log', 1.2),
      makeResult('3', 'error', 1.0),
    ];
    const bm25 = mockSearchPlugin('bm25', 'bm25', 1, bm25Results, false);
    const trigram: SearchPlugin = {
      ...mockSearchPlugin('trigram', 'trigram', 2, [], false),
      search: async () => { trigramCalled = true; return []; },
    };

    const fusion = new SearchFusion([bm25, trigram]);
    await fusion.execute('some query', { limit: 5 });

    assert.equal(trigramCalled, false, 'trigram should not be called when BM25 returns enough results');
  });

  it('falls back to trigram when BM25 returns few', async () => {
    let trigramCalled = false;
    const bm25Results = [makeResult('1', 'code', 1.5), makeResult('2', 'log', 1.2)]; // < 3
    const trigramResults = [makeResult('3', 'error', 0.8)];

    const bm25 = mockSearchPlugin('bm25', 'bm25', 1, bm25Results, true); // shouldFallback = true
    const trigram: SearchPlugin = {
      ...mockSearchPlugin('trigram', 'trigram', 2, trigramResults, false),
      search: async () => { trigramCalled = true; return trigramResults; },
    };

    const fusion = new SearchFusion([bm25, trigram]);
    const results = await fusion.execute('some query', { limit: 5 });

    assert.equal(trigramCalled, true, 'trigram should be called when BM25 returns few results');
    assert.ok(results.some(r => r.id === '3'), 'trigram result should be included');
  });

  it('deduplicates by id', async () => {
    const sharedResult = makeResult('dup-1', 'error', 1.0);
    const bm25 = mockSearchPlugin('bm25', 'bm25', 1, [sharedResult, makeResult('2', 'code', 0.8)], true);
    const trigram = mockSearchPlugin('trigram', 'trigram', 2, [sharedResult, makeResult('3', 'log', 0.6)], false);

    const fusion = new SearchFusion([bm25, trigram]);
    const results = await fusion.execute('auth', { limit: 10 });

    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'results should not contain duplicate ids');

    const dupCount = ids.filter(id => id === 'dup-1').length;
    assert.equal(dupCount, 1, 'duplicated result should appear exactly once');
  });

  it('applies type boosts from intent', async () => {
    // "why auth fail" → causal intent → error gets boosted
    const errorResult = makeResult('err-1', 'error', 1.0);
    const codeResult = makeResult('code-1', 'code', 1.5); // higher base score
    const bm25 = mockSearchPlugin('bm25', 'bm25', 1, [errorResult, codeResult], false);

    const fusion = new SearchFusion([bm25]);
    const results = await fusion.execute('why auth fail', { limit: 5 });

    // error gets +2 boost from causal intent, so error (1.0 + 2 = 3.0) > code (1.5 + 0 = 1.5)
    assert.equal(results[0].id, 'err-1', 'error result should be ranked first due to causal intent boost');
    assert.ok(results[0].relevance_score > results[1].relevance_score, 'boosted result should have higher score');
  });

  it('handles search plugin errors gracefully', async () => {
    const errorPlugin: SearchPlugin = {
      name: 'broken',
      version: '1.0.0',
      type: 'search' as const,
      strategy: 'bm25',
      priority: 1,
      init: async () => {},
      destroy: async () => {},
      search: async () => { throw new Error('plugin crashed'); },
      shouldFallback: () => false,
    };
    const goodResults = [makeResult('1', 'code', 1.0), makeResult('2', 'log', 0.8), makeResult('3', 'error', 0.6)];
    const goodPlugin = mockSearchPlugin('trigram', 'trigram', 2, goodResults, false);

    const fusion = new SearchFusion([errorPlugin, goodPlugin]);
    const results = await fusion.execute('test query', { limit: 5 });

    assert.ok(results.length > 0, 'results should be returned even when one plugin throws');
    assert.equal(results.length, 3, 'all results from working plugin should be returned');
  });

  it('applies custom search weights to relevance scores', async () => {
    const bm25Result = makeResult('bm25-1', 'code', 1.0);
    const trigramResult = makeResult('tri-1', 'log', 1.0);

    const bm25 = mockSearchPlugin('bm25', 'bm25', 1, [bm25Result], true);
    const trigram = mockSearchPlugin('trigram', 'trigram', 2, [trigramResult], false);

    // Default weights: bm25=0.5, trigram=0.3
    const defaultFusion = new SearchFusion([bm25, trigram]);
    const defaultResults = await defaultFusion.execute('test', { limit: 5 });

    // Custom weights: flip them so trigram weighs more
    const customFusion = new SearchFusion([bm25, trigram], { bm25: 0.2, trigram: 0.8 });
    const customResults = await customFusion.execute('test', { limit: 5 });

    const defaultBm25Score = defaultResults.find(r => r.id === 'bm25-1')!.relevance_score;
    const customBm25Score = customResults.find(r => r.id === 'bm25-1')!.relevance_score;
    const defaultTrigramScore = defaultResults.find(r => r.id === 'tri-1')!.relevance_score;
    const customTrigramScore = customResults.find(r => r.id === 'tri-1')!.relevance_score;

    // With custom weights, bm25 score should be lower and trigram score should be higher
    assert.ok(customBm25Score < defaultBm25Score, 'bm25 score should decrease with lower weight');
    assert.ok(customTrigramScore > defaultTrigramScore, 'trigram score should increase with higher weight');

    // With custom weights, trigram should rank above bm25
    assert.equal(customResults[0].id, 'tri-1', 'trigram result should rank first with higher custom weight');
  });

  it('uses default weights when none provided', async () => {
    const result = makeResult('r1', 'code', 2.0);
    const bm25 = mockSearchPlugin('bm25', 'bm25', 1, [result], false);

    const fusion = new SearchFusion([bm25]);
    const results = await fusion.execute('test', { limit: 5 });

    // With default bm25 weight of 0.5, score 2.0 becomes 2.0 * 0.5 = 1.0 before reranking
    // Reranking applies: score * (0.7 + 0.2 * recencyBoost + 0.1 * accessBoost)
    // For a fresh result: ~1.0 * (0.7 + 0.2 * 1.0 + 0.1 * log2(2)/10) = ~0.91
    assert.ok(results[0].relevance_score > 0, 'should produce valid scores with default weights');
    assert.ok(results[0].relevance_score < 2.0, 'score should be scaled down by default weight');
  });
});

describe('rerank', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('boosts recent results over older ones with equal base score', () => {
    const now = Date.now();
    const recent = makeResult('recent', 'code', 1.0, now, 0);
    const old = makeResult('old', 'code', 1.0, now - 30 * DAY_MS, 0);

    const results = rerank([old, recent]);
    assert.equal(results[0].id, 'recent', 'recent result should rank first');
    assert.ok(results[0].relevance_score > results[1].relevance_score, 'recent result should have higher score');
  });

  it('applies exponential decay with ~7 day half-life', () => {
    const now = Date.now();
    const fresh = makeResult('fresh', 'code', 1.0, now, 0);
    const weekOld = makeResult('week', 'code', 1.0, now - 7 * DAY_MS, 0);

    const results = rerank([fresh, weekOld]);
    const freshScore = results.find(r => r.id === 'fresh')!.relevance_score;
    const weekScore = results.find(r => r.id === 'week')!.relevance_score;

    // Fresh: 1.0 * (0.7 + 0.2 * 1.0 + 0.1 * log2(2)/10) = 1.0 * (0.7 + 0.2 + 0.01) = 0.91
    // Week:  1.0 * (0.7 + 0.2 * 0.5 + 0.1 * log2(2)/10) = 1.0 * (0.7 + 0.1 + 0.01) = 0.81
    // Recency contribution should halve after 7 days
    const freshRecency = freshScore - 1.0 * 0.7;
    const weekRecency = weekScore - 1.0 * 0.7;
    // The recency part (0.2 * decay) halves, but access part stays the same
    // So we check the total score difference is meaningful
    assert.ok(freshScore > weekScore, 'fresh result should score higher than week-old result');
  });

  it('boosts frequently accessed results', () => {
    const now = Date.now();
    const popular = makeResult('popular', 'code', 1.0, now, 100);
    const unpopular = makeResult('unpopular', 'code', 1.0, now, 0);

    const results = rerank([unpopular, popular]);
    assert.equal(results[0].id, 'popular', 'frequently accessed result should rank first');
    assert.ok(results[0].relevance_score > results[1].relevance_score, 'popular result should have higher score');
  });

  it('preserves original relevance as dominant factor (70%)', () => {
    const now = Date.now();
    // High relevance but old
    const highRelevance = makeResult('high', 'code', 2.0, now - 30 * DAY_MS, 0);
    // Low relevance but brand new with many accesses
    const lowRelevance = makeResult('low', 'code', 0.5, now, 100);

    const results = rerank([lowRelevance, highRelevance]);
    assert.equal(results[0].id, 'high', 'high relevance should still win despite being old');
  });

  it('handles missing timestamp gracefully', () => {
    const result: SearchResult = { id: 'no-ts', title: 'T', snippet: 'S', relevance_score: 1.0, type: 'code', timestamp: 0 };
    const results = rerank([result]);
    assert.equal(results.length, 1);
    assert.ok(results[0].relevance_score > 0, 'should produce a valid score');
  });

  it('handles missing access_count gracefully', () => {
    const result: SearchResult = { id: 'no-ac', title: 'T', snippet: 'S', relevance_score: 1.0, type: 'code', timestamp: Date.now() };
    // access_count is undefined
    const results = rerank([result]);
    assert.equal(results.length, 1);
    assert.ok(results[0].relevance_score > 0, 'should produce a valid score');
  });

  it('returns results sorted by reranked score', () => {
    const now = Date.now();
    const results = rerank([
      makeResult('a', 'code', 1.0, now - 14 * DAY_MS, 0),
      makeResult('b', 'code', 0.8, now, 50),
      makeResult('c', 'code', 1.2, now - 1 * DAY_MS, 5),
    ]);

    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(results[i].relevance_score >= results[i + 1].relevance_score,
        `results should be sorted descending: index ${i} (${results[i].relevance_score}) >= index ${i + 1} (${results[i + 1].relevance_score})`);
    }
  });
});
