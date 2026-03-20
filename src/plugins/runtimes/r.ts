import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe, detectFirstAvailable } from './sandbox.js';

export class RRuntime implements RuntimePlugin {
  name = 'r-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'r';
  extensions = ['.r', '.R'];

  private executable: string | null = null;

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    const exe = await detectFirstAvailable(['Rscript', 'r']);
    if (exe !== null) {
      this.executable = exe;
      return true;
    }
    return false;
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;

    if (this.executable === null) {
      this.executable = await detectFirstAvailable(['Rscript', 'r']);
    }

    if (this.executable === null) {
      return {
        stdout: '',
        stderr: 'No R runtime found (tried Rscript, r)',
        exit_code: 127,
        duration_ms: 0,
        truncated: false,
      };
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-r-'));
    const tmpFile = join(tmpDir, 'script.R');

    writeFileSync(tmpFile, code, 'utf8');

    try {
      return await spawnSafe({
        cmd: this.executable,
        args: [tmpFile],
        timeout,
        env: opts.env,
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
