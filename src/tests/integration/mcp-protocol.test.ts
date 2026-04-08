import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../mcp-server/server.js';
import { Kernel } from '../../core/kernel.js';
import type { ToolKernel } from '../../mcp-server/tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let kernel: Kernel;
let toolKernel: ToolKernel;
let client: Client;

function parseResult<T = unknown>(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): T {
  const text = result.content[0]?.text ?? '';
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

async function setup(): Promise<void> {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-mcp-proto-'));
  fs.writeFileSync(
    path.join(tmpDir, '.context-mem.json'),
    JSON.stringify({ db_path: 'store.db', lifecycle: { cleanup_schedule: 'manual' } }),
  );

  kernel = new Kernel(tmpDir);
  await kernel.start();

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

  const server = createMcpServer(toolKernel);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
}

async function teardown(): Promise<void> {
  try { await client.close(); } catch {}
  try { await kernel.stop(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Protocol E2E', () => {
  before(async () => {
    await setup();
  });

  after(async () => {
    await teardown();
  });

  // Test 1: listTools returns all 33 tools with correct names
  it('listTools returns all 33 tools with correct names', async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 33);
    const names = tools.map(t => t.name);
    const expected = [
      'observe', 'summarize', 'search', 'timeline', 'get', 'stats', 'configure', 'execute',
      'index_content', 'search_content', 'save_knowledge', 'search_knowledge',
      'promote_knowledge', 'global_search',
      'update_profile', 'budget_status', 'budget_configure', 'restore_session', 'emit_event', 'query_events',
      'graph_query', 'add_relationship', 'graph_neighbors',
      'agent_register', 'agent_status', 'claim_files', 'agent_broadcast',
      'time_travel', 'ask', 'resolve_contradiction', 'handoff_session',
      'recall', 'merge_suggestions',
    ];
    assert.deepStrictEqual(names, expected);

    for (const tool of tools) {
      assert.ok(tool.description, `Tool ${tool.name} should have a description`);
      assert.ok(tool.inputSchema, `Tool ${tool.name} should have an inputSchema`);
    }
  });

  // Test 2: Full observe -> search -> get cycle via MCP protocol
  it('full observe -> search -> get cycle via MCP protocol', async () => {
    const observeResult = await client.callTool({
      name: 'observe',
      arguments: {
        content: 'function calculateTax(income: number, rate: number): number { return income * rate; }',
        type: 'code',
      },
    });
    assert.ok(!observeResult.isError, 'observe should not error');
    const observed = parseResult<{ id: string; summary: string | undefined; tokens_saved: number }>(
      observeResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(observed.id, 'observe should return an id');

    // Search for it
    const searchResult = await client.callTool({
      name: 'search',
      arguments: { query: 'calculateTax' },
    });
    assert.ok(!searchResult.isError, 'search should not error');
    const results = parseResult<Array<{ id: string; title: string; snippet: string; relevance_score: number; timestamp: number }>>(
      searchResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(results.length >= 1, 'search should find at least one result');
    assert.equal(results[0].id, observed.id);

    // Get full observation
    const getResult = await client.callTool({
      name: 'get',
      arguments: { id: observed.id },
    });
    assert.ok(!getResult.isError, 'get should not error');
    const detail = parseResult<{ id: string; type: string; content: string; summary: string | null; metadata: Record<string, unknown> }>(
      getResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.equal(detail.id, observed.id);
    assert.ok(detail.content.includes('calculateTax'), 'get should return original content');
    assert.equal(detail.type, 'code');
  });

  // Test 3: observe + summarize flow
  it('observe + summarize flow — summarize returns fewer tokens', async () => {
    const largeShellOutput = [
      '$ npm install',
      'npm warn deprecated inflight@1.0.6: This module is not supported',
      'npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported',
      'added 847 packages, and audited 848 packages in 32s',
      '114 packages are looking for funding',
      '  run `npm fund` for details',
      'found 0 vulnerabilities',
      '$ npm test',
      '> context-mem@0.1.0 test',
      '> node --test',
      'TAP version 13',
      '# Subtest: test suite',
      'ok 1 - should pass',
      'ok 2 - should also pass',
      '1..2',
      '# tests 2',
      '# pass 2',
      '# fail 0',
    ].join('\n');

    // Observe the content
    const observeResult = await client.callTool({
      name: 'observe',
      arguments: { content: largeShellOutput },
    });
    assert.ok(!observeResult.isError, 'observe should not error');

    // Summarize the same content
    const summarizeResult = await client.callTool({
      name: 'summarize',
      arguments: { content: largeShellOutput },
    });
    assert.ok(!summarizeResult.isError, 'summarize should not error');
    const summary = parseResult<{
      summary: string;
      tokens_original: number;
      tokens_summarized: number;
      savings_pct: number;
    }>(summarizeResult as { content: Array<{ type: string; text?: string }> });
    assert.ok(summary.tokens_summarized <= summary.tokens_original, 'summarized tokens should be <= original');
    assert.ok(summary.summary.length > 0, 'summary should not be empty');
  });

  // Test 4: timeline returns chronological observations
  it('timeline returns reverse-chronological observations', async () => {
    // Observe 5 items with small delays to ensure distinct timestamps
    const contents = [
      'Timeline item alpha — first entry',
      'Timeline item beta — second entry',
      'Timeline item gamma — third entry',
      'Timeline item delta — fourth entry',
      'Timeline item epsilon — fifth entry',
    ];

    for (const content of contents) {
      await client.callTool({
        name: 'observe',
        arguments: { content, type: 'context' },
      });
      // Small delay to ensure different indexed_at timestamps
      await new Promise(resolve => setTimeout(resolve, 15));
    }

    const timelineResult = await client.callTool({
      name: 'timeline',
      arguments: { limit: 5 },
    });
    assert.ok(!timelineResult.isError, 'timeline should not error');
    const entries = parseResult<Array<{ id: string; type: string; summary: string | null; timestamp: number }>>(
      timelineResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(entries.length >= 5, `Expected at least 5 timeline entries, got ${entries.length}`);

    // Verify reverse-chronological order (newest first)
    for (let i = 1; i < entries.length; i++) {
      assert.ok(
        entries[i - 1].timestamp >= entries[i].timestamp,
        `Entry ${i - 1} (ts=${entries[i - 1].timestamp}) should be >= entry ${i} (ts=${entries[i].timestamp})`,
      );
    }
  });

  // Test 5: stats tracks token economics across operations
  it('stats tracks token economics across operations', async () => {
    // We already observed several items above; now search
    await client.callTool({
      name: 'search',
      arguments: { query: 'timeline item' },
    });

    const statsResult = await client.callTool({
      name: 'stats',
      arguments: {},
    });
    assert.ok(!statsResult.isError, 'stats should not error');
    const stats = parseResult<{
      session_id: string;
      observations_stored: number;
      searches_performed: number;
      tokens_saved: number;
      savings_percentage: number;
      total_content_bytes: number;
    }>(statsResult as { content: Array<{ type: string; text?: string }> });
    assert.ok(stats.observations_stored > 0, 'Should have observations stored');
    assert.equal(stats.session_id, toolKernel.sessionId);
    assert.equal(typeof stats.searches_performed, 'number');
    assert.equal(typeof stats.tokens_saved, 'number');
    assert.ok(stats.total_content_bytes > 0, 'Should have content bytes tracked');
  });

  // Test 6: configure tool updates runtime config
  it('configure updates runtime config', async () => {
    const configResult = await client.callTool({
      name: 'configure',
      arguments: { key: 'privacy.strip_tags', value: false },
    });
    assert.ok(!configResult.isError, 'configure should not error');
    const result = parseResult<{ updated: boolean; key: string; value: unknown }>(
      configResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.equal(result.updated, true);
    assert.equal(result.key, 'privacy.strip_tags');
    assert.equal(result.value, false);
  });

  // Test 7: configure rejects forbidden keys
  it('configure rejects prototype pollution keys', async () => {
    const configResult = await client.callTool({
      name: 'configure',
      arguments: { key: '__proto__.polluted', value: true },
    });
    // Error is returned in the JSON payload, not as isError (server catches and returns result)
    const result = parseResult<{ error: string }>(
      configResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(result.error, 'Should return an error');
    assert.match(result.error, /Forbidden/);
  });

  // Test 8: execute tool disabled by default
  it('execute tool is disabled by default', async () => {
    const execResult = await client.callTool({
      name: 'execute',
      arguments: { code: 'console.log("hi")' },
    });
    const result = parseResult<{ error: string }>(
      execResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(result.error, 'Should return an error');
    assert.match(result.error, /disabled/i);
  });

  // Test 9: Unknown tool returns error
  it('unknown tool returns error via protocol', async () => {
    const result = await client.callTool({
      name: 'nonexistent_tool',
      arguments: {},
    });
    assert.ok(result.isError, 'Unknown tool should set isError');
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    assert.match(text, /Unknown tool/);
  });

  // Test 10: Input validation via protocol
  it('input validation: empty content for observe', async () => {
    const result = await client.callTool({
      name: 'observe',
      arguments: { content: '' },
    });
    const parsed = parseResult<{ error: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(parsed.error, 'Should return error for empty content');
    assert.match(parsed.error, /content is required/);
  });

  it('input validation: negative limit for search is clamped', async () => {
    // Negative limit should be clamped to MIN_LIMIT (1) and still return valid results
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'test', limit: -1 },
    });
    assert.ok(!result.isError, 'search with negative limit should not throw');
    const parsed = parseResult<Array<unknown>>(
      result as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(Array.isArray(parsed), 'Should return an array');
    assert.ok(parsed.length <= 1, 'Clamped limit should return at most 1 result');
  });

  it('input validation: invalid observation type falls back to context', async () => {
    const result = await client.callTool({
      name: 'observe',
      arguments: { content: 'content with invalid type', type: 'invalid_type' },
    });
    assert.ok(!result.isError, 'Should not error — invalid type falls back to context');
    const parsed = parseResult<{ id: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    );
    assert.ok(parsed.id, 'Should still create an observation');

    // Verify the stored type is 'context' (the fallback)
    const getResult = await client.callTool({
      name: 'get',
      arguments: { id: parsed.id },
    });
    const detail = parseResult<{ type: string }>(
      getResult as { content: Array<{ type: string; text?: string }> },
    );
    assert.equal(detail.type, 'context', 'Invalid type should fall back to context');
  });
});
