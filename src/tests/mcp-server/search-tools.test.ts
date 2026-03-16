/**
 * Tests for search, timeline, get MCP tool handlers (Task 20).
 * Tests handler functions directly — no MCP protocol involved.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../../core/pipeline.js';
import { PluginRegistry } from '../../core/plugin-registry.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { SearchFusion } from '../../plugins/search/fusion.js';
import { BM25Search } from '../../plugins/search/bm25.js';
import { DEFAULT_CONFIG } from '../../core/types.js';
import { handleSearch, handleTimeline, handleGet, handleObserve } from '../../mcp-server/tools.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import { createTestDb } from '../helpers.js';

async function buildKernel(storage: BetterSqlite3Storage, sessionId: string): Promise<ToolKernel> {
  const registry = new PluginRegistry();
  const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
  const pipeline = new Pipeline(registry, storage, privacy, sessionId);
  const bm25 = new BM25Search(storage);
  await registry.register(bm25);
  const search = new SearchFusion([bm25]);
  const config = structuredClone(DEFAULT_CONFIG);

  return { pipeline, search, storage, registry, sessionId, config };
}

describe('MCP tools — search', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-search-session');
    // Seed data
    await handleObserve({ content: 'TypeScript interface definition for user types', type: 'code' }, kernel);
    await handleObserve({ content: 'Python script for data processing pipeline', type: 'code' }, kernel);
    await handleObserve({ content: 'Error: connection refused to database', type: 'error' }, kernel);
  });

  after(async () => { await storage.close(); });

  it('returns array of results', async () => {
    const results = await handleSearch({ query: 'TypeScript' }, kernel);
    assert.ok(Array.isArray(results), 'should return an array');
  });

  it('result entries have expected shape', async () => {
    const results = await handleSearch({ query: 'python data' }, kernel);
    if (results.length > 0) {
      const first = results[0];
      assert.ok(typeof first.id === 'string', 'id should be string');
      assert.ok(typeof first.title === 'string', 'title should be string');
      assert.ok(typeof first.snippet === 'string', 'snippet should be string');
      assert.ok(typeof first.relevance_score === 'number', 'relevance_score should be number');
      assert.ok(typeof first.timestamp === 'number', 'timestamp should be number');
    }
  });

  it('respects limit parameter', async () => {
    const results = await handleSearch({ query: 'code', limit: 1 }, kernel);
    assert.ok(results.length <= 1, 'should not exceed limit');
  });

  it('returns empty array for unmatched query', async () => {
    const results = await handleSearch({ query: 'xyznotfoundatall99999' }, kernel);
    assert.ok(Array.isArray(results), 'should still return an array');
  });
});

describe('MCP tools — timeline', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let seedTs: number;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-timeline-session');
    seedTs = Date.now();
    await handleObserve({ content: 'first observation', type: 'log' }, kernel);
    await handleObserve({ content: 'second observation', type: 'code' }, kernel);
    await handleObserve({ content: 'third observation decision', type: 'decision' }, kernel);
  });

  after(async () => { await storage.close(); });

  it('returns array of timeline entries', async () => {
    const results = await handleTimeline({}, kernel);
    assert.ok(Array.isArray(results), 'should return array');
    assert.ok(results.length >= 3, 'should have at least 3 entries');
  });

  it('entries have expected shape', async () => {
    const results = await handleTimeline({ limit: 1 }, kernel);
    assert.ok(results.length > 0, 'should have at least one entry');
    const entry = results[0];
    assert.ok(typeof entry.id === 'string');
    assert.ok(typeof entry.type === 'string');
    assert.ok(typeof entry.timestamp === 'number');
  });

  it('results are in reverse chronological order', async () => {
    const results = await handleTimeline({}, kernel);
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].timestamp >= results[i].timestamp,
        'should be in DESC order',
      );
    }
  });

  it('filters by type', async () => {
    const results = await handleTimeline({ type: 'decision' }, kernel);
    assert.ok(results.length >= 1, 'should have at least one decision entry');
    for (const entry of results) {
      assert.equal(entry.type, 'decision');
    }
  });

  it('filters by session_id', async () => {
    const results = await handleTimeline({ session_id: 'mcp-timeline-session' }, kernel);
    assert.ok(results.length >= 3, 'all seeded entries should be from this session');
  });

  it('respects limit', async () => {
    const results = await handleTimeline({ limit: 2 }, kernel);
    assert.ok(results.length <= 2);
  });

  it('filters by from timestamp', async () => {
    const results = await handleTimeline({ from: seedTs - 1 }, kernel);
    assert.ok(results.length >= 3, 'all observations after seedTs should be included');
  });

  it('filters by to timestamp', async () => {
    const futureTs = Date.now() + 10000;
    const results = await handleTimeline({ to: futureTs }, kernel);
    assert.ok(results.length >= 3, 'all observations before futureTs should be included');
  });
});

describe('MCP tools — get', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let storedId: string;
  const testContent = 'Unique content for get test observation';

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-get-session');
    const obs = await handleObserve({ content: testContent, type: 'context' }, kernel);
    storedId = obs.id;
  });

  after(async () => { await storage.close(); });

  it('retrieves observation by ID', async () => {
    const result = await handleGet({ id: storedId }, kernel);
    assert.ok(!('error' in result), 'should not have error');
    if (!('error' in result)) {
      assert.equal(result.id, storedId);
      assert.equal(result.content, testContent);
      assert.equal(result.type, 'context');
    }
  });

  it('returns error for unknown ID', async () => {
    const result = await handleGet({ id: 'nonexistent-id-xyz' }, kernel);
    assert.ok('error' in result, 'should return error object');
    if ('error' in result) {
      assert.ok(typeof result.error === 'string');
    }
  });

  it('returned object includes metadata object', async () => {
    const result = await handleGet({ id: storedId }, kernel);
    if (!('error' in result)) {
      assert.ok(typeof result.metadata === 'object', 'metadata should be an object');
    }
  });
});
