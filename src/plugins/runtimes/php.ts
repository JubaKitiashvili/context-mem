import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe, detectCommand } from './sandbox.js';

export class PhpRuntime implements RuntimePlugin {
  name = 'php-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'php';
  extensions = ['.php'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    return detectCommand('php');
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;

    // Prepend <?php if not already present
    let source = code;
    if (!source.trimStart().startsWith('<?php')) {
      source = `<?php\n${code}`;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-php-'));
    const tmpFile = join(tmpDir, 'script.php');

    writeFileSync(tmpFile, source, 'utf8');

    try {
      return await spawnSafe({
        cmd: 'php',
        args: [tmpFile],
        timeout,
        env: opts.env,
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
