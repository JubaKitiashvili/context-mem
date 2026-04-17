import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Kernel } from '../../core/kernel.js';
import { handleDiagnostics } from '../../mcp-server/tools.js';

describe('error-log E2E', () => {
  let projectDir: string;
  let kernel: Kernel;

  before(async () => {
    projectDir = path.join(os.tmpdir(), `cm-e2e-${Date.now()}`);
    fs.mkdirSync(projectDir, { recursive: true });
    kernel = new Kernel(projectDir);
    await kernel.start();
  });

  after(async () => {
    await kernel.stop?.();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('a direct logger call lands in error_log and is visible via diagnostics', async () => {
    kernel.errorLogger.log({ severity: 'error', category: 'embedder', message: 'e2e test failure' });
    await new Promise<void>(r => setTimeout(r, 50));

    const res = await handleDiagnostics(
      { mode: 'list', since: Date.now() - 10_000 },
      kernel as unknown as Parameters<typeof handleDiagnostics>[1],
    );
    assert.ok(res.rows.length >= 1);
    assert.ok(res.rows.some((r: { message?: string }) => r.message === 'e2e test failure'));
  });
});
