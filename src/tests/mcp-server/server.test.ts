import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from '../../mcp-server/server.js';
import { Kernel } from '../../core/kernel.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import { toolDefinitions } from '../../mcp-server/tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let kernel: Kernel;
let toolKernel: ToolKernel;

async function setupKernel(): Promise<void> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-mcp-test-'));
  // Write minimal config so Kernel picks it up
  fs.writeFileSync(
    path.join(tmpDir, '.context-mem.json'),
    JSON.stringify({ db_path: 'store.db', lifecycle: { cleanup_schedule: 'manual' } }),
  );

  kernel = new Kernel(tmpDir);
  await kernel.start();

  // Build the ToolKernel interface from the real Kernel
  toolKernel = {
    pipeline: kernel.pipeline,
    search: kernel.getSearchFusion(),
    storage: kernel.getStorage(),
    registry: kernel.registry,
    sessionId: kernel.session.session_id,
    config: kernel.getConfig(),
    projectDir: tmpDir,
    budgetManager: kernel.getBudgetManager(),
    eventTracker: kernel.getEventTracker(),
    sessionManager: kernel.getSessionManager(),
    contentStore: kernel.getContentStore(),
    knowledgeBase: kernel.getKnowledgeBase(),
  };
}

async function teardownKernel(): Promise<void> {
  await kernel.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMcpServer', () => {
  before(async () => {
    await setupKernel();
  });

  after(async () => {
    await teardownKernel();
  });

  it('returns a Server instance', () => {
    const server = createMcpServer(toolKernel);
    assert.ok(server instanceof Server, 'Expected a Server instance');
  });

  it('registers all expected tool definitions', () => {
    // Verify toolDefinitions covers the expected set of tools
    const names = toolDefinitions.map(t => t.name);
    const expected = [
      'observe', 'summarize', 'search', 'timeline', 'get', 'stats', 'configure', 'execute',
      'index_content', 'search_content', 'save_knowledge', 'search_knowledge',
      'promote_knowledge', 'global_search',
      'update_profile', 'budget_status', 'budget_configure', 'restore_session', 'emit_event', 'query_events',
      'graph_query', 'add_relationship', 'graph_neighbors',
      'agent_register', 'agent_status', 'claim_files', 'agent_broadcast',
      'time_travel', 'ask', 'handoff_session',
    ];
    assert.deepStrictEqual(names, expected);

    // Every definition has required fields
    for (const def of toolDefinitions) {
      assert.ok(def.name, `Tool definition missing name`);
      assert.ok(def.description, `Tool ${def.name} missing description`);
      assert.ok(def.inputSchema, `Tool ${def.name} missing inputSchema`);
      assert.strictEqual(
        (def.inputSchema as Record<string, unknown>).type,
        'object',
        `Tool ${def.name} inputSchema should be type: object`,
      );
    }
  });

  it('can create multiple independent server instances', () => {
    const server1 = createMcpServer(toolKernel);
    const server2 = createMcpServer(toolKernel);
    assert.ok(server1 instanceof Server);
    assert.ok(server2 instanceof Server);
    assert.notStrictEqual(server1, server2, 'Each call should produce a new server');
  });
});

describe('tool handlers via real kernel', () => {
  before(async () => {
    await setupKernel();
  });

  after(async () => {
    await teardownKernel();
  });

  it('observe rejects empty content', async () => {
    const { handleObserve } = await import('../../mcp-server/tools.js');
    const result = await handleObserve({ content: '' }, toolKernel);
    assert.ok('error' in result, 'Expected error response for empty content');
    assert.match((result as { error: string }).error, /content is required/);
  });

  it('observe rejects oversized content', async () => {
    const { handleObserve } = await import('../../mcp-server/tools.js');
    const bigContent = 'x'.repeat(512 * 1024 + 1);
    const result = await handleObserve({ content: bigContent }, toolKernel);
    assert.ok('error' in result, 'Expected error response for oversized content');
    assert.match((result as { error: string }).error, /exceeds maximum length/);
  });

  it('observe stores valid content and returns id + summary', async () => {
    const { handleObserve } = await import('../../mcp-server/tools.js');
    const result = await handleObserve(
      { content: 'Test observation for MCP server test', type: 'context', source: 'test' },
      toolKernel,
    );
    assert.ok(!('error' in result), `Unexpected error: ${'error' in result ? (result as { error: string }).error : ''}`);
    const ok = result as { id: string; summary: string | undefined; tokens_saved: number };
    assert.ok(ok.id, 'Expected an observation ID');
    assert.strictEqual(typeof ok.tokens_saved, 'number');
  });

  it('get returns error for non-existent observation', async () => {
    const { handleGet } = await import('../../mcp-server/tools.js');
    const result = await handleGet({ id: 'nonexistent-id' }, toolKernel);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /not found/i);
  });

  it('configure rejects prototype pollution keys', async () => {
    const { handleConfigure } = await import('../../mcp-server/tools.js');
    const result = await handleConfigure({ key: '__proto__.polluted', value: true }, toolKernel);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /Forbidden/);
  });

  it('configure rejects keys outside the mutable allowlist', async () => {
    const { handleConfigure } = await import('../../mcp-server/tools.js');
    const result = await handleConfigure({ key: 'db_path', value: '/tmp/evil.db' }, toolKernel);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /not in the mutable config allowlist/);
  });

  it('execute is disabled by default', async () => {
    const { handleExecute } = await import('../../mcp-server/tools.js');
    const result = await handleExecute({ code: 'console.log("hi")' }, toolKernel);
    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /disabled/i);
  });

  it('stats returns token economics for the session', async () => {
    const { handleStats } = await import('../../mcp-server/tools.js');
    const result = await handleStats({} as Record<string, never>, toolKernel);
    assert.strictEqual(result.session_id, toolKernel.sessionId);
    assert.strictEqual(typeof result.observations_stored, 'number');
    assert.strictEqual(typeof result.tokens_saved, 'number');
    assert.strictEqual(typeof result.savings_percentage, 'number');
  });
});
