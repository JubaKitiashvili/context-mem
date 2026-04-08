/**
 * Tests for observe and summarize MCP tool handlers (Task 19).
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
import { handleObserve, handleSummarize, handleRecall } from '../../mcp-server/tools.js';
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

  const { BudgetManager } = await import('../../core/budget.js');
  const { EventTracker } = await import('../../core/events.js');
  const { SessionManager } = await import('../../core/session.js');
  const { ContentStore } = await import('../../plugins/storage/content-store.js');
  const { KnowledgeBase } = await import('../../plugins/knowledge/knowledge-base.js');
  const budgetManager = new BudgetManager(storage);
  const eventTracker = new EventTracker(storage);
  const sessionManager = new SessionManager(storage, eventTracker);
  const contentStore = new ContentStore(storage);
  const knowledgeBase = new KnowledgeBase(storage);

  return { pipeline, search, storage, registry, sessionId, config, projectDir: '/tmp/test-project', budgetManager, eventTracker, sessionManager, contentStore, knowledgeBase };
}

describe('MCP tools — observe', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-test-session-1');
  });

  after(async () => { await storage.close(); });

  it('returns id, summary and tokens_saved', async () => {
    const result = await handleObserve({ content: 'Hello from MCP observe test' }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    assert.ok(typeof result.id === 'string', 'id should be a string');
    assert.ok(result.id.length > 0, 'id should be non-empty');
    assert.ok(typeof result.tokens_saved === 'number', 'tokens_saved should be a number');
    assert.ok(result.tokens_saved >= 0, 'tokens_saved should be non-negative');
  });

  it('stores observation in DB', async () => {
    const content = 'MCP observe stores in DB';
    const result = await handleObserve({ content }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    const row = storage.prepare('SELECT content FROM observations WHERE id = ?').get(result.id) as { content: string } | undefined;
    assert.ok(row, 'row should exist in DB');
    assert.equal(row.content, content);
  });

  it('uses provided type and source', async () => {
    const result = await handleObserve({ content: 'typed observe', type: 'error', source: 'test-runner' }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    const row = storage.prepare('SELECT type FROM observations WHERE id = ?').get(result.id) as { type: string } | undefined;
    assert.equal(row?.type, 'error');
  });

  it('defaults type to context when not provided', async () => {
    const result = await handleObserve({ content: 'default type test' }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    const row = storage.prepare('SELECT type FROM observations WHERE id = ?').get(result.id) as { type: string } | undefined;
    assert.equal(row?.type, 'context');
  });

  it('tokens_saved is zero when no summarizer ran', async () => {
    const result = await handleObserve({ content: 'short' }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    // No summarizer in registry that matches "short" text
    assert.equal(result.tokens_saved, 0);
  });
});

describe('MCP tools — summarize', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-test-session-2');
  });

  after(async () => { await storage.close(); });

  it('returns summary with token counts when no summarizer matches', async () => {
    const content = 'Plain text that no summarizer will match.';
    const result = await handleSummarize({ content }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    assert.equal(result.summary, content, 'should return raw content as summary');
    assert.ok(typeof result.tokens_original === 'number');
    assert.ok(typeof result.tokens_summarized === 'number');
    assert.equal(result.savings_pct, 0);
  });

  it('returns savings_pct >= 0', async () => {
    const result = await handleSummarize({ content: 'another test' }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    assert.ok(result.savings_pct >= 0, 'savings_pct should be non-negative');
  });

  it('tokens_original equals tokens_summarized when no savings', async () => {
    const result = await handleSummarize({ content: 'no savings here' }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    if ('error' in result) return;
    assert.equal(result.tokens_original, result.tokens_summarized);
  });
});

describe('MCP tools — recall', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-recall-session');
    // Seed observations with varied importance
    await handleObserve({ content: 'We decided to use PostgreSQL for the database layer', type: 'decision' }, kernel);
    await handleObserve({ content: 'Deployed the authentication service to production', type: 'context' }, kernel);
    await handleObserve({ content: 'Simple debug log entry nothing special', type: 'log' }, kernel);
    await handleObserve({ content: 'Critical vulnerability found in auth module', type: 'error' }, kernel);
  });

  after(async () => { await storage.close(); });

  it('returns verbatim content for matching query', async () => {
    const results = await handleRecall({ query: 'PostgreSQL' }, kernel);
    assert.ok(!('error' in results));
    assert.ok(Array.isArray(results));
    if (Array.isArray(results) && results.length > 0) {
      assert.ok(results[0].content.includes('PostgreSQL'), 'should return original verbatim content');
      assert.ok(results[0].importance_score > 0, 'should have importance_score');
      assert.ok(results[0].compression_tier === 'verbatim', 'new observations should be verbatim tier');
    }
  });

  it('importance_min filter works', async () => {
    const results = await handleRecall({ query: 'auth', filters: { importance_min: 0.7 } }, kernel);
    assert.ok(Array.isArray(results));
    if (Array.isArray(results)) {
      for (const r of results) {
        assert.ok(r.importance_score >= 0.7, `expected >= 0.7, got ${r.importance_score}`);
      }
    }
  });

  it('flags filter works', async () => {
    const results = await handleRecall({ query: 'decided PostgreSQL', filters: { flags: ['DECISION'] } }, kernel);
    assert.ok(Array.isArray(results));
    if (Array.isArray(results) && results.length > 0) {
      assert.ok(results[0].flags.includes('DECISION'), 'should have DECISION flag');
    }
  });

  it('type filter works', async () => {
    const results = await handleRecall({ query: 'auth vulnerability', filters: { type: 'error' } }, kernel);
    assert.ok(Array.isArray(results));
    if (Array.isArray(results)) {
      for (const r of results) {
        assert.equal(r.type, 'error');
      }
    }
  });

  it('returns error for empty query', async () => {
    const results = await handleRecall({ query: '' }, kernel);
    assert.ok('error' in results);
  });

  it('combined filters narrow results correctly', async () => {
    const results = await handleRecall({
      query: 'PostgreSQL database',
      filters: { type: 'decision', importance_min: 0.8 },
    }, kernel);
    assert.ok(Array.isArray(results));
    if (Array.isArray(results)) {
      for (const r of results) {
        assert.equal(r.type, 'decision');
        assert.ok(r.importance_score >= 0.8);
      }
    }
  });
});
