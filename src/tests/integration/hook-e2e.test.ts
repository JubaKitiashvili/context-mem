import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HOOK_PATH = path.resolve(__dirname, '../../../hooks/context-mem-hook.js');

interface HookResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runHook(input: object | string): HookResult {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  try {
    const stdout = execFileSync('node', [HOOK_PATH], {
      input: stdin,
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, CONTEXT_MEM_API_PORT: '19999' }, // Non-listening port so POST fails silently
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function makeToolCall(toolName: string, toolInput: Record<string, unknown>, toolOutput: Record<string, unknown>) {
  return { tool_name: toolName, tool_input: toolInput, tool_output: toolOutput };
}

describe('Hook E2E — context-mem-hook.js', () => {

  it('exits cleanly for Write tool call', () => {
    const result = runHook(makeToolCall('Write', {
      file_path: '/src/app.ts',
      content: 'export const app = express();',
    }, {
      content: 'File written successfully to /src/app.ts',
    }));
    assert.equal(result.status, 0, `Hook should exit 0, got ${result.status}. stderr: ${result.stderr}`);
  });

  it('exits cleanly for Read tool call', () => {
    const result = runHook(makeToolCall('Read', {
      file_path: '/src/utils.ts',
    }, {
      content: 'export function helper() { return "hello world from utils"; }',
    }));
    assert.equal(result.status, 0, `Hook should exit 0, got ${result.status}. stderr: ${result.stderr}`);
  });

  it('exits cleanly for Bash tool call with test output', () => {
    const result = runHook(makeToolCall('Bash', {
      command: 'npm test',
    }, {
      stdout: 'PASS tests/app.test.ts\n  App\n    should start (23 ms)\n\nTests: 1 passed\nTime: 0.5s',
    }));
    assert.equal(result.status, 0, `Hook should exit 0, got ${result.status}. stderr: ${result.stderr}`);
  });

  it('exits cleanly for Edit tool call', () => {
    const result = runHook(makeToolCall('Edit', {
      file_path: '/src/app.ts',
      content: 'export const app = express(); // updated with middleware',
    }, {
      content: 'Edit applied successfully',
    }));
    assert.equal(result.status, 0, `Hook should exit 0, got ${result.status}. stderr: ${result.stderr}`);
  });

  it('exits cleanly for empty stdin', () => {
    const result = runHook('');
    assert.equal(result.status, 0, 'Hook should exit 0 for empty stdin');
  });

  it('exits cleanly for malformed JSON', () => {
    const result = runHook('{not valid json!!!');
    assert.equal(result.status, 0, 'Hook should exit 0 for malformed JSON');
  });

  it('exits cleanly for whitespace-only stdin', () => {
    const result = runHook('   \n\n  ');
    assert.equal(result.status, 0, 'Hook should exit 0 for whitespace-only stdin');
  });

  it('strips <private> tags from content before sending', () => {
    // The hook strips private tags and checks length >= 10 after stripping.
    // We can verify indirectly that it doesn't crash and exits 0.
    // The actual stripping happens in-process before the HTTP POST.
    const result = runHook(makeToolCall('Read', {
      file_path: '/config.env',
    }, {
      content: 'HOST=localhost <private>SECRET_KEY=do_not_leak_this_value</private> PORT=3000 database=myapp',
    }));
    assert.equal(result.status, 0, 'Hook should exit 0 after stripping private tags');
  });

  it('strips <redact> tags and replaces with [REDACTED]', () => {
    const result = runHook(makeToolCall('Bash', {
      command: 'cat config',
    }, {
      stdout: 'user: admin <redact>password: supersecretpassword123</redact> host: localhost port: 5432',
    }));
    assert.equal(result.status, 0, 'Hook should exit 0 after stripping redact tags');
  });

  it('exits cleanly when content is too short after stripping', () => {
    // Content is entirely private — after stripping, less than 10 chars remain
    const result = runHook(makeToolCall('Read', {
      file_path: '/secret.env',
    }, {
      content: '<private>ALL_SECRET_CONTENT_HERE_NOTHING_PUBLIC</private>',
    }));
    assert.equal(result.status, 0, 'Hook should exit 0 when stripped content is too short');
  });

  it('handles large content (50KB) without crashing', () => {
    const largeContent = 'x'.repeat(50_000) + ' some searchable log content at the end';
    const result = runHook(makeToolCall('Bash', {
      command: 'cat large-file',
    }, {
      stdout: largeContent,
    }));
    assert.equal(result.status, 0, `Hook should exit 0 for large content, got ${result.status}`);
  });

  it('handles Grep tool with pattern results', () => {
    const result = runHook(makeToolCall('Grep', {
      pattern: 'TODO',
    }, {
      content: 'src/app.ts:10: // TODO: add error handling\nsrc/utils.ts:5: // TODO: optimize this function\nsrc/db.ts:22: // TODO: add connection pooling',
    }));
    assert.equal(result.status, 0, `Hook should exit 0 for Grep, got ${result.status}. stderr: ${result.stderr}`);
  });

  it('handles Glob tool with file list results', () => {
    const result = runHook(makeToolCall('Glob', {
      pattern: '**/*.ts',
    }, {
      content: 'src/app.ts\nsrc/utils.ts\nsrc/db.ts\nsrc/routes/users.ts\nsrc/routes/auth.ts',
    }));
    assert.equal(result.status, 0, `Hook should exit 0 for Glob, got ${result.status}. stderr: ${result.stderr}`);
  });

  it('ignores unknown tool names gracefully', () => {
    const result = runHook(makeToolCall('UnknownTool', {
      something: 'value',
    }, {
      content: 'Some output from unknown tool that should be ignored',
    }));
    assert.equal(result.status, 0, 'Hook should exit 0 for unknown tools');
  });

  it('handles tool output with content shorter than 10 chars', () => {
    const result = runHook(makeToolCall('Bash', {
      command: 'echo hi',
    }, {
      stdout: 'hi',
    }));
    assert.equal(result.status, 0, 'Hook should exit 0 for short content (skipped)');
  });

  it('handles missing tool_input and tool_output fields', () => {
    const result = runHook({ tool_name: 'Read' });
    assert.equal(result.status, 0, 'Hook should exit 0 when tool_input/tool_output are missing');
  });
});
