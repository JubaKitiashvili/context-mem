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
import { handleObserve, handleSummarize } from '../../mcp-server/tools.js';
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
    assert.ok(typeof result.id === 'string', 'id should be a string');
    assert.ok(result.id.length > 0, 'id should be non-empty');
    assert.ok(typeof result.tokens_saved === 'number', 'tokens_saved should be a number');
    assert.ok(result.tokens_saved >= 0, 'tokens_saved should be non-negative');
  });

  it('stores observation in DB', async () => {
    const content = 'MCP observe stores in DB';
    const result = await handleObserve({ content }, kernel);
    const row = storage.prepare('SELECT content FROM observations WHERE id = ?').get(result.id) as { content: string } | undefined;
    assert.ok(row, 'row should exist in DB');
    assert.equal(row.content, content);
  });

  it('uses provided type and source', async () => {
    const result = await handleObserve({ content: 'typed observe', type: 'error', source: 'test-runner' }, kernel);
    const row = storage.prepare('SELECT type FROM observations WHERE id = ?').get(result.id) as { type: string } | undefined;
    assert.equal(row?.type, 'error');
  });

  it('defaults type to context when not provided', async () => {
    const result = await handleObserve({ content: 'default type test' }, kernel);
    const row = storage.prepare('SELECT type FROM observations WHERE id = ?').get(result.id) as { type: string } | undefined;
    assert.equal(row?.type, 'context');
  });

  it('tokens_saved is zero when no summarizer ran', async () => {
    const result = await handleObserve({ content: 'short' }, kernel);
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
    assert.equal(result.summary, content, 'should return raw content as summary');
    assert.ok(typeof result.tokens_original === 'number');
    assert.ok(typeof result.tokens_summarized === 'number');
    assert.equal(result.savings_pct, 0);
  });

  it('returns savings_pct >= 0', async () => {
    const result = await handleSummarize({ content: 'another test' }, kernel);
    assert.ok(result.savings_pct >= 0, 'savings_pct should be non-negative');
  });

  it('tokens_original equals tokens_summarized when no savings', async () => {
    const result = await handleSummarize({ content: 'no savings here' }, kernel);
    assert.equal(result.tokens_original, result.tokens_summarized);
  });
});
