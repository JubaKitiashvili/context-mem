import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Installation flow E2E', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-install-'));
    // Create editor dirs to trigger detection
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init creates all required files', async () => {
    // Run init programmatically
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    const { init } = await import('../../cli/commands/init.js');
    await init([]);
    process.chdir(origCwd);

    // Verify files
    assert.ok(fs.existsSync(path.join(tmpDir, '.context-mem.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.context-mem')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.mcp.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'settings.local.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.cursor', 'mcp.json')));
  });

  it('.mcp.json has correct MCP config', () => {
    const mcp = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf8'));
    assert.ok(mcp.mcpServers['context-mem']);
    assert.equal(mcp.mcpServers['context-mem'].command, 'npx');
  });

  it('.claude/settings.local.json has hooks configured', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(settings.hooks.SessionStart);
    assert.ok(settings.hooks.PostToolUse);
    assert.ok(settings.hooks.Stop);
  });

  it('hook script paths point to existing files', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf8'));
    for (const event of Object.keys(settings.hooks)) {
      for (const entry of settings.hooks[event]) {
        for (const hook of entry.hooks) {
          // Extract path from command: node "/path/to/script.js"
          const match = hook.command.match(/node "(.+?)"/);
          if (match) {
            assert.ok(fs.existsSync(match[1]), `Hook script missing: ${match[1]}`);
          }
        }
      }
    }
  });
});
