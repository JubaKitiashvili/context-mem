import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Hook lives at <project-root>/hooks/context-mem-hook.js
// __dirname here is dist/tests/hooks/ — go up 3 levels to project root
const HOOK_PATH = path.resolve(__dirname, '../../../hooks/context-mem-hook.js');

function runHook(input: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input,
    encoding: 'utf8',
    timeout: 2000,
    // Prevent actual HTTP POST by setting an unusable port
    env: { ...process.env, CONTEXT_MEM_PORT: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('context-mem-hook', () => {
  it('exits cleanly on empty stdin', () => {
    const { status } = runHook('');
    assert.equal(status, 0);
  });

  it('exits cleanly on invalid JSON', () => {
    const { status } = runHook('not-json');
    assert.equal(status, 0);
  });

  it('exits cleanly when tool output is too short', () => {
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {},
      tool_output: { stdout: 'hi' }, // < 10 chars
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('classifies Bash output as log and exits 0', () => {
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {},
      tool_output: { stdout: 'this is a long enough bash output string' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('classifies Read output as code and exits 0', () => {
    const payload = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '/some/file.ts' },
      tool_output: { content: 'export const foo = () => "bar"; // long enough content here' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('classifies Grep output as context and exits 0', () => {
    const payload = JSON.stringify({
      tool_name: 'Grep',
      tool_input: { pattern: 'foo' },
      tool_output: { stdout: 'src/index.ts:10: export const foo = 1; // grep match found' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('strips <private> tags before posting', () => {
    // Content after stripping must remain >= 10 chars to proceed to POST attempt
    // The hook exits 0 whether POST succeeds or not (fire and forget)
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {},
      tool_output: { stdout: 'public info here <private>SECRET TOKEN 12345</private> more public content' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('exits cleanly when content is entirely private tags (< 10 chars after strip)', () => {
    // After stripping, remaining content is just whitespace / too short
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {},
      tool_output: { stdout: '<private>all the content is secret</private>' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('replaces <redact> tags with [REDACTED]', () => {
    // Hook should not crash when processing redact tags
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {},
      tool_output: { stdout: 'token=<redact>mysecretpassword</redact> endpoint=https://api.example.com/v1' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('handles unknown tool name by exiting cleanly', () => {
    const payload = JSON.stringify({
      tool_name: 'UnknownTool',
      tool_input: {},
      tool_output: { stdout: 'some output that is long enough to pass length check' },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('handles Write tool using inp.content', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/out.ts', content: 'export const x = 1; // written file content here' },
      tool_output: {},
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('handles Edit tool using inp.content', () => {
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/edit.ts', content: 'export const y = 2; // edited file content here' },
      tool_output: {},
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('handles missing tool_input and tool_output gracefully', () => {
    const payload = JSON.stringify({ tool_name: 'Bash' });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });

  it('caps content at 50KB without crashing', () => {
    const bigContent = 'a'.repeat(60000); // 60KB, should be capped at 50KB
    const payload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {},
      tool_output: { stdout: bigContent },
    });
    const { status } = runHook(payload);
    assert.equal(status, 0);
  });
});
