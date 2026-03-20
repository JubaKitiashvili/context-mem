import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe, detectCommand } from './sandbox.js';

export class RustRuntime implements RuntimePlugin {
  name = 'rust-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'rust';
  extensions = ['.rs'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    return detectCommand('rustc');
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;
    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-rs-'));
    const tmpFile = join(tmpDir, 'script.rs');
    const binaryFile = join(tmpDir, 'script');

    writeFileSync(tmpFile, code, 'utf8');

    try {
      // Step 1: Compile
      const compileResult = await spawnSafe({
        cmd: 'rustc',
        args: [tmpFile, '-o', binaryFile],
        timeout: 60_000,
        env: opts.env,
      });

      if (compileResult.exit_code !== 0) {
        return compileResult;
      }

      // Step 2: Execute the compiled binary
      return await spawnSafe({
        cmd: binaryFile,
        args: [],
        timeout,
        env: opts.env,
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
