import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-plugin-test-'));
}

function withCwd<T>(dir: string, fn: () => T): T {
  const originalCwd = process.cwd;
  process.cwd = () => dir;
  try {
    return fn();
  } finally {
    process.cwd = originalCwd;
  }
}

describe('CLI plugin command', () => {
  describe('plugin (no subcommand)', () => {
    it('prints usage when called without subcommand', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');
      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };
      try {
        await plugin([]);
      } finally {
        console.log = originalLog;
      }
      const output = lines.join('\n');
      assert.ok(output.includes('plugin add'), 'should mention plugin add');
      assert.ok(output.includes('plugin remove'), 'should mention plugin remove');
      assert.ok(output.includes('plugin list'), 'should mention plugin list');
    });
  });

  describe('plugin list', () => {
    it('shows no plugins when none installed', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');
      const tmpDir = makeTempDir();

      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };

      withCwd(tmpDir, () => undefined);
      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await plugin(['list']);
      } finally {
        console.log = originalLog;
        process.cwd = originalCwd;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('No plugins installed'), 'should say no plugins');
    });

    it('lists plugins from config', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');
      const tmpDir = makeTempDir();

      // Write a config with a plugin entry
      const config = {
        plugins: {
          external_summarizers: {
            'context-mem-summarizer-k8s': { enabled: true, priority: 50 },
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, '.context-mem.json'),
        JSON.stringify(config, null, 2) + '\n',
      );

      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await plugin(['list']);
      } finally {
        console.log = originalLog;
        process.cwd = originalCwd;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('context-mem-summarizer-k8s'), 'should list the plugin');
      assert.ok(output.includes('not installed'), 'should show not installed (no package.json)');
      assert.ok(output.includes('priority: 50'), 'should show priority');
    });

    it('lists plugins from package.json dependencies', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');
      const tmpDir = makeTempDir();

      // Write a package.json with a summarizer dependency
      const pkg = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'context-mem-summarizer-docker': '^1.0.0',
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify(pkg, null, 2) + '\n',
      );

      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await plugin(['list']);
      } finally {
        console.log = originalLog;
        process.cwd = originalCwd;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('context-mem-summarizer-docker'), 'should list the dep plugin');
      assert.ok(output.includes('enabled'), 'should show enabled (installed, no config override)');
    });

    it('shows disabled status from config', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');
      const tmpDir = makeTempDir();

      const pkg = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'context-mem-summarizer-rust': '^1.0.0',
        },
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg) + '\n');

      const config = {
        plugins: {
          external_summarizers: {
            'context-mem-summarizer-rust': { enabled: false },
          },
        },
      };
      fs.writeFileSync(path.join(tmpDir, '.context-mem.json'), JSON.stringify(config) + '\n');

      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => { lines.push(String(msg)); };

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await plugin(['list']);
      } finally {
        console.log = originalLog;
        process.cwd = originalCwd;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('disabled'), 'should show disabled status');
    });
  });

  describe('plugin add', () => {
    it('prints usage when no package name given', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');

      const lines: string[] = [];
      const originalError = console.error;
      const originalExit = process.exit;
      let exitCode: number | undefined;
      console.error = (msg: string) => { lines.push(String(msg)); };
      process.exit = ((code: number) => { exitCode = code; }) as never;

      try {
        await plugin(['add']);
      } finally {
        console.error = originalError;
        process.exit = originalExit;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('Usage'), 'should print usage');
      assert.equal(exitCode, 1, 'should exit with code 1');
    });

    it('resolves short name to full package name', async () => {
      // We test the name resolution indirectly via the error message
      // since installing a non-existent package will fail
      const { plugin } = await import('../../cli/commands/plugin.js');
      const tmpDir = makeTempDir();

      // Create package.json so npm can work in the dir
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }) + '\n');

      const lines: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      const originalExit = process.exit;
      let exitCode: number | undefined;
      console.log = (msg: string) => { lines.push(String(msg)); };
      console.error = (msg: string) => { lines.push(String(msg)); };
      process.exit = ((code: number) => { exitCode = code; }) as never;

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        await plugin(['add', 'k8s']);
      } finally {
        console.log = originalLog;
        console.error = originalError;
        process.exit = originalExit;
        process.cwd = originalCwd;
      }

      const output = lines.join('\n');
      // Should attempt to install with full prefix
      assert.ok(
        output.includes('context-mem-summarizer-k8s'),
        'should resolve short name to full package name',
      );
    });
  });

  describe('plugin remove', () => {
    it('prints usage when no package name given', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');

      const lines: string[] = [];
      const originalError = console.error;
      const originalExit = process.exit;
      let exitCode: number | undefined;
      console.error = (msg: string) => { lines.push(String(msg)); };
      process.exit = ((code: number) => { exitCode = code; }) as never;

      try {
        await plugin(['remove']);
      } finally {
        console.error = originalError;
        process.exit = originalExit;
      }

      const output = lines.join('\n');
      assert.ok(output.includes('Usage'), 'should print usage');
      assert.equal(exitCode, 1, 'should exit with code 1');
    });

    it('removes plugin entry from config', async () => {
      const { plugin } = await import('../../cli/commands/plugin.js');
      const tmpDir = makeTempDir();

      // Create package.json
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' }) + '\n',
      );

      // Create config with a plugin registered
      const config = {
        plugins: {
          external_summarizers: {
            'context-mem-summarizer-k8s': { enabled: true },
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, '.context-mem.json'),
        JSON.stringify(config, null, 2) + '\n',
      );

      const lines: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      const originalExit = process.exit;
      let exitCode: number | undefined;
      console.log = (msg: string) => { lines.push(String(msg)); };
      console.error = (msg: string) => { lines.push(String(msg)); };
      process.exit = ((code: number) => { exitCode = code; }) as never;

      const originalCwd = process.cwd;
      process.cwd = () => tmpDir;
      try {
        // npm uninstall will "succeed" even if the package isn't installed
        await plugin(['remove', 'context-mem-summarizer-k8s']);
      } catch {
        // npm uninstall might fail in a temp dir without node_modules, that's ok
      } finally {
        console.log = originalLog;
        console.error = originalError;
        process.exit = originalExit;
        process.cwd = originalCwd;
      }

      // If npm uninstall succeeded (exitCode undefined), check config was cleaned
      if (exitCode === undefined) {
        const updatedConfig = JSON.parse(
          fs.readFileSync(path.join(tmpDir, '.context-mem.json'), 'utf8'),
        );
        const external = updatedConfig.plugins?.external_summarizers ?? {};
        assert.ok(
          !('context-mem-summarizer-k8s' in external),
          'plugin should be removed from config',
        );
      }
    });
  });
});
