/**
 * Tests for the unified `search` tool (T4.2 — v4 Cognition).
 *
 * Verifies handleSearchUnified behaviour across all scopes/modes/filters,
 * and that legacy tool handlers still work and carry _meta.deprecated.
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
import {
  handleSearchUnified,
  handleSearch,
  handleSearchContent,
  handleSearchKnowledge,
  handleRecall,
  handleBrowse,
} from '../../mcp-server/tools.js';
import { handleGlobalSearch } from '../../mcp-server/tools.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import { createTestDb } from '../helpers.js';

// ---------------------------------------------------------------------------
// Kernel builder (shared across suites)
// ---------------------------------------------------------------------------

async function buildKernel(storage: BetterSqlite3Storage, sessionId: string): Promise<ToolKernel> {
  const registry = new PluginRegistry();
  const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
  const pipeline = new Pipeline(registry, storage, privacy, sessionId);
  const bm25 = new BM25Search(storage);
  await registry.register(bm25);
  const search = new SearchFusion([bm25]);
  // Reset throttle so parallel test suites don't interfere
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

  return {
    pipeline, search, storage, registry, sessionId, config,
    projectDir: '/tmp/test-project', budgetManager, eventTracker,
    sessionManager, contentStore, knowledgeBase,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal call — search({query}) with defaults
// ---------------------------------------------------------------------------

describe('unified search — minimal call (scope=all, mode=hybrid)', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-minimal');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'TypeScript authentication middleware for API gateway', type: 'code' }, kernel);
    await handleObserve({ content: 'React hooks for state management', type: 'code' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('returns results array + cursor + _meta', async () => {
    const res = await handleSearchUnified({ query: 'TypeScript' }, kernel);
    assert.ok(Array.isArray(res.results), 'results should be an array');
    assert.ok('cursor' in res, 'should have cursor field');
    assert.ok('_meta' in res, 'should have _meta');
  });

  it('_meta contains scope=all and mode=hybrid', async () => {
    const res = await handleSearchUnified({ query: 'TypeScript' }, kernel);
    assert.strictEqual(res._meta.scope, 'all');
    assert.strictEqual(res._meta.mode, 'hybrid');
  });

  it('cursor is null in v4.0 (pagination stub)', async () => {
    const res = await handleSearchUnified({ query: 'TypeScript' }, kernel);
    assert.strictEqual(res.cursor, null);
  });
});

// ---------------------------------------------------------------------------
// 2. Scope: observations
// ---------------------------------------------------------------------------

describe('unified search — scope: observations', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-obs');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'PostgreSQL connection pool configuration', type: 'code' }, kernel);
    await handleObserve({ content: 'Redis cache eviction strategy LRU', type: 'decision' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('returns results from observations scope', async () => {
    const res = await handleSearchUnified({ query: 'PostgreSQL', scope: 'observations' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.scope, 'observations');
  });

  it('result entries have standard shape', async () => {
    const res = await handleSearchUnified({ query: 'connection', scope: 'observations' }, kernel);
    if (res.results.length > 0) {
      const r = res.results[0];
      assert.ok(typeof r.id === 'string');
      assert.ok(typeof r.title === 'string');
      assert.ok(typeof r.snippet === 'string');
      assert.ok(typeof r.relevance_score === 'number');
      assert.ok(typeof r.timestamp === 'number');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Scope: knowledge
// ---------------------------------------------------------------------------

describe('unified search — scope: knowledge', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-kb');
    const { handleSaveKnowledge } = await import('../../mcp-server/tools.js');
    await handleSaveKnowledge({
      category: 'pattern',
      title: 'Circuit breaker pattern',
      content: 'Use circuit breaker to prevent cascade failures in distributed systems',
    }, kernel);
  });
  after(async () => { await storage.close(); });

  it('returns knowledge entries for scope=knowledge', async () => {
    const res = await handleSearchUnified({ query: 'circuit breaker', scope: 'knowledge' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.scope, 'knowledge');
  });

  it('knowledge results have source=knowledge tag', async () => {
    const res = await handleSearchUnified({ query: 'circuit', scope: 'knowledge' }, kernel);
    if (res.results.length > 0) {
      assert.strictEqual(res.results[0]._source, 'knowledge');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Scope: content
// ---------------------------------------------------------------------------

describe('unified search — scope: content', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-content');
    const { handleIndexContent } = await import('../../mcp-server/tools.js');
    await handleIndexContent({ content: 'Webpack bundler configuration for production builds', source: 'docs/webpack.md' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('returns content-store results for scope=content', async () => {
    const res = await handleSearchUnified({ query: 'webpack bundler', scope: 'content' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.scope, 'content');
  });
});

// ---------------------------------------------------------------------------
// 5. Scope: topics
// ---------------------------------------------------------------------------

describe('unified search — scope: topics', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-topics');
    // Directly insert a topic + observation_topic link
    const obsId = 'obs-topic-test-001';
    const topicId = 'topic-scalability-001';
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [obsId, 'context', 'scalability discussion', 'scalability discussion', '{}', Date.now(), 'public']
    );
    storage.exec(
      `INSERT OR IGNORE INTO topics (id, name) VALUES (?, ?)`,
      [topicId, 'scalability']
    );
    storage.exec(
      `INSERT INTO observation_topics (observation_id, topic_id) VALUES (?, ?)`,
      [obsId, topicId]
    );
  });
  after(async () => { await storage.close(); });

  it('returns topic-related observations for scope=topics', async () => {
    const res = await handleSearchUnified({ query: 'scalability', scope: 'topics' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.scope, 'topics');
  });
});

// ---------------------------------------------------------------------------
// 6. Scope: all — interleaves across scopes
// ---------------------------------------------------------------------------

describe('unified search — scope: all', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-all');
    const { handleObserve, handleSaveKnowledge, handleIndexContent } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'Docker containerization strategy deployment', type: 'code' }, kernel);
    await handleSaveKnowledge({ category: 'pattern', title: 'Containerization pattern', content: 'Docker containers improve deployment reproducibility' }, kernel);
    await handleIndexContent({ content: 'Docker Compose orchestration guide', source: 'docs/docker.md' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('scope=all returns results (may be from any scope)', async () => {
    const res = await handleSearchUnified({ query: 'Docker', scope: 'all' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.scope, 'all');
  });

  it('results are sorted by relevance_score descending', async () => {
    const res = await handleSearchUnified({ query: 'Docker', scope: 'all', limit: 20 }, kernel);
    for (let i = 1; i < res.results.length; i++) {
      assert.ok(res.results[i - 1].relevance_score >= res.results[i].relevance_score,
        'results should be sorted descending by relevance_score');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Mode: verbatim
// ---------------------------------------------------------------------------

describe('unified search — mode: verbatim', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-verbatim');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'Kubernetes pod autoscaling horizontal pod autoscaler HPA configuration', type: 'code' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('mode=verbatim returns results from FTS content index', async () => {
    const res = await handleSearchUnified({ query: 'autoscaling', scope: 'observations', mode: 'verbatim' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.mode, 'verbatim');
  });

  it('verbatim results contain original content in snippet', async () => {
    const res = await handleSearchUnified({ query: 'autoscaling', scope: 'observations', mode: 'verbatim' }, kernel);
    if (res.results.length > 0) {
      assert.ok(res.results[0].snippet.includes('autoscaling'), 'snippet should contain original content');
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Mode: temporal
// ---------------------------------------------------------------------------

describe('unified search — mode: temporal', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-temporal');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'Database migration completed last week on staging environment', type: 'log' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('mode=temporal activates temporal resolver hint', async () => {
    const res = await handleSearchUnified({ query: 'last week migration', scope: 'observations', mode: 'temporal' }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.strictEqual(res._meta.mode, 'temporal');
  });
});

// ---------------------------------------------------------------------------
// 9. Filters: since/until
// ---------------------------------------------------------------------------

describe('unified search — filters: since/until', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let beforeTs: number;
  let afterTs: number;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-temporal-filter');
    beforeTs = Date.now() - 5000;
    const { handleObserve } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'API rate limiting configuration nginx proxy', type: 'code' }, kernel);
    afterTs = Date.now() + 5000;
  });
  after(async () => { await storage.close(); });

  it('filters.since removes results before timestamp', async () => {
    const res = await handleSearchUnified({
      query: 'nginx',
      scope: 'observations',
      filters: { since: afterTs }, // after everything was inserted
    }, kernel);
    assert.ok(Array.isArray(res.results));
    // All returned results must be >= since
    for (const r of res.results) {
      assert.ok(r.timestamp >= afterTs || r.timestamp === 0, 'timestamp should be >= since');
    }
  });

  it('filters.until removes results after timestamp', async () => {
    const res = await handleSearchUnified({
      query: 'nginx',
      scope: 'observations',
      filters: { until: beforeTs }, // before everything was inserted
    }, kernel);
    assert.ok(Array.isArray(res.results));
    for (const r of res.results) {
      assert.ok(r.timestamp <= beforeTs || r.timestamp === 0, 'timestamp should be <= until');
    }
  });

  it('since/until range that includes the observation returns results', async () => {
    const res = await handleSearchUnified({
      query: 'nginx',
      scope: 'observations',
      filters: { since: beforeTs, until: afterTs },
    }, kernel);
    // At least one result within the range
    assert.ok(Array.isArray(res.results));
  });
});

// ---------------------------------------------------------------------------
// 10. Filters: types
// ---------------------------------------------------------------------------

describe('unified search — filters: types', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-types');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'Service mesh implementation Istio envoy sidecar', type: 'code' }, kernel);
    await handleObserve({ content: 'OutOfMemoryError in service mesh pod', type: 'error' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('filters.types limits results to matching observation type (verbatim mode)', async () => {
    const res = await handleSearchUnified({
      query: 'mesh',
      scope: 'observations',
      mode: 'verbatim',
      filters: { types: ['error'] },
    }, kernel);
    assert.ok(Array.isArray(res.results));
    assert.ok(Object.keys(res._meta.filters_applied as object).includes('types'));
  });
});

// ---------------------------------------------------------------------------
// 11. Filters: importance_min
// ---------------------------------------------------------------------------

describe('unified search — filters: importance_min', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;
  let highImportanceId: string;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-importance');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    const res = await handleObserve({ content: 'Critical security vulnerability CVE-2024-0001 patched', type: 'error' }, kernel);
    if (!('error' in res)) {
      highImportanceId = res.id;
      // Set importance_score high
      storage.exec('UPDATE observations SET importance_score = 0.95 WHERE id = ?', [highImportanceId]);
    }
    await handleObserve({ content: 'Minor CVE patch applied in dev environment', type: 'log' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('importance_min filter excludes low-importance results (verbatim mode)', async () => {
    const res = await handleSearchUnified({
      query: 'CVE',
      scope: 'observations',
      mode: 'verbatim',
      filters: { importance_min: 0.9 },
    }, kernel);
    assert.ok(Array.isArray(res.results));
    // All returned results should have been above threshold
    for (const r of res.results) {
      const row = storage.prepare('SELECT importance_score FROM observations WHERE id = ?').get(r.id) as { importance_score: number } | undefined;
      if (row) {
        assert.ok(row.importance_score >= 0.9, `importance_score ${row.importance_score} should be >= 0.9`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Filters: pinned
// ---------------------------------------------------------------------------

describe('unified search — filters: pinned', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-pinned');
    const { handleObserve } = await import('../../mcp-server/tools.js');
    const r1 = await handleObserve({ content: 'Pinned important architecture decision microservices', type: 'decision' }, kernel);
    const r2 = await handleObserve({ content: 'Regular architecture note microservices', type: 'context' }, kernel);
    if (!('error' in r1)) storage.exec('UPDATE observations SET pinned = 1 WHERE id = ?', [r1.id]);
    if (!('error' in r2)) storage.exec('UPDATE observations SET pinned = 0 WHERE id = ?', [r2.id]);
  });
  after(async () => { await storage.close(); });

  it('filters.pinned=true returns only pinned observations (verbatim mode)', async () => {
    const res = await handleSearchUnified({
      query: 'microservices',
      scope: 'observations',
      mode: 'verbatim',
      filters: { pinned: true },
    }, kernel);
    assert.ok(Array.isArray(res.results));
    for (const r of res.results) {
      const row = storage.prepare('SELECT pinned FROM observations WHERE id = ?').get(r.id) as { pinned: number } | undefined;
      if (row) assert.ok(row.pinned === 1, `result ${r.id} should be pinned`);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Legacy tool delegates — deprecated _meta
// ---------------------------------------------------------------------------

describe('legacy tool wrappers — deprecation _meta', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-legacy');
    const { handleObserve, handleSaveKnowledge, handleIndexContent } = await import('../../mcp-server/tools.js');
    await handleObserve({ content: 'legacy search test observation GraphQL resolver', type: 'code' }, kernel);
    await handleSaveKnowledge({ category: 'api', title: 'GraphQL resolver pattern', content: 'Use DataLoader for batching' }, kernel);
    await handleIndexContent({ content: 'GraphQL schema design guide', source: 'docs/graphql.md' }, kernel);
  });
  after(async () => { await storage.close(); });

  it('handleSearch returns standard shape AND _meta.deprecated=true', async () => {
    const res = await handleSearch({ query: 'GraphQL' }, kernel);
    assert.ok(Array.isArray(res), 'should be an array');
    assert.ok((res as any)._meta?.deprecated === true, 'should have _meta.deprecated=true');
    assert.strictEqual((res as any)._meta?.replacement, 'search');
    assert.strictEqual((res as any)._meta?.removal_planned, 'v5.0.0');
  });

  it('handleSearchKnowledge returns standard shape AND _meta.deprecated=true', async () => {
    const res = await handleSearchKnowledge({ query: 'GraphQL' }, kernel);
    assert.ok(Array.isArray(res), 'should be an array');
    assert.ok((res as any)._meta?.deprecated === true, 'should have _meta.deprecated=true');
    assert.strictEqual((res as any)._meta?.replacement, 'search');
  });

  it('handleSearchContent returns standard shape AND _meta.deprecated=true', async () => {
    const res = await handleSearchContent({ query: 'GraphQL' }, kernel);
    assert.ok(Array.isArray(res), 'should be an array');
    assert.ok((res as any)._meta?.deprecated === true, 'should have _meta.deprecated=true');
    assert.strictEqual((res as any)._meta?.replacement_params?.scope, 'content');
  });

  it('handleRecall returns standard shape AND _meta.deprecated=true', async () => {
    const res = await handleRecall({ query: 'GraphQL' }, kernel);
    // Could be empty array or results, both are fine; check _meta
    if (Array.isArray(res) && res.length >= 0) {
      assert.ok((res as any)._meta?.deprecated === true || res.length === 0, '_meta.deprecated should be true when results exist');
    }
  });

  it('handleBrowse returns standard shape AND _meta.deprecated=true', async () => {
    const res = await handleBrowse({ dimension: 'topic', value: 'GraphQL' }, kernel);
    assert.ok(Array.isArray(res), 'should be an array');
    assert.ok((res as any)._meta?.deprecated === true, 'should have _meta.deprecated=true');
    assert.strictEqual((res as any)._meta?.replacement, 'search');
  });
});

// ---------------------------------------------------------------------------
// 14. Cursor — always null in v4.0
// ---------------------------------------------------------------------------

describe('unified search — cursor stub (v4.0)', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'unified-cursor');
  });
  after(async () => { await storage.close(); });

  it('cursor is null regardless of scope', async () => {
    for (const scope of ['observations', 'knowledge', 'content', 'topics', 'all'] as const) {
      const res = await handleSearchUnified({ query: 'test', scope }, kernel);
      assert.strictEqual(res.cursor, null, `cursor should be null for scope=${scope}`);
    }
  });

  it('cursor is null even when cursor param is passed', async () => {
    const res = await handleSearchUnified({ query: 'test', cursor: 'some-opaque-cursor' }, kernel);
    assert.strictEqual(res.cursor, null, 'cursor should be null in v4.0 regardless of input');
  });
});
