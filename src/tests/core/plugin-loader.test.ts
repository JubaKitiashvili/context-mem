import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-mem-plugin-test-'));
}

function writePackageJson(
  dir: string,
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }, null, 2),
  );
}

function createFakePlugin(
  dir: string,
  packageName: string,
  exports: Record<string, unknown>,
): void {
  const modDir = path.join(dir, 'node_modules', packageName);
  fs.mkdirSync(modDir, { recursive: true });
  const code = `module.exports = ${JSON.stringify(exports)};`;
  fs.writeFileSync(path.join(modDir, 'index.js'), code);
  fs.writeFileSync(
    path.join(modDir, 'package.json'),
    JSON.stringify({ name: packageName, main: './index.js' }),
  );
}

function createFakePluginWithFunctions(
  dir: string,
  packageName: string,
  opts: { name?: string; version?: string; priority?: number } = {},
): void {
  const modDir = path.join(dir, 'node_modules', packageName);
  fs.mkdirSync(modDir, { recursive: true });
  const code = `module.exports = {
    name: ${JSON.stringify(opts.name ?? packageName)},
    version: ${JSON.stringify(opts.version ?? '1.0.0')},
    type: 'summarizer',
    ${opts.priority !== undefined ? `priority: ${opts.priority},` : ''}
    detect: function(content) { return content.includes('MATCH'); },
    summarize: function(content) { return 'summarized: ' + content; },
    init: async function() {},
    destroy: async function() {},
  };`;
  fs.writeFileSync(path.join(modDir, 'index.js'), code);
  fs.writeFileSync(
    path.join(modDir, 'package.json'),
    JSON.stringify({ name: packageName, main: './index.js' }),
  );
}

describe('PluginLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no package.json exists', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.deepEqual(result, []);
  });

  it('returns empty array when no matching dependencies found', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    writePackageJson(tmpDir, { 'some-other-package': '1.0.0' });
    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.deepEqual(result, []);
  });

  it('discovers plugin with correct prefix', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const pkgName = 'context-mem-summarizer-test';
    writePackageJson(tmpDir, { [pkgName]: '1.0.0' });
    createFakePluginWithFunctions(tmpDir, pkgName);

    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, pkgName);
  });

  it('discovers plugins from devDependencies as well', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const pkgName = 'context-mem-summarizer-dev';
    writePackageJson(tmpDir, {}, { [pkgName]: '1.0.0' });
    createFakePluginWithFunctions(tmpDir, pkgName);

    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, pkgName);
  });

  it('skips package without detect/summarize methods', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const pkgName = 'context-mem-summarizer-broken';
    writePackageJson(tmpDir, { [pkgName]: '1.0.0' });
    // Create a plugin that exports an object without detect/summarize
    createFakePlugin(tmpDir, pkgName, { name: pkgName, version: '1.0.0' });

    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.equal(result.length, 0);
  });

  it('skips missing/broken plugins silently', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    writePackageJson(tmpDir, { 'context-mem-summarizer-missing': '1.0.0' });
    // Don't create the actual module — it should not throw
    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.deepEqual(result, []);
  });

  it('respects enabled/disabled config', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const pkgName = 'context-mem-summarizer-disabled';
    writePackageJson(tmpDir, { [pkgName]: '1.0.0' });
    createFakePluginWithFunctions(tmpDir, pkgName);

    const config = {
      ...DEFAULT_CONFIG,
      plugins: {
        ...DEFAULT_CONFIG.plugins,
        external_summarizers: {
          [pkgName]: { enabled: false },
        },
      },
    };

    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir, config);
    assert.equal(result.length, 0);
  });

  it('priority ordering works — lower priority comes first', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const pkgA = 'context-mem-summarizer-aaa';
    const pkgB = 'context-mem-summarizer-bbb';
    writePackageJson(tmpDir, { [pkgA]: '1.0.0', [pkgB]: '1.0.0' });
    createFakePluginWithFunctions(tmpDir, pkgA, { priority: 950 });
    createFakePluginWithFunctions(tmpDir, pkgB, { priority: 50 });

    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, pkgB); // priority 50 first
    assert.equal(result[1].name, pkgA); // priority 950 second
  });

  it('config priority override takes effect', async () => {
    const { PluginLoader } = await import('../../core/plugin-loader.js');
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const pkgA = 'context-mem-summarizer-alpha';
    const pkgB = 'context-mem-summarizer-beta';
    writePackageJson(tmpDir, { [pkgA]: '1.0.0', [pkgB]: '1.0.0' });
    // pkgA has built-in priority 50, pkgB has 950
    createFakePluginWithFunctions(tmpDir, pkgA, { priority: 50 });
    createFakePluginWithFunctions(tmpDir, pkgB, { priority: 950 });

    // Override: make pkgB come first via config
    const config = {
      ...DEFAULT_CONFIG,
      plugins: {
        ...DEFAULT_CONFIG.plugins,
        external_summarizers: {
          [pkgB]: { enabled: true, priority: 10 },
        },
      },
    };

    const loader = new PluginLoader();
    const result = loader.loadSummarizers(tmpDir, config);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, pkgB); // overridden to priority 10
    assert.equal(result[1].name, pkgA); // original priority 50
  });
});
