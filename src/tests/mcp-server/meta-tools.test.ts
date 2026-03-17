/**
 * Tests for stats, configure, execute MCP tool handlers (Task 21).
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
import type { RuntimePlugin, PluginConfig, ExecResult, ExecOpts } from '../../core/types.js';
import { handleStats, handleConfigure, handleExecute, handleObserve } from '../../mcp-server/tools.js';
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

  return { pipeline, search, storage, registry, sessionId, config, budgetManager, eventTracker, sessionManager, contentStore, knowledgeBase };
}

function makeMockRuntime(lang: string, execResult: Partial<ExecResult> = {}): RuntimePlugin {
  return {
    name: `${lang}-runtime`,
    version: '1.0.0',
    type: 'runtime',
    language: lang,
    extensions: [`.${lang}`],
    async init(_config: PluginConfig): Promise<void> {},
    async destroy(): Promise<void> {},
    async detect(): Promise<boolean> { return true; },
    async execute(_code: string, _opts: ExecOpts): Promise<ExecResult> {
      return {
        stdout: execResult.stdout ?? `${lang} output`,
        stderr: execResult.stderr ?? '',
        exit_code: execResult.exit_code ?? 0,
        duration_ms: execResult.duration_ms ?? 10,
        truncated: false,
      };
    },
  };
}

describe('MCP tools — stats', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-stats-session');
    await handleObserve({ content: 'first stats observation' }, kernel);
    await handleObserve({ content: 'second stats observation' }, kernel);
  });

  after(async () => { await storage.close(); });

  it('returns a TokenEconomics-shaped object', async () => {
    const stats = await handleStats({} as never, kernel);
    assert.ok(typeof stats.session_id === 'string', 'session_id should be string');
    assert.ok(typeof stats.observations_stored === 'number', 'observations_stored should be number');
    assert.ok(typeof stats.tokens_saved === 'number', 'tokens_saved should be number');
    assert.ok(typeof stats.savings_percentage === 'number', 'savings_percentage should be number');
    assert.ok(typeof stats.searches_performed === 'number', 'searches_performed should be number');
  });

  it('session_id matches kernel session', async () => {
    const stats = await handleStats({} as never, kernel);
    assert.equal(stats.session_id, 'mcp-stats-session');
  });

  it('observations_stored reflects seeded observations', async () => {
    const stats = await handleStats({} as never, kernel);
    assert.ok(stats.observations_stored >= 2, 'should have at least 2 observations');
  });

  it('savings_percentage is between 0 and 100', async () => {
    const stats = await handleStats({} as never, kernel);
    assert.ok(stats.savings_percentage >= 0 && stats.savings_percentage <= 100,
      `savings_percentage ${stats.savings_percentage} should be 0-100`);
  });
});

describe('MCP tools — configure', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-config-session');
  });

  after(async () => { await storage.close(); });

  it('returns updated=true with key and value', async () => {
    const result = await handleConfigure({ key: 'privacy.strip_tags', value: false }, kernel);
    assert.ok(!('error' in result), `should not error: ${'error' in result ? (result as { error: string }).error : ''}`);
    if (!('error' in result)) {
      assert.equal(result.updated, true);
      assert.equal(result.key, 'privacy.strip_tags');
      assert.equal(result.value, false);
    }
  });

  it('actually mutates the kernel config', async () => {
    await handleConfigure({ key: 'privacy.strip_tags', value: false }, kernel);
    assert.equal(kernel.config.privacy.strip_tags, false);
  });

  it('can set a top-level config key', async () => {
    await handleConfigure({ key: 'token_economics', value: false }, kernel);
    assert.equal(kernel.config.token_economics, false);
  });

  it('can set a nested config key', async () => {
    await handleConfigure({ key: 'lifecycle.ttl_days', value: 7 }, kernel);
    assert.equal(kernel.config.lifecycle.ttl_days, 7);
  });

  it('rejects keys not in the allowlist', async () => {
    const result = await handleConfigure({ key: 'storage', value: 'sqlite' }, kernel);
    assert.ok('error' in result, 'should return error for non-allowlisted key');
  });
});

describe('MCP tools — execute', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'mcp-exec-session');
  });

  after(async () => { await storage.close(); });

  it('returns error when execute_enabled is false', async () => {
    const result = await handleExecute({ code: 'console.log("hi")' }, kernel);
    assert.ok('error' in result, 'should return error when execute_enabled is false');
    assert.ok((result as { error: string }).error.includes('disabled'), 'error should mention disabled');
  });

  describe('with a mock runtime registered and execute_enabled=true', () => {
    before(async () => {
      kernel.config.execute_enabled = true;
      const mockRuntime = makeMockRuntime('javascript', {
        stdout: 'hello world',
        stderr: '',
        exit_code: 0,
        duration_ms: 5,
      });
      await kernel.registry.register(mockRuntime);
    });

    it('executes code and returns result shape', async () => {
      const result = await handleExecute({ code: 'console.log("hello world")' }, kernel);
      assert.ok(!('error' in result), 'should not have error field');
      if (!('error' in result)) {
        assert.ok(typeof result.stdout === 'string', 'stdout should be string');
        assert.ok(typeof result.stderr === 'string', 'stderr should be string');
        assert.ok(typeof result.exit_code === 'number', 'exit_code should be number');
        assert.ok(typeof result.duration_ms === 'number', 'duration_ms should be number');
      }
    });

    it('uses matching runtime by language', async () => {
      const result = await handleExecute({ code: 'print("hi")', language: 'javascript' }, kernel);
      if (!('error' in result)) {
        assert.equal(result.stdout, 'hello world');
      }
    });

    it('falls back to first runtime when language not found', async () => {
      const result = await handleExecute({ code: 'some code', language: 'ruby' }, kernel);
      // No ruby runtime — should fall back to javascript mock
      assert.ok(!('error' in result), 'should fall back to first available runtime');
    });
  });
});
