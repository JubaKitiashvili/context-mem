import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe, detectCommand } from './sandbox.js';

export class ElixirRuntime implements RuntimePlugin {
  name = 'elixir-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'elixir';
  extensions = ['.ex', '.exs'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    return detectCommand('elixir');
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;
    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-exs-'));
    const tmpFile = join(tmpDir, 'script.exs');

    writeFileSync(tmpFile, code, 'utf8');

    try {
      return await spawnSafe({
        cmd: 'elixir',
        args: [tmpFile],
        timeout,
        env: opts.env,
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
