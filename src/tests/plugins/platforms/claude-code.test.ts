import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeAdapter } from '../../../plugins/platforms/claude-code.js';

describe('ClaudeCodeAdapter', () => {
  let originalEnv: string | undefined;
  let originalCwd: string;
  let tmpDir: string;

  before(() => {
    originalEnv = process.env.CLAUDE_CODE_ENTRYPOINT;
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-mem-claude-test-'));
  });

  after(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = originalEnv;
    }
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectPlatform', () => {
    it('returns true when CLAUDE_CODE_ENTRYPOINT is set', () => {
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      process.env.CLAUDE_CODE_ENTRYPOINT = '/usr/local/bin/claude';
      const adapter = new ClaudeCodeAdapter();
      assert.equal(adapter.detectPlatform(), true);
    });

    it('returns true when .claude dir exists', () => {
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      // Create .claude dir in tmpDir and cd into it
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      process.chdir(tmpDir);
      const adapter = new ClaudeCodeAdapter();
      assert.equal(adapter.detectPlatform(), true);
    });

    it('returns false otherwise', () => {
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      // Use a tmpDir without .claude
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-mem-no-claude-'));
      process.chdir(emptyDir);
      const adapter = new ClaudeCodeAdapter();
      const result = adapter.detectPlatform();
      process.chdir(originalCwd);
      fs.rmSync(emptyDir, { recursive: true, force: true });
      assert.equal(result, false);
    });
  });

  describe('getHookFormat', () => {
    it('returns subprocess config', () => {
      const adapter = new ClaudeCodeAdapter();
      const config = adapter.getHookFormat();
      assert.equal(config.type, 'subprocess');
      assert.equal(config.hook_script, 'hooks/context-mem-hook.js');
      assert.ok(typeof config.settings_path === 'string', 'settings_path should be a string');
      assert.ok(config.settings_path!.endsWith(path.join('.claude', 'settings.json')));
    });
  });

  describe('getToolNames', () => {
    it('maps generic to Claude Code names', () => {
      const adapter = new ClaudeCodeAdapter();
      const names = adapter.getToolNames();
      assert.equal(names['observe'], 'context_mem_observe');
      assert.equal(names['summarize'], 'context_mem_summarize');
      assert.equal(names['search'], 'context_mem_search');
      assert.equal(names['timeline'], 'context_mem_timeline');
      assert.equal(names['get'], 'context_mem_get');
      assert.equal(names['stats'], 'context_mem_stats');
      assert.equal(names['configure'], 'context_mem_configure');
      assert.equal(names['execute'], 'context_mem_execute');
    });
  });

  describe('wrapMCPServer', () => {
    it('returns stdio config', () => {
      const adapter = new ClaudeCodeAdapter();
      const config = adapter.wrapMCPServer();
      assert.equal(config.port, 0);
      assert.equal(config.transport, 'stdio');
    });
  });

  it('satisfies Plugin interface', () => {
    const adapter = new ClaudeCodeAdapter();
    assert.equal(adapter.name, 'claude-code-adapter');
    assert.equal(adapter.version, '1.0.0');
    assert.equal(adapter.type, 'platform');
    assert.equal(adapter.platform, 'claude-code');
    assert.equal(typeof adapter.init, 'function');
    assert.equal(typeof adapter.destroy, 'function');
  });
});
