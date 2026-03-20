import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe, detectFirstAvailable } from './sandbox.js';

export class TypeScriptRuntime implements RuntimePlugin {
  name = 'typescript-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'typescript';
  extensions = ['.ts', '.tsx'];

  private executable: string | null = null;

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    const exe = await detectFirstAvailable(['bun', 'tsx', 'ts-node']);
    if (exe !== null) {
      this.executable = exe;
      return true;
    }
    return false;
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;

    if (this.executable === null) {
      this.executable = await detectFirstAvailable(['bun', 'tsx', 'ts-node']);
    }

    if (this.executable === null) {
      return {
        stdout: '',
        stderr: 'No TypeScript runner found (tried bun, tsx, ts-node)',
        exit_code: 127,
        duration_ms: 0,
        truncated: false,
      };
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-ts-'));
    const tmpFile = join(tmpDir, 'script.ts');

    writeFileSync(tmpFile, code, 'utf8');

    try {
      const args = this.executable === 'bun' ? ['run', tmpFile] : [tmpFile];
      return await spawnSafe({
        cmd: this.executable,
        args,
        timeout,
        env: opts.env,
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
