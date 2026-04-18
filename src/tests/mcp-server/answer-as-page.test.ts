/**
 * Tests for the Answer-as-Page workflow (T4.5 — v4 Cognition).
 *
 * ask({ save_as_page }) and search({ file_as: 'knowledge' }) persist synthesized
 * answers to the knowledge base and vault.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Pipeline } from '../../core/pipeline.js';
import { PluginRegistry } from '../../core/plugin-registry.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { SearchFusion } from '../../plugins/search/fusion.js';
import { BM25Search } from '../../plugins/search/bm25.js';
import { DEFAULT_CONFIG } from '../../core/types.js';
import { VaultSync } from '../../core/vault.js';
import { handleAsk, handleSearchUnified } from '../../mcp-server/tools/search.js';
import type { ToolKernel } from '../../mcp-server/tools/shared.js';
import { createTestDb } from '../helpers.js';

// ---------------------------------------------------------------------------
// Kernel builder (shared across suites)
// ---------------------------------------------------------------------------

async function buildKernel(
  storage: BetterSqlite3Storage,
  sessionId: string,
  vaultDir?: string,
): Promise<ToolKernel> {
  const registry = new PluginRegistry();
  const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
  const pipeline = new Pipeline(registry, storage, privacy, sessionId);
  const bm25 = new BM25Search(storage);
  await registry.register(bm25);
  const search = new SearchFusion([bm25]);
  search.resetThrottle();
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

  let vaultSync: VaultSync | undefined;
  if (vaultDir) {
    vaultSync = new VaultSync(storage, { vaultDir, enabled: true });
    await vaultSync.init();
  }

  return {
    pipeline, search, storage, registry, sessionId, config,
    projectDir: '/tmp/test-project', budgetManager, eventTracker,
    sessionManager, contentStore, knowledgeBase, vaultSync,
  };
}

// ---------------------------------------------------------------------------
// 1. ask without save_as_page — baseline, no side effects
// ---------------------------------------------------------------------------

describe('answer-as-page — ask without save_as_page', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let vaultDir: string;

  before(async () => {
    storage = await createTestDb();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    kernel = await buildKernel(storage, 'aap-baseline', vaultDir);
    // Insert a basic observation so ask has something to find
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-aap-001', 'context', 'TypeScript is a typed superset of JavaScript', 'TypeScript overview', '{}', Date.now(), 'public']
    );
  });
  after(async () => {
    await storage.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('returns a valid answer object', async () => {
    const result = await handleAsk({ question: 'What is TypeScript?' }, kernel);
    assert.ok(result !== null && typeof result === 'object', 'should return an object');
    assert.ok(!('error' in (result as object) && (result as Record<string, unknown>).error !== undefined), 'should not return an error for valid question');
  });

  it('no vault file created when save_as_page not set', async () => {
    await handleAsk({ question: 'What is TypeScript?' }, kernel);
    const answersDir = path.join(vaultDir, 'answers');
    const files = fs.existsSync(answersDir) ? fs.readdirSync(answersDir) : [];
    assert.strictEqual(files.length, 0, 'no answer pages should be created without save_as_page');
  });

  it('no knowledge entry created when save_as_page not set', async () => {
    const beforeCount = (storage.prepare('SELECT COUNT(*) as c FROM knowledge').get() as { c: number }).c;
    await handleAsk({ question: 'What is TypeScript?' }, kernel);
    const afterCount = (storage.prepare('SELECT COUNT(*) as c FROM knowledge').get() as { c: number }).c;
    assert.strictEqual(afterCount, beforeCount, 'no knowledge entry should be created without save_as_page');
  });

  it('_meta.filed_as not present when save_as_page not set', async () => {
    const result = await handleAsk({ question: 'What is TypeScript?' }, kernel) as Record<string, unknown>;
    const meta = result._meta as Record<string, unknown> | undefined;
    assert.ok(!meta?.filed_as, '_meta.filed_as should not be set');
  });
});

// ---------------------------------------------------------------------------
// 2. ask with save_as_page=true — full persistence
// ---------------------------------------------------------------------------

describe('answer-as-page — ask with save_as_page=true', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let vaultDir: string;
  let result: Record<string, unknown>;

  before(async () => {
    storage = await createTestDb();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    kernel = await buildKernel(storage, 'aap-save', vaultDir);
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-aap-002', 'decision', 'We chose React for the frontend because of ecosystem maturity', 'React choice decision', '{}', Date.now(), 'public']
    );
    result = await handleAsk({ question: 'Why did we choose React?', save_as_page: true }, kernel) as Record<string, unknown>;
  });
  after(async () => {
    await storage.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('result object is returned successfully', () => {
    assert.ok(result !== null && typeof result === 'object', 'should return an object');
  });

  it('_meta.filed_as is set in response', () => {
    const meta = result._meta as Record<string, unknown> | undefined;
    assert.ok(meta?.filed_as, '_meta.filed_as should be set');
    assert.ok(typeof meta?.filed_as === 'string', '_meta.filed_as should be a string ID');
  });

  it('_meta.vault_path points to answers directory', () => {
    const meta = result._meta as Record<string, unknown> | undefined;
    assert.ok(typeof meta?.vault_path === 'string', '_meta.vault_path should be a string');
    assert.ok((meta?.vault_path as string).startsWith('answers/'), '_meta.vault_path should start with answers/');
  });

  it('knowledge entry persisted with correct category and tags', () => {
    const meta = result._meta as Record<string, unknown>;
    const knowledgeId = meta.filed_as as string;
    const row = storage.prepare('SELECT category, title, tags FROM knowledge WHERE id = ?').get(knowledgeId) as
      { category: string; title: string; tags: string } | undefined;
    assert.ok(row, 'knowledge entry should exist in DB');
    assert.strictEqual(row.category, 'answer', 'category should be answer');
    assert.ok(row.title.length > 0, 'title should be set');
    const tags = JSON.parse(row.tags) as string[];
    assert.ok(tags.includes('auto-filed'), 'tags should include auto-filed');
    assert.ok(tags.includes('answer'), 'tags should include answer');
  });

  it('vault file created at vault/answers/{id}.md', () => {
    const meta = result._meta as Record<string, unknown>;
    const knowledgeId = meta.filed_as as string;
    const filePath = path.join(vaultDir, 'answers', `${knowledgeId}.md`);
    assert.ok(fs.existsSync(filePath), `vault file should exist at ${filePath}`);
  });

  it('vault file contains the question', () => {
    const meta = result._meta as Record<string, unknown>;
    const knowledgeId = meta.filed_as as string;
    const filePath = path.join(vaultDir, 'answers', `${knowledgeId}.md`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('Why did we choose React?'), 'vault file should contain the question');
  });

  it('vault file starts with "# Q:"', () => {
    const meta = result._meta as Record<string, unknown>;
    const knowledgeId = meta.filed_as as string;
    const filePath = path.join(vaultDir, 'answers', `${knowledgeId}.md`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.startsWith('# Q:'), 'vault page should start with # Q:');
  });
});

// ---------------------------------------------------------------------------
// 3. ask with save_as_page=true but vaultSync disabled
// ---------------------------------------------------------------------------

describe('answer-as-page — ask with save_as_page=true but no vaultSync', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    // Build kernel WITHOUT vaultSync
    kernel = await buildKernel(storage, 'aap-novault');
    assert.ok(!kernel.vaultSync, 'vaultSync should not be set');
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-aap-003', 'context', 'Node.js event loop is single-threaded', 'Node.js event loop', '{}', Date.now(), 'public']
    );
  });
  after(async () => { await storage.close(); });

  it('does not crash when vaultSync is absent', async () => {
    const result = await handleAsk({ question: 'How does Node.js work?', save_as_page: true }, kernel);
    assert.ok(result !== null, 'should return a result');
  });

  it('knowledge entry is still saved even without vaultSync', async () => {
    const before = (storage.prepare('SELECT COUNT(*) as c FROM knowledge').get() as { c: number }).c;
    const result = await handleAsk({ question: 'Explain Node event loop', save_as_page: true }, kernel) as Record<string, unknown>;
    const after = (storage.prepare('SELECT COUNT(*) as c FROM knowledge').get() as { c: number }).c;
    // Either the knowledge was saved (after > before) or the result has no error
    const meta = result._meta as Record<string, unknown> | undefined;
    // Knowledge should have been persisted
    assert.ok(after > before || meta?.filed_as, 'knowledge should be saved even without vault');
  });
});

// ---------------------------------------------------------------------------
// 4. search with file_as='knowledge' — top-3 synthesis filed
// ---------------------------------------------------------------------------

describe('answer-as-page — search with file_as=knowledge', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let vaultDir: string;
  let result: { results: unknown[]; cursor: null; _meta: Record<string, unknown> };

  before(async () => {
    storage = await createTestDb();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    kernel = await buildKernel(storage, 'aap-search', vaultDir);
    // Insert several observations for the search to find
    const now = Date.now();
    for (const [i, content] of [
      'Redis is an in-memory key-value store used for caching',
      'Redis supports pub/sub messaging patterns',
      'Redis streams provide persistent message queues',
      'Redis cluster provides horizontal scalability',
    ].entries()) {
      storage.exec(
        `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`obs-redis-${i}`, 'context', content, content, '{}', now + i, 'public']
      );
    }
    result = await handleSearchUnified(
      { query: 'Redis', scope: 'observations', file_as: 'knowledge' },
      kernel,
    ) as typeof result;
  });
  after(async () => {
    await storage.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('results array is returned normally', () => {
    assert.ok(Array.isArray(result.results), 'results should be an array');
  });

  it('_meta.filed_as is set', () => {
    assert.ok(result._meta.filed_as, '_meta.filed_as should be set');
    assert.ok(typeof result._meta.filed_as === 'string', '_meta.filed_as should be a string');
  });

  it('_meta.vault_path points to answers directory', () => {
    assert.ok(typeof result._meta.vault_path === 'string', '_meta.vault_path should be a string');
    assert.ok((result._meta.vault_path as string).startsWith('answers/'), 'vault_path should start with answers/');
  });

  it('knowledge entry has category=summary and correct tags', () => {
    const knowledgeId = result._meta.filed_as as string;
    const row = storage.prepare('SELECT category, tags FROM knowledge WHERE id = ?').get(knowledgeId) as
      { category: string; tags: string } | undefined;
    assert.ok(row, 'knowledge entry should exist');
    assert.strictEqual(row.category, 'summary');
    const tags = JSON.parse(row.tags) as string[];
    assert.ok(tags.includes('auto-filed'), 'should include auto-filed tag');
    assert.ok(tags.includes('search-synthesis'), 'should include search-synthesis tag');
  });

  it('vault page exists with correct content', () => {
    const knowledgeId = result._meta.filed_as as string;
    const filePath = path.join(vaultDir, 'answers', `${knowledgeId}.md`);
    assert.ok(fs.existsSync(filePath), 'vault file should exist');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('Redis'), 'vault page should include query term');
  });

  it('synthesis content is ≤ 500 chars', () => {
    const knowledgeId = result._meta.filed_as as string;
    const row = storage.prepare('SELECT content FROM knowledge WHERE id = ?').get(knowledgeId) as
      { content: string } | undefined;
    assert.ok(row, 'knowledge entry should exist');
    assert.ok(row.content.length <= 500, `synthesis should be ≤ 500 chars, got ${row.content.length}`);
  });
});

// ---------------------------------------------------------------------------
// 5. search with file_as='knowledge' but zero results — nothing filed
// ---------------------------------------------------------------------------

describe('answer-as-page — search file_as with zero results', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let vaultDir: string;

  before(async () => {
    storage = await createTestDb();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    kernel = await buildKernel(storage, 'aap-zero', vaultDir);
    // No observations inserted — empty DB
  });
  after(async () => {
    await storage.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('returns empty results array', async () => {
    const result = await handleSearchUnified(
      { query: 'xyzzy-nonexistent-query', scope: 'observations', file_as: 'knowledge' },
      kernel,
    );
    assert.ok(Array.isArray(result.results), 'results should be an array');
  });

  it('_meta.filed_as NOT present when no results', async () => {
    const result = await handleSearchUnified(
      { query: 'xyzzy-nonexistent-query', scope: 'observations', file_as: 'knowledge' },
      kernel,
    );
    assert.ok(!result._meta.filed_as, '_meta.filed_as should not be set when no results');
  });

  it('no knowledge entries created for empty results', async () => {
    const before = (storage.prepare('SELECT COUNT(*) as c FROM knowledge').get() as { c: number }).c;
    await handleSearchUnified(
      { query: 'xyzzy-nonexistent-query', scope: 'observations', file_as: 'knowledge' },
      kernel,
    );
    const after = (storage.prepare('SELECT COUNT(*) as c FROM knowledge').get() as { c: number }).c;
    assert.strictEqual(after, before, 'no knowledge entries should be created for zero results');
  });
});

// ---------------------------------------------------------------------------
// 6. Privacy — private observations excluded from synthesis
// ---------------------------------------------------------------------------

describe('answer-as-page — privacy: private observations excluded from synthesis', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let vaultDir: string;

  before(async () => {
    storage = await createTestDb();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    kernel = await buildKernel(storage, 'aap-privacy', vaultDir);
    const now = Date.now();
    // Public observation
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-pub-001', 'context', 'GraphQL allows flexible API queries', 'GraphQL overview', '{}', now, 'public']
    );
    // Private observation with sensitive content
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-priv-001', 'context', 'SECRET_API_KEY=abc123xyz PRIVATE_CREDENTIAL GraphQL internal auth', 'private GraphQL auth', '{}', now + 1, 'private']
    );
  });
  after(async () => {
    await storage.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('search with file_as does not include private content in vault page', async () => {
    const result = await handleSearchUnified(
      { query: 'GraphQL', scope: 'observations', mode: 'verbatim', file_as: 'knowledge' },
      kernel,
    );

    if (!result._meta.filed_as) {
      // No results found — test passes trivially (nothing to leak)
      return;
    }

    const knowledgeId = result._meta.filed_as as string;
    const filePath = path.join(vaultDir, 'answers', `${knowledgeId}.md`);

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Private credential must not appear in the vault page
      assert.ok(
        !content.includes('SECRET_API_KEY') && !content.includes('abc123xyz'),
        'vault page must not contain private credential content',
      );
    }

    // Also verify the synthesis in the knowledge entry
    const row = storage.prepare('SELECT content FROM knowledge WHERE id = ?').get(knowledgeId) as
      { content: string } | undefined;
    if (row) {
      assert.ok(
        !row.content.includes('SECRET_API_KEY') && !row.content.includes('abc123xyz'),
        'knowledge entry must not contain private credential content',
      );
    }
  });
});
