import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SearchFusion } from '../../../plugins/search/fusion.js';
import type { SearchPlugin, SearchResult } from '../../../core/types.js';

function makeResult(id: string, type: SearchResult['type'], score: number): SearchResult {
  return { id, title: `Title ${id}`, snippet: `Snippet ${id}`, relevance_score: score, type, timestamp: Date.now() };
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
});
