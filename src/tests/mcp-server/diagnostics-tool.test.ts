import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Kernel } from '../../core/kernel.js';
import { handleDiagnostics } from '../../mcp-server/tools.js';

describe('diagnostics MCP tool', () => {
  let projectDir: string;
  let kernel: Kernel;

  before(async () => {
    projectDir = path.join(os.tmpdir(), `cm-diag-${Date.now()}`);
    fs.mkdirSync(projectDir, { recursive: true });
    kernel = new Kernel(projectDir);
    await kernel.start();
  });

  beforeEach(() => {
    kernel.getStorage().exec('DELETE FROM error_log', []);
  });

  after(async () => {
    await kernel.stop?.();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns empty summary when no errors logged', async () => {
    const res = await handleDiagnostics({}, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.deepEqual(res.rows, []);
  });

  it('returns grouped summary in default mode', async () => {
    kernel.errorLogger.log({ severity: 'error', category: 'embedder', message: 'x' });
    kernel.errorLogger.log({ severity: 'error', category: 'entity', message: 'y' });
    await new Promise<void>(r => setTimeout(r, 30));

    const res = await handleDiagnostics({}, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.ok(res.rows.length >= 2);
    assert.ok(res.rows.some(r => (r as { category: string }).category === 'embedder'));
    assert.ok(res.rows.some(r => (r as { category: string }).category === 'entity'));
  });

  it('filters by severity', async () => {
    kernel.errorLogger.log({ severity: 'info', category: 'llm', message: 'a' });
    kernel.errorLogger.log({ severity: 'error', category: 'embedder', message: 'b' });
    await new Promise<void>(r => setTimeout(r, 30));

    const res = await handleDiagnostics({ severity: 'error' }, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.equal(res.rows.length, 1);
    assert.equal((res.rows[0] as { message: string }).message, 'b');
  });

  it('mode=list returns raw rows', async () => {
    kernel.errorLogger.log({ severity: 'error', category: 'embedder', message: 'raw' });
    await new Promise<void>(r => setTimeout(r, 30));

    const res = await handleDiagnostics({ mode: 'list' }, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.equal(res.mode, 'list');
    assert.ok(res.rows.length >= 1);
    assert.ok('id' in (res.rows[0] as object));
  });

  it('filters by category', async () => {
    kernel.errorLogger.log({ severity: 'error', category: 'embedder', message: 'e1' });
    kernel.errorLogger.log({ severity: 'error', category: 'entity', message: 'e2' });
    await new Promise<void>(r => setTimeout(r, 30));

    const res = await handleDiagnostics({ category: 'embedder' }, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.equal(res.rows.length, 1);
    assert.equal((res.rows[0] as { category: string }).category, 'embedder');
  });

  it('clamps limit to [1, 500]', async () => {
    const res1 = await handleDiagnostics({ limit: 0 }, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.deepEqual(res1.rows, []); // no rows; no crash
    const res2 = await handleDiagnostics({ limit: 10000 }, kernel as unknown as Parameters<typeof handleDiagnostics>[1]);
    assert.deepEqual(res2.rows, []);
  });
});
