import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe, detectCommand } from './sandbox.js';

export class GoRuntime implements RuntimePlugin {
  name = 'go-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'go';
  extensions = ['.go'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    return detectCommand('go');
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;

    // Wrap in package main if not already present
    let source = code;
    if (!source.includes('package main')) {
      source = `package main\nimport "fmt"\nfunc main() {\n${code}\n}\n`;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-go-'));
    const tmpFile = join(tmpDir, 'script.go');

    writeFileSync(tmpFile, source, 'utf8');

    try {
      return await spawnSafe({
        cmd: 'go',
        args: ['run', tmpFile],
        timeout,
        env: opts.env,
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
