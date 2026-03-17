import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TrigramSearch } from '../../../plugins/search/trigram.js';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';
import { createTestDb, insertTestObservations } from '../../helpers.js';

describe('TrigramSearch', () => {
  let storage: BetterSqlite3Storage;
  let search: TrigramSearch;

  beforeEach(async () => {
    storage = await createTestDb();
    search = new TrigramSearch(storage);
    await search.init({});
    insertTestObservations(storage, [
      { id: '1', type: 'error', content: 'authentication middleware failed with status 401', summary: 'auth middleware error' },
      { id: '2', type: 'code', content: 'function validateToken(token) { return jwt.verify(token); }', summary: 'token validation function' },
      { id: '3', type: 'log', content: 'database connection pool exhausted', summary: 'db pool error log' },
    ]);
  });

  afterEach(async () => { await storage.close(); });

  it('finds substring matches', async () => {
    // Trigram index only covers the summary column
    const results = await search.search('iddleware', {});
    assert.ok(results.length >= 1);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('1'));
  });

  it('finds results BM25 would miss', async () => {
    // "alidati" is not a full word — BM25 porter tokenizer won't match it,
    // but trigram can find it as a substring in the summary
    const results = await search.search('alidati', {});
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, '2');
  });

  it('returns empty for no matches', async () => {
    const results = await search.search('zzznomatch', {});
    assert.equal(results.length, 0);
  });

  it('shouldFallback returns true only when no results found', () => {
    assert.equal(search.shouldFallback([]), true);
    assert.equal(search.shouldFallback([{} as any, {} as any]), false);
    assert.equal(search.shouldFallback([{} as any, {} as any, {} as any]), false);
  });

  it('respects type filter', async () => {
    const results = await search.search('auth', { type_filter: ['error'] });
    for (const r of results) {
      assert.equal(r.type, 'error');
    }
  });
});
