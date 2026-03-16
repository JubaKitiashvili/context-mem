import { execFile } from 'node:child_process';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';

const MAX_OUTPUT = 10000;

function truncate(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT), truncated: true };
}

export class ShellRuntime implements RuntimePlugin {
  name = 'shell-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'shell';
  extensions = ['.sh', '.bash'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    return true;
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;
    const start = Date.now();

    return new Promise(resolve => {
      execFile(
        '/bin/sh',
        ['-c', code],
        { timeout, env: { ...process.env, ...(opts.env ?? {}) } },
        (err, rawStdout, rawStderr) => {
          const duration_ms = Date.now() - start;
          const stdoutResult = truncate(rawStdout ?? '');
          const stderrResult = truncate(rawStderr ?? '');

          let exit_code = 0;
          if (err) {
            const spawnErr = err as Error & { code?: string | number };
            if (spawnErr.code === 'ETIMEDOUT') {
              exit_code = 124;
            } else if (typeof spawnErr.code === 'number') {
              exit_code = spawnErr.code;
            } else {
              exit_code = 1;
            }
          }

          resolve({
            stdout: stdoutResult.text,
            stderr: stderrResult.text,
            exit_code,
            duration_ms,
            truncated: stdoutResult.truncated || stderrResult.truncated,
          });
        },
      );
    });
  }
}
