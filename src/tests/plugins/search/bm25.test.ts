import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Search } from '../../../plugins/search/bm25.js';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';
import { createTestDb, insertTestObservations } from '../../helpers.js';

describe('BM25Search', () => {
  let storage: BetterSqlite3Storage;
  let search: BM25Search;

  beforeEach(async () => {
    storage = await createTestDb();
    search = new BM25Search(storage);
    await search.init({});
    insertTestObservations(storage, [
      { id: '1', type: 'error', content: 'TypeError: cannot read property foo of undefined', summary: 'TypeError in foo handler' },
      { id: '2', type: 'code', content: 'function authenticate(user, pass) { return true; }', summary: 'authenticate function' },
      { id: '3', type: 'log', content: 'Authentication failed for user admin', summary: 'auth failure log' },
    ]);
  });

  afterEach(async () => { await storage.close(); });

  it('finds results by keyword', async () => {
    const results = await search.search('TypeError', {});
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, '1');
  });

  it('ranks by relevance', async () => {
    const results = await search.search('authenticate', {});
    assert.ok(results.length >= 1);
    assert.ok(results[0].relevance_score > 0);
  });

  it('returns empty for no matches', async () => {
    const results = await search.search('zzzznonexistent', {});
    assert.equal(results.length, 0);
  });

  it('respects type filter', async () => {
    const results = await search.search('auth', { type_filter: ['error'] });
    for (const r of results) {
      assert.equal(r.type, 'error');
    }
  });

  it('shouldFallback returns true for < 3 results', () => {
    assert.equal(search.shouldFallback([]), true);
    assert.equal(search.shouldFallback([{} as any, {} as any]), true);
    assert.equal(search.shouldFallback([{} as any, {} as any, {} as any]), false);
  });
});
