import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JavaScriptRuntime } from '../../../plugins/runtimes/javascript.js';
import { PythonRuntime } from '../../../plugins/runtimes/python.js';
import { ShellRuntime } from '../../../plugins/runtimes/shell.js';

describe('JavaScriptRuntime', () => {
  it('detects node', async () => {
    const runtime = new JavaScriptRuntime();
    const available = await runtime.detect();
    assert.equal(available, true);
  });

  it('executes code and captures stdout', async () => {
    const runtime = new JavaScriptRuntime();
    const result = await runtime.execute('console.log("hello")', {});
    assert.equal(result.exit_code, 0);
    assert.ok(result.stdout.includes('hello'), `expected "hello" in stdout, got: ${result.stdout}`);
  });

  it('returns non-zero exit code on error', async () => {
    const runtime = new JavaScriptRuntime();
    const result = await runtime.execute('process.exit(1)', {});
    assert.notEqual(result.exit_code, 0);
  });

  it('captures stderr', async () => {
    const runtime = new JavaScriptRuntime();
    const result = await runtime.execute('console.error("err-output")', {});
    assert.ok(result.stderr.includes('err-output'), `expected stderr to contain "err-output", got: ${result.stderr}`);
  });

  it('respects timeout and returns non-zero exit code or truncated flag', async () => {
    const runtime = new JavaScriptRuntime();
    const result = await runtime.execute('while(true){}', { timeout: 500 });
    const timedOut = result.exit_code !== 0 || result.truncated;
    assert.ok(timedOut, `expected timeout to cause exit_code != 0 or truncated, got exit_code=${result.exit_code}, truncated=${result.truncated}`);
  });
});

describe('PythonRuntime', () => {
  it('detects python (skipped if not installed)', async () => {
    const runtime = new PythonRuntime();
    const available = await runtime.detect();
    // On most systems python3 or python is available; if not, skip gracefully
    if (!available) {
      console.log('  (skipped: python not available on this system)');
      return;
    }
    assert.equal(available, true);
  });

  it('executes python code and captures stdout', async () => {
    const runtime = new PythonRuntime();
    const available = await runtime.detect();
    if (!available) {
      console.log('  (skipped: python not available on this system)');
      return;
    }
    const result = await runtime.execute('print("hello from python")', {});
    assert.equal(result.exit_code, 0);
    assert.ok(result.stdout.includes('hello from python'), `expected stdout to contain "hello from python", got: ${result.stdout}`);
  });

  it('respects timeout for python (skipped if not installed)', async () => {
    const runtime = new PythonRuntime();
    const available = await runtime.detect();
    if (!available) {
      console.log('  (skipped: python not available on this system)');
      return;
    }
    const result = await runtime.execute('while True: pass', { timeout: 500 });
    const timedOut = result.exit_code !== 0 || result.truncated;
    assert.ok(timedOut, `expected timeout to cause exit_code != 0 or truncated, got exit_code=${result.exit_code}, truncated=${result.truncated}`);
  });
});

describe('ShellRuntime', () => {
  it('always available (detect returns true)', async () => {
    const runtime = new ShellRuntime();
    const available = await runtime.detect();
    assert.equal(available, true);
  });

  it('executes shell command and captures stdout', async () => {
    const runtime = new ShellRuntime();
    const result = await runtime.execute('echo hello', {});
    assert.equal(result.exit_code, 0);
    assert.ok(result.stdout.includes('hello'), `expected "hello" in stdout, got: ${result.stdout}`);
  });

  it('captures shell stderr', async () => {
    const runtime = new ShellRuntime();
    const result = await runtime.execute('echo err-msg >&2', {});
    assert.ok(result.stderr.includes('err-msg'), `expected stderr to contain "err-msg", got: ${result.stderr}`);
  });

  it('returns non-zero exit code on failure', async () => {
    const runtime = new ShellRuntime();
    const result = await runtime.execute('exit 2', {});
    assert.notEqual(result.exit_code, 0);
  });

  it('respects timeout', async () => {
    const runtime = new ShellRuntime();
    const result = await runtime.execute('while true; do :; done', { timeout: 500 });
    const timedOut = result.exit_code !== 0 || result.truncated;
    assert.ok(timedOut, `expected timeout to cause exit_code != 0 or truncated, got exit_code=${result.exit_code}, truncated=${result.truncated}`);
  });
});
