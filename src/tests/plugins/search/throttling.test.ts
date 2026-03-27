import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SearchFusion } from '../../../plugins/search/fusion.js';
import type { SearchPlugin, SearchResult, SearchOpts, PluginConfig } from '../../../core/types.js';

const makeMockPlugin = (results: SearchResult[]): SearchPlugin => ({
  name: 'mock-search',
  version: '1.0.0',
  type: 'search',
  strategy: 'bm25',
  priority: 1,
  async init(_config: PluginConfig) {},
  async destroy() {},
  async search(_query: string, _opts: SearchOpts): Promise<SearchResult[]> {
    return results;
  },
  shouldFallback(_results: SearchResult[]): boolean {
    return false;
  },
});

const makeResult = (id: string, score: number): SearchResult => ({
  id,
  title: `Result ${id}`,
  snippet: `Snippet for ${id}`,
  relevance_score: score,
  type: 'code',
  timestamp: Date.now(),
});

describe('SearchFusion throttling', () => {
  let fusion: SearchFusion;
  const mockResults = [
    makeResult('r1', 0.9),
    makeResult('r2', 0.8),
    makeResult('r3', 0.7),
  ];
  const opts: SearchOpts = { limit: 5 };

  beforeEach(() => {
    fusion = new SearchFusion([makeMockPlugin(mockResults)]);
  });

  it('first 3 searches return full results', async () => {
    for (let i = 0; i < 3; i++) {
      const results = await fusion.execute('test query', opts);
      assert.strictEqual(results.length, 3, `search ${i + 1} should return 3 results`);
      assert.ok(results.every(r => !r.id.startsWith('__')), 'no synthetic results');
    }
  });

  it('searches 4-8 return 1 result + warning', async () => {
    // Exhaust the first 3 full searches
    for (let i = 0; i < 3; i++) {
      await fusion.execute('test query', opts);
    }

    // Searches 4 through 8 should be limited
    for (let i = 4; i <= 8; i++) {
      const results = await fusion.execute('test query', opts);
      assert.strictEqual(results.length, 2, `search ${i} should return 2 entries (1 result + warning)`);
      assert.strictEqual(results[0].id, 'r1', 'first result is top-scored');
      assert.strictEqual(results[1].id, '__throttle_warning__', 'second is throttle warning');
      assert.strictEqual(results[1].type, 'context', 'warning type is context');
    }
  });

  it('search 9+ returns blocked message', async () => {
    // Exhaust 8 searches
    for (let i = 0; i < 8; i++) {
      await fusion.execute('test query', opts);
    }

    // Search 9 should be blocked
    const results = await fusion.execute('test query', opts);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, '__throttled__');
    assert.strictEqual(results[0].title, 'Search throttled');
    assert.strictEqual(results[0].type, 'context');
  });

  it('window resets after timeout', async () => {
    // Exhaust 8 searches so next would be blocked
    for (let i = 0; i < 8; i++) {
      await fusion.execute('test query', opts);
    }

    // Simulate window expiry by reaching into private state
    (fusion as any).searchWindowStart = Date.now() - 61_000;

    // After window expires, counter should reset — full results again
    const results = await fusion.execute('test query', opts);
    assert.strictEqual(results.length, 3, 'full results after window expires');
    assert.ok(results.every(r => !r.id.startsWith('__')), 'no synthetic results after window reset');
  });

  it('resetThrottle clears counter', async () => {
    // Use up all searches
    for (let i = 0; i < 9; i++) {
      await fusion.execute('test query', opts);
    }

    // Verify blocked
    let results = await fusion.execute('test query', opts);
    assert.strictEqual(results[0].id, '__throttled__');

    // Reset and verify full results again
    fusion.resetThrottle();
    results = await fusion.execute('test query', opts);
    assert.strictEqual(results.length, 3);
    assert.ok(results.every(r => !r.id.startsWith('__')), 'full results after reset');
  });
});
