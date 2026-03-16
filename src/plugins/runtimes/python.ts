import { execFile } from 'node:child_process';
import fs, { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';

const MAX_OUTPUT = 10000;

function truncate(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT), truncated: true };
}

async function detectExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const found = await new Promise<boolean>(resolve => {
      execFile(candidate, ['--version'], { timeout: 5000 }, err => resolve(err === null));
    });
    if (found) return candidate;
  }
  return null;
}

export class PythonRuntime implements RuntimePlugin {
  name = 'python-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'python';
  extensions = ['.py'];

  private executable: string | null = null;

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    const exe = await detectExecutable(['python3', 'python']);
    if (exe !== null) {
      this.executable = exe;
      return true;
    }
    return false;
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;

    // Lazily resolve executable if detect() was not called first
    if (this.executable === null) {
      this.executable = await detectExecutable(['python3', 'python']);
    }

    if (this.executable === null) {
      return {
        stdout: '',
        stderr: 'python not found',
        exit_code: 127,
        duration_ms: 0,
        truncated: false,
      };
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'ctx-mem-py-'));
    const tmpFile = join(tmpDir, 'script.py');

    writeFileSync(tmpFile, code, 'utf8');

    const start = Date.now();

    return new Promise(resolve => {
      execFile(
        this.executable as string,
        [tmpFile],
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

          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

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
