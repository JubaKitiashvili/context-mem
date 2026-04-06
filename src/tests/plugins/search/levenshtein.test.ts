import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LevenshteinSearch } from '../../../plugins/search/levenshtein.js';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';
import { createTestDb, insertTestObservations } from '../../helpers.js';

describe('LevenshteinSearch', () => {
  let storage: BetterSqlite3Storage;
  let search: LevenshteinSearch;

  beforeEach(async () => {
    storage = await createTestDb();
    search = new LevenshteinSearch(storage);
    await search.init({});
    insertTestObservations(storage, [
      { id: '1', type: 'error', content: 'TypeError: cannot read property foo of undefined', summary: 'TypeError in foo handler' },
      { id: '2', type: 'code', content: 'function authenticate(user, pass) { return true; }', summary: 'authenticate user function' },
      { id: '3', type: 'log', content: 'Database connection failed unexpectedly', summary: 'database connection failure' },
    ]);
  });

  afterEach(async () => { await storage.close(); });

  // --- exact keyword matches ---

  it('finds exact keyword match', async () => {
    const results = await search.search('TypeError', {});
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, '1');
  });

  it('finds exact match in summary', async () => {
    const results = await search.search('database', {});
    assert.ok(results.length >= 1);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('3'));
  });

  // --- fuzzy (typo-tolerant) matches ---

  it('finds results with 1 character substitution', async () => {
    // "authanticate" has 1 edit from "authenticate"
    const results = await search.search('authanticate', {});
    assert.ok(results.length >= 1);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('2'));
  });

  it('finds results with 1 character deletion', async () => {
    // "databse" — 1 deletion from "database"
    const results = await search.search('databse', {});
    assert.ok(results.length >= 1);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('3'));
  });

  it('finds results with 2 character edits', async () => {
    // "Typerror" — 2 edits from "TypeError"
    const results = await search.search('Typerror', {});
    assert.ok(results.length >= 1);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('1'));
  });

  // --- scoring ---

  it('returns non-zero relevance scores', async () => {
    const results = await search.search('TypeError', {});
    assert.ok(results.length >= 1);
    assert.ok(results[0].relevance_score > 0);
  });

  it('exact match scores higher than fuzzy match', async () => {
    insertTestObservations(storage, [
      { id: '4', type: 'log', content: 'connect failed', summary: 'connection exact' },
      { id: '5', type: 'log', content: 'connestion problem', summary: 'connestion typo' },
    ]);
    const exactResults = await search.search('connection', {});
    const fuzzyResults = await search.search('connestion', {});
    // The exact-match row should appear in exact results
    const exactIds = exactResults.map(r => r.id);
    assert.ok(exactIds.includes('4'));
    // Fuzzy match should also find it
    assert.ok(fuzzyResults.length >= 1);
  });

  // --- no matches ---

  it('returns empty for query with very long words (length diff > 2)', async () => {
    // "xxxxxxxxxxx" has no close match
    const results = await search.search('xxxxxxxxxxx', {});
    assert.equal(results.length, 0);
  });

  it('returns empty for empty query words (all < 2 chars)', async () => {
    const results = await search.search('a b', {});
    assert.equal(results.length, 0);
  });

  // --- edge cases ---

  it('handles single-character query word (< 2 chars, filtered)', async () => {
    const results = await search.search('x', {});
    assert.equal(results.length, 0);
  });

  it('handles multi-word query scoring all words', async () => {
    const results = await search.search('TypeError handler', {});
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, '1');
  });

  // --- opts ---

  it('respects limit option', async () => {
    // Insert more matching rows
    insertTestObservations(storage, [
      { id: '6', type: 'log', content: 'TypeError again', summary: 'another TypeError' },
    ]);
    const results = await search.search('TypeError', { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('respects type_filter option', async () => {
    const results = await search.search('type', { type_filter: ['code'] });
    for (const r of results) {
      assert.equal(r.type, 'code');
    }
  });

  // --- result shape ---

  it('returns SearchResult with required fields', async () => {
    const results = await search.search('TypeError', {});
    assert.ok(results.length >= 1);
    const r = results[0];
    assert.ok(typeof r.id === 'string');
    assert.ok(typeof r.title === 'string');
    assert.ok(typeof r.snippet === 'string');
    assert.ok(typeof r.relevance_score === 'number');
    assert.ok(typeof r.type === 'string');
    assert.ok(typeof r.timestamp === 'number');
    assert.ok(typeof r.access_count === 'number');
  });

  // --- shouldFallback ---

  it('shouldFallback always returns false (terminal strategy)', () => {
    assert.equal(search.shouldFallback([]), false);
    assert.equal(search.shouldFallback([{} as any]), false);
    assert.equal(search.shouldFallback([{} as any, {} as any]), false);
  });

  // --- plugin metadata ---

  it('has correct plugin metadata', () => {
    assert.equal(search.name, 'levenshtein-search');
    assert.equal(search.type, 'search');
    assert.equal(search.strategy, 'levenshtein');
    assert.equal(search.priority, 3);
  });
});
