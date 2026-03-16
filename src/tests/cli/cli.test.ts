import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-cli-test-'));
}

describe('CLI commands', () => {
  describe('serve command exists', () => {
    it('is a function', async () => {
      const { serve } = await import('../../cli/commands/serve.js');
      assert.equal(typeof serve, 'function', 'serve should be a function');
    });
  });

  describe('init command', () => {
    it('creates config file and directory in temp dir', async () => {
      const { init } = await import('../../cli/commands/init.js');
      const tmpDir = makeTempDir();

      // Override cwd for this test
      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await init([]);
      } finally {
        process.cwd = originalCwd;
      }

      const configPath = path.join(tmpDir, '.context-mem.json');
      const dbDir = path.join(tmpDir, '.context-mem');

      assert.ok(fs.existsSync(configPath), '.context-mem.json should be created');
      assert.ok(fs.existsSync(dbDir), '.context-mem/ directory should be created');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.storage, 'auto', 'storage field should be auto');
      assert.equal(config.db_path, '.context-mem/store.db', 'db_path should be set');
    });

    it('does not overwrite existing config', async () => {
      const { init } = await import('../../cli/commands/init.js');
      const tmpDir = makeTempDir();

      // Pre-create a config
      const configPath = path.join(tmpDir, '.context-mem.json');
      fs.writeFileSync(configPath, JSON.stringify({ storage: 'custom' }) + '\n');

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await init([]);
      } finally {
        process.cwd = originalCwd;
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.storage, 'custom', 'existing config should not be overwritten');
    });

    it('adds .context-mem/ to .gitignore when present', async () => {
      const { init } = await import('../../cli/commands/init.js');
      const tmpDir = makeTempDir();

      const gitignorePath = path.join(tmpDir, '.gitignore');
      fs.writeFileSync(gitignorePath, 'node_modules/\n');

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await init([]);
      } finally {
        process.cwd = originalCwd;
      }

      const content = fs.readFileSync(gitignorePath, 'utf8');
      assert.ok(content.includes('.context-mem'), '.gitignore should include .context-mem');
    });
  });

  describe('status command', () => {
    it('handles missing database without crashing', async () => {
      const { status } = await import('../../cli/commands/status.js');
      const tmpDir = makeTempDir();

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      let threw = false;
      try {
        await status([]);
      } catch {
        threw = true;
      } finally {
        process.cwd = originalCwd;
      }

      assert.ok(!threw, 'status should not throw when database is missing');
    });
  });

  describe('doctor command', () => {
    it('runs without crashing and produces check output', async () => {
      const { doctor } = await import('../../cli/commands/doctor.js');
      const tmpDir = makeTempDir();

      // Capture stdout
      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await doctor([]);
      } finally {
        console.log = originalLog;
        process.cwd = originalCwd;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('SQLite'), 'output should include SQLite check');
      assert.ok(output.includes('Database'), 'output should include Database check');
      assert.ok(output.includes('Config'), 'output should include Config check');
      assert.ok(output.includes('Node.js'), 'output should include Node.js check');
    });

    it('reports Node.js version as OK for current runtime', async () => {
      const { doctor } = await import('../../cli/commands/doctor.js');
      const tmpDir = makeTempDir();

      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await doctor([]);
      } finally {
        console.log = originalLog;
        process.cwd = originalCwd;
      }

      const nodeLine = lines.find(l => l.includes('Node.js'));
      assert.ok(nodeLine, 'should have a Node.js check line');
      assert.ok(nodeLine!.includes('[OK]'), 'Node.js check should be OK for >=18');
    });
  });
});
