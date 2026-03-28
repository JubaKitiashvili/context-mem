/**
 * Tests for handleResolveContradiction — contradiction resolution flow.
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
import { handleSaveKnowledge, handleResolveContradiction } from '../../mcp-server/tools.js';
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

// ---------------------------------------------------------------------------
// handleResolveContradiction tests
// ---------------------------------------------------------------------------

describe('handleResolveContradiction', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'resolve-test-session');
  });

  after(async () => { await storage.close(); });

  it('rejects invalid action', async () => {
    const result = await handleResolveContradiction({
      entry_id: 'a', conflicting_id: 'b', action: 'invalid',
    }, kernel);
    assert.ok('error' in result, 'should return error for invalid action');
    assert.ok((result as { error: string }).error.includes('Invalid action'));
  });

  it('rejects missing entry_id', async () => {
    const result = await handleResolveContradiction({
      entry_id: '', conflicting_id: 'b', action: 'supersede',
    }, kernel);
    assert.ok('error' in result, 'should return error for missing entry_id');
  });

  it('rejects merge without merged_content', async () => {
    const result = await handleResolveContradiction({
      entry_id: 'a', conflicting_id: 'b', action: 'merge',
    }, kernel);
    assert.ok('error' in result, 'should return error when merge has no merged_content');
    assert.ok((result as { error: string }).error.includes('merged_content'));
  });

  it('returns error for non-existent entries', async () => {
    const result = await handleResolveContradiction({
      entry_id: 'nonexistent1', conflicting_id: 'nonexistent2', action: 'supersede',
    }, kernel);
    assert.ok('error' in result, 'should return error for non-existent entry');
  });

  it('supersede archives the conflicting entry', async () => {
    // Save two entries
    const first = await handleSaveKnowledge({
      category: 'decision', title: 'Auth strategy', content: 'Use JWT tokens', tags: ['auth'],
    }, kernel);
    assert.ok('id' in first);

    const second = await handleSaveKnowledge({
      category: 'decision', title: 'Auth strategy v2', content: 'Use session cookies', tags: ['auth'], force: true,
    }, kernel);
    assert.ok('id' in second);

    const firstId = (first as { id: string }).id;
    const secondId = (second as { id: string }).id;

    const result = await handleResolveContradiction({
      entry_id: secondId, conflicting_id: firstId, action: 'supersede',
    }, kernel);

    assert.ok('resolved' in result, 'should resolve successfully');
    const resolved = result as { resolved: true; action: string; archived?: string[] };
    assert.equal(resolved.action, 'supersede');
    assert.ok(resolved.archived?.includes(firstId), 'should archive the conflicting entry');

    // Verify old entry is archived
    const old = kernel.knowledgeBase.getById(firstId);
    assert.ok(old, 'entry should still exist');
    assert.equal(old!.archived, true, 'conflicting entry should be archived');

    // Verify new entry is still active
    const kept = kernel.knowledgeBase.getById(secondId);
    assert.ok(kept, 'kept entry should still exist');
    assert.equal(kept!.archived, false, 'kept entry should not be archived');
  });

  it('merge creates new entry and archives both originals', async () => {
    const first = await handleSaveKnowledge({
      category: 'pattern', title: 'Error handling', content: 'Use try-catch blocks', tags: ['errors'],
    }, kernel);
    assert.ok('id' in first);

    const second = await handleSaveKnowledge({
      category: 'pattern', title: 'Error handling v2', content: 'Use Result type pattern', tags: ['errors', 'typescript'], force: true,
    }, kernel);
    assert.ok('id' in second);

    const firstId = (first as { id: string }).id;
    const secondId = (second as { id: string }).id;

    const result = await handleResolveContradiction({
      entry_id: secondId,
      conflicting_id: firstId,
      action: 'merge',
      merged_content: 'Use try-catch for runtime errors and Result type for domain errors',
    }, kernel);

    assert.ok('resolved' in result, 'should resolve successfully');
    const resolved = result as { resolved: true; action: string; archived?: string[]; created?: string };
    assert.equal(resolved.action, 'merge');
    assert.ok(resolved.archived?.includes(firstId), 'should archive first entry');
    assert.ok(resolved.archived?.includes(secondId), 'should archive second entry');
    assert.ok(resolved.created, 'should create a new merged entry');

    // Verify both originals are archived
    assert.equal(kernel.knowledgeBase.getById(firstId)!.archived, true);
    assert.equal(kernel.knowledgeBase.getById(secondId)!.archived, true);

    // Verify merged entry exists and is active
    const merged = kernel.knowledgeBase.getById(resolved.created!);
    assert.ok(merged, 'merged entry should exist');
    assert.equal(merged!.archived, false);
    assert.ok(merged!.content.includes('try-catch'), 'merged content should have content from both');
    assert.ok(merged!.tags.includes('merged'), 'merged entry should have merged tag');
  });

  it('keep_both adds reviewed tags to both entries', async () => {
    const first = await handleSaveKnowledge({
      category: 'decision', title: 'DB choice primary', content: 'Use PostgreSQL', tags: ['db'],
    }, kernel);
    assert.ok('id' in first);

    const second = await handleSaveKnowledge({
      category: 'decision', title: 'DB choice cache', content: 'Use Redis for caching', tags: ['db', 'cache'], force: true,
    }, kernel);
    assert.ok('id' in second);

    const firstId = (first as { id: string }).id;
    const secondId = (second as { id: string }).id;

    const result = await handleResolveContradiction({
      entry_id: secondId, conflicting_id: firstId, action: 'keep_both',
    }, kernel);

    assert.ok('resolved' in result, 'should resolve successfully');
    const resolved = result as { resolved: true; action: string };
    assert.equal(resolved.action, 'keep_both');

    // Verify both entries are still active with reviewed tags
    const e1 = kernel.knowledgeBase.getById(firstId);
    const e2 = kernel.knowledgeBase.getById(secondId);
    assert.equal(e1!.archived, false, 'first entry should not be archived');
    assert.equal(e2!.archived, false, 'second entry should not be archived');
    assert.ok(e1!.tags.includes('reviewed'), 'first entry should have reviewed tag');
    assert.ok(e2!.tags.includes('reviewed'), 'second entry should have reviewed tag');
    assert.ok(e1!.tags.includes('non-contradicting'), 'first entry should have non-contradicting tag');
  });

  it('archive_old archives only the conflicting entry', async () => {
    const first = await handleSaveKnowledge({
      category: 'api', title: 'API versioning old', content: 'Use URL path versioning', tags: ['api'],
    }, kernel);
    assert.ok('id' in first);

    const second = await handleSaveKnowledge({
      category: 'api', title: 'API versioning new', content: 'Use header-based versioning', tags: ['api'], force: true,
    }, kernel);
    assert.ok('id' in second);

    const firstId = (first as { id: string }).id;
    const secondId = (second as { id: string }).id;

    const result = await handleResolveContradiction({
      entry_id: secondId, conflicting_id: firstId, action: 'archive_old',
    }, kernel);

    assert.ok('resolved' in result, 'should resolve successfully');
    const resolved = result as { resolved: true; action: string; archived?: string[] };
    assert.equal(resolved.action, 'archive_old');
    assert.ok(resolved.archived?.includes(firstId));

    assert.equal(kernel.knowledgeBase.getById(firstId)!.archived, true);
    assert.equal(kernel.knowledgeBase.getById(secondId)!.archived, false);
  });
});
