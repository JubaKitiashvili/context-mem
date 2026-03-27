/**
 * Tests for GlobalKnowledgeStore — cross-project knowledge transfer.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GlobalKnowledgeStore } from '../../core/global-store.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { DEFAULT_CONFIG } from '../../core/types.js';
import {
  handleSearchKnowledge,
  handlePromoteKnowledge,
  handleGlobalSearch,
} from '../../mcp-server/tools.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import type { KnowledgeEntry } from '../../core/types.js';
import { createTestDb } from '../helpers.js';

function createGlobalStore(tmpDir: string, privacyEngine?: PrivacyEngine): GlobalKnowledgeStore {
  const dbPath = path.join(tmpDir, 'global', 'store.db');
  const privacy = privacyEngine ?? new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
  const store = new GlobalKnowledgeStore(privacy, dbPath);
  store.open();
  return store;
}

function makeMockEntry(overrides?: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 'test-entry-1',
    category: 'pattern',
    title: 'PostgreSQL connection pooling',
    content: 'Use PgBouncer for connection pooling in production. Set pool_mode to transaction.',
    tags: ['postgres', 'performance'],
    shareable: true,
    relevance_score: 1.0,
    access_count: 5,
    created_at: Date.now(),
    last_accessed: Date.now(),
    archived: false,
    source_type: 'explicit',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GlobalKnowledgeStore unit tests
// ---------------------------------------------------------------------------

describe('GlobalKnowledgeStore', () => {
  let tmpDir: string;
  let store: GlobalKnowledgeStore;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-global-test-'));
    store = createGlobalStore(tmpDir);
  });

  after(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates global DB directory and file', () => {
    const dbPath = path.join(tmpDir, 'global', 'store.db');
    assert.ok(fs.existsSync(dbPath), 'store.db should exist');
  });

  it('promote stores entry with source_project', () => {
    const entry = makeMockEntry();
    const result = store.promote(entry, 'my-project');

    assert.ok(result.id, 'should have an ID');
    assert.notEqual(result.id, entry.id, 'global ID should be different from project ID');
    assert.equal(result.source_project, 'my-project');
    assert.equal(result.category, 'pattern');
    assert.equal(result.title, 'PostgreSQL connection pooling');
    assert.deepEqual(result.tags, ['postgres', 'performance']);
  });

  it('search returns promoted entries', () => {
    const results = store.search('PostgreSQL connection');
    assert.ok(results.length > 0, 'should find promoted entry');
    assert.equal(results[0].source_project, 'my-project');
    assert.equal(results[0].category, 'pattern');
  });

  it('search with category filter works', () => {
    const results = store.search('PostgreSQL', { category: 'pattern' });
    assert.ok(results.length > 0, 'should find entry in pattern category');

    const noResults = store.search('PostgreSQL', { category: 'error' });
    assert.equal(noResults.length, 0, 'should not find entry in error category');
  });

  it('getAll returns all entries', () => {
    const all = store.getAll();
    assert.ok(all.length > 0, 'should return entries');
    assert.equal(all[0].source_project, 'my-project');
  });

  it('demote removes entry from global store', () => {
    const entry = makeMockEntry({ id: 'demote-test', title: 'Entry to demote' });
    const promoted = store.promote(entry, 'project-x');
    assert.ok(store.getById(promoted.id), 'entry should exist before demote');

    const removed = store.demote(promoted.id);
    assert.ok(removed, 'demote should return true');
    assert.equal(store.getById(promoted.id), null, 'entry should be gone after demote');
  });

  it('privacy engine redacts secrets before promotion', () => {
    const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-global-priv-'));
    const store2 = createGlobalStore(tmpDir2, privacy);

    const entry = makeMockEntry({
      id: 'secret-entry',
      title: 'API Config',
      content: 'Use key AKIA1234567890123456 for AWS access',
    });

    const result = store2.promote(entry, 'secret-project');
    assert.ok(result.content.includes('[AWS_KEY_REDACTED]'), 'AWS key should be redacted');
    assert.ok(!result.content.includes('AKIA1234567890123456'), 'original key should not appear');

    store2.close();
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  it('source_project tag preserved across operations', () => {
    const entry = makeMockEntry({ id: 'tag-test', title: 'Tag test entry' });
    const promoted = store.promote(entry, 'tagged-project');

    // Verify via getById
    const fetched = store.getById(promoted.id);
    assert.ok(fetched);
    assert.equal(fetched.source_project, 'tagged-project');

    // Verify via search
    const searched = store.search('Tag test');
    const found = searched.find(r => r.id === promoted.id);
    assert.ok(found);
    assert.equal(found.source_project, 'tagged-project');
  });
});

// ---------------------------------------------------------------------------
// MCP tool integration tests
// ---------------------------------------------------------------------------

describe('Global knowledge MCP tools', () => {
  let storage: BetterSqlite3Storage;
  let globalStore: GlobalKnowledgeStore;
  let kernel: ToolKernel;
  let tmpDir: string;

  before(async () => {
    storage = await createTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-global-mcp-'));
    const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    globalStore = new GlobalKnowledgeStore(privacy, path.join(tmpDir, 'global', 'store.db'));
    globalStore.open();

    const { PluginRegistry } = await import('../../core/plugin-registry.js');
    const { Pipeline } = await import('../../core/pipeline.js');
    const { SearchFusion } = await import('../../plugins/search/fusion.js');
    const { BM25Search } = await import('../../plugins/search/bm25.js');
    const { BudgetManager } = await import('../../core/budget.js');
    const { EventTracker } = await import('../../core/events.js');
    const { SessionManager } = await import('../../core/session.js');
    const { ContentStore } = await import('../../plugins/storage/content-store.js');

    const registry = new PluginRegistry();
    const pipeline = new Pipeline(registry, storage, privacy, 'global-test-session');
    const bm25 = new BM25Search(storage);
    await registry.register(bm25);
    const search = new SearchFusion([bm25]);
    const config = structuredClone(DEFAULT_CONFIG);
    const budgetManager = new BudgetManager(storage);
    const eventTracker = new EventTracker(storage);
    const sessionManager = new SessionManager(storage, eventTracker);
    const contentStore = new ContentStore(storage);
    const knowledgeBase = new KnowledgeBase(storage);

    kernel = {
      pipeline,
      search,
      storage,
      registry,
      sessionId: 'global-test-session',
      config,
      budgetManager,
      eventTracker,
      sessionManager,
      contentStore,
      knowledgeBase,
      globalStore,
    };
  });

  after(async () => {
    globalStore.close();
    await storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('promote_knowledge promotes entry from project to global', async () => {
    // First save an entry in project KB
    const entry = kernel.knowledgeBase.save({
      category: 'decision',
      title: 'Use TypeScript strict mode',
      content: 'Always enable strict mode in tsconfig for better type safety.',
      tags: ['typescript'],
      source_type: 'explicit',
    });

    const result = await handlePromoteKnowledge({ id: entry.id }, kernel);
    assert.ok(!('error' in result), 'should not return error');
    assert.equal((result as any).id, entry.id);
    assert.ok((result as any).global_id, 'should have global_id');
  });

  it('global_search returns promoted entries', async () => {
    const results = await handleGlobalSearch({ query: 'TypeScript strict' }, kernel);
    assert.ok(Array.isArray(results), 'should return array');
    assert.ok((results as any[]).length > 0, 'should find promoted entry');
    assert.ok((results as any[])[0].source_project, 'should have source_project');
  });

  it('search_knowledge with include_global merges results', async () => {
    // Save another project entry
    kernel.knowledgeBase.save({
      category: 'pattern',
      title: 'React hooks pattern',
      content: 'Use custom hooks to share logic between components.',
      tags: ['react'],
      source_type: 'explicit',
    });

    // Promote a different entry to global
    const globalEntry = makeMockEntry({
      id: 'global-merge-test',
      title: 'Docker multi-stage builds',
      content: 'Use multi-stage builds to reduce image size.',
    });
    globalStore.promote(globalEntry, 'other-project');

    // Search with include_global
    const results = await handleSearchKnowledge(
      { query: 'builds', include_global: true },
      kernel,
    );

    assert.ok(Array.isArray(results), 'should return array');
    // Should include global results
    const hasGlobal = (results as any[]).some(r => r.source_project);
    assert.ok(hasGlobal, 'should include global results when include_global is true');
  });

  it('promote_knowledge returns error when entry not found', async () => {
    const result = await handlePromoteKnowledge({ id: 'nonexistent-id' }, kernel);
    assert.ok('error' in result, 'should return error');
  });

  it('global_search returns error when store is not enabled', async () => {
    const kernelWithout = { ...kernel, globalStore: undefined };
    const result = await handleGlobalSearch({ query: 'test' }, kernelWithout);
    assert.ok('error' in result, 'should return error');
  });
});

// ---------------------------------------------------------------------------
// Config disabled tests
// ---------------------------------------------------------------------------

describe('Global knowledge disabled via config', () => {
  let storage: BetterSqlite3Storage;
  let globalStore: GlobalKnowledgeStore;
  let kernel: ToolKernel;
  let tmpDir: string;

  before(async () => {
    storage = await createTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-global-disabled-'));
    const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    globalStore = new GlobalKnowledgeStore(privacy, path.join(tmpDir, 'global', 'store.db'));
    globalStore.open();

    const { PluginRegistry } = await import('../../core/plugin-registry.js');
    const { Pipeline } = await import('../../core/pipeline.js');
    const { SearchFusion } = await import('../../plugins/search/fusion.js');
    const { BM25Search } = await import('../../plugins/search/bm25.js');
    const { BudgetManager } = await import('../../core/budget.js');
    const { EventTracker } = await import('../../core/events.js');
    const { SessionManager } = await import('../../core/session.js');
    const { ContentStore } = await import('../../plugins/storage/content-store.js');

    const registry = new PluginRegistry();
    const pipeline = new Pipeline(registry, storage, privacy, 'disabled-test');
    const bm25 = new BM25Search(storage);
    await registry.register(bm25);
    const search = new SearchFusion([bm25]);
    const config = structuredClone(DEFAULT_CONFIG);
    config.global_knowledge = { enabled: false };
    const budgetManager = new BudgetManager(storage);
    const eventTracker = new EventTracker(storage);
    const sessionManager = new SessionManager(storage, eventTracker);
    const contentStore = new ContentStore(storage);
    const knowledgeBase = new KnowledgeBase(storage);

    kernel = {
      pipeline,
      search,
      storage,
      registry,
      sessionId: 'disabled-test',
      config,
      budgetManager,
      eventTracker,
      sessionManager,
      contentStore,
      knowledgeBase,
      globalStore,
    };
  });

  after(async () => {
    globalStore.close();
    await storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('promote_knowledge returns error when config disabled', async () => {
    const entry = kernel.knowledgeBase.save({
      category: 'pattern',
      title: 'Disabled test',
      content: 'This should not promote.',
      source_type: 'explicit',
    });

    const result = await handlePromoteKnowledge({ id: entry.id }, kernel);
    assert.ok('error' in result, 'should return error when disabled');
    assert.ok((result as any).error.includes('disabled'), 'error should mention disabled');
  });

  it('global_search returns error when config disabled', async () => {
    const result = await handleGlobalSearch({ query: 'test' }, kernel);
    assert.ok('error' in result, 'should return error when disabled');
  });

  it('search_knowledge with include_global does not include global results when disabled', async () => {
    kernel.knowledgeBase.save({
      category: 'pattern',
      title: 'Local only entry',
      content: 'This is a local entry for disabled test.',
      source_type: 'explicit',
    });

    const results = await handleSearchKnowledge(
      { query: 'Local only', include_global: true },
      kernel,
    );

    assert.ok(Array.isArray(results), 'should return array');
    const hasGlobal = (results as any[]).some(r => r.source_project);
    assert.ok(!hasGlobal, 'should NOT include global results when disabled');
  });
});
