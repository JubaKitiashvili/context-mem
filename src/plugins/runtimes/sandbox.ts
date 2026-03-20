import { spawn } from 'node:child_process';

// Environment variables that can be used for code injection
export const ENV_DENYLIST = new Set([
  // Node.js injection
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_HISTORY',
  // Python injection
  'PYTHONSTARTUP', 'PYTHONPATH', 'PYTHONHOME',
  // Ruby/Perl injection
  'RUBYOPT', 'RUBYLIB', 'PERL5OPT', 'PERL5LIB',
  // Dynamic linker injection
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
  // Compiler/toolchain hijacking
  'RUSTC_WRAPPER', 'GOFLAGS', 'GOPATH',
  'CFLAGS', 'CXXFLAGS', 'LDFLAGS',
  // Shell injection vectors
  'BASH_ENV', 'ENV', 'CDPATH', 'PROMPT_COMMAND',
  'PS1', 'PS2', 'PS4',
  // Editor/pager (can execute code)
  'EDITOR', 'VISUAL', 'PAGER', 'BROWSER',
  // Misc injection
  'IFS', 'SHELLOPTS', 'BASHOPTS', 'GLOBIGNORE',
  'MAIL', 'MAILPATH', 'MAILCHECK',
]);

export const SENSITIVE_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i;
export const MAX_OUTPUT_CHARS = 10_000;
export const DEFAULT_TIMEOUT_MS = 30_000;

export function buildSafeEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (!val) continue;
    if (ENV_DENYLIST.has(key)) continue;
    if (SENSITIVE_ENV_RE.test(key)) continue;
    env[key] = val;
  }
  env.LANG = 'en_US.UTF-8';
  env.NO_COLOR = '1';
  if (extraEnv) Object.assign(env, extraEnv);
  return env;
}

export interface SpawnSafeOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  truncated: boolean;
}

export function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_OUTPUT_CHARS) + '\n[truncated]', truncated: true };
}

export function spawnSafe(opts: SpawnSafeOpts): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
    const env = buildSafeEnv(opts.env);

    const proc = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      try {
        if (proc.pid && process.platform !== 'win32') {
          process.kill(-proc.pid, 'SIGKILL');
        } else {
          proc.kill('SIGKILL');
        }
      } catch { /* best-effort */ }
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const outT = truncateOutput(stdout);
      const errT = truncateOutput(stderr);
      resolve({
        stdout: outT.text,
        stderr: errT.text,
        exit_code: killed ? 124 : (code ?? 1),
        duration_ms: Date.now() - start,
        truncated: outT.truncated || errT.truncated,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        exit_code: 127,
        duration_ms: Date.now() - start,
        truncated: false,
      });
    });
  });
}

/** Check if a command is available on the system */
export async function detectCommand(cmd: string): Promise<boolean> {
  const result = await spawnSafe({ cmd, args: ['--version'], timeout: 5000 });
  return result.exit_code === 0;
}

/** Try multiple command candidates, return first that works */
export async function detectFirstAvailable(candidates: string[]): Promise<string | null> {
  for (const cmd of candidates) {
    if (await detectCommand(cmd)) return cmd;
  }
  return null;
}
