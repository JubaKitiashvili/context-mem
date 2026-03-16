import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Kernel } from '../../core/kernel.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-kernel-test-'));
}

describe('Kernel', () => {
  describe('kernel starts with default config', () => {
    let kernel: Kernel;
    let tmpDir: string;

    before(async () => {
      tmpDir = makeTempDir();
      kernel = new Kernel(tmpDir);
      await kernel.start();
    });

    after(async () => {
      await kernel.stop();
    });

    it('starts without errors', () => {
      assert.ok(kernel, 'kernel should be defined');
      assert.ok(kernel.session.session_id, 'session_id should be set');
      assert.ok(kernel.session.started_at > 0, 'started_at should be set');
    });
  });

  describe('kernel registers built-in plugins', () => {
    let kernel: Kernel;
    let tmpDir: string;

    before(async () => {
      tmpDir = makeTempDir();
      kernel = new Kernel(tmpDir);
      await kernel.start();
    });

    after(async () => {
      await kernel.stop();
    });

    it('has storage plugin registered', () => {
      const storage = kernel.registry.get('storage');
      assert.ok(storage, 'storage plugin should be registered');
      assert.equal(storage.type, 'storage');
    });

    it('has summarizer plugins registered', () => {
      const summarizers = kernel.registry.getAll('summarizer');
      assert.ok(summarizers.length > 0, 'should have at least one summarizer registered');
    });

    it('has search plugins registered', () => {
      const searchPlugins = kernel.registry.getAll('search');
      assert.ok(searchPlugins.length >= 2, 'should have bm25 and trigram search plugins');
    });
  });

  describe('kernel.search works', () => {
    let kernel: Kernel;
    let tmpDir: string;

    before(async () => {
      tmpDir = makeTempDir();
      kernel = new Kernel(tmpDir);
      await kernel.start();
      // Observe some content so there is something to search
      await kernel.observe('the quick brown fox jumps over the lazy dog', 'context', 'test-source');
    });

    after(async () => {
      await kernel.stop();
    });

    it('returns search results for matching query', async () => {
      const results = await kernel.search('quick brown fox');
      assert.ok(Array.isArray(results), 'should return an array');
      assert.ok(results.length > 0, 'should find at least one result');
    });
  });

  describe('kernel.get works', () => {
    let kernel: Kernel;
    let tmpDir: string;
    let observedId: string;

    before(async () => {
      tmpDir = makeTempDir();
      kernel = new Kernel(tmpDir);
      await kernel.start();
      const obs = await kernel.observe('hello world get test content', 'context', 'test-source');
      observedId = obs.id;
    });

    after(async () => {
      await kernel.stop();
    });

    it('returns full observation by id', async () => {
      const obs = await kernel.get(observedId);
      assert.ok(obs, 'observation should be found');
      assert.equal(obs.id, observedId);
      assert.equal(obs.type, 'context');
      assert.ok(obs.content.includes('hello world'), 'content should include observed text');
    });

    it('returns null for unknown id', async () => {
      const obs = await kernel.get('nonexistent-id-00000000000');
      assert.equal(obs, null);
    });
  });

  describe('kernel.stats works', () => {
    let kernel: Kernel;
    let tmpDir: string;

    before(async () => {
      tmpDir = makeTempDir();
      kernel = new Kernel(tmpDir);
      await kernel.start();
      await kernel.observe('content for stats tracking check', 'context', 'test-source');
    });

    after(async () => {
      await kernel.stop();
    });

    it('returns TokenEconomics with correct session_id', async () => {
      const stats = await kernel.stats();
      assert.equal(stats.session_id, kernel.session.session_id);
    });

    it('has at least one observation stored', async () => {
      const stats = await kernel.stats();
      assert.ok(stats.observations_stored >= 1, 'should have at least one stored observation');
    });

    it('has non-negative token counts', async () => {
      const stats = await kernel.stats();
      assert.ok(stats.total_content_bytes >= 0);
      assert.ok(stats.total_summary_bytes >= 0);
      assert.ok(stats.tokens_saved >= 0);
      assert.ok(stats.savings_percentage >= 0);
    });
  });

  describe('kernel shuts down cleanly', () => {
    let kernel: Kernel;
    let tmpDir: string;

    before(async () => {
      tmpDir = makeTempDir();
      kernel = new Kernel(tmpDir);
      await kernel.start();
      // Observe a private item so stop() has something to clean up
      await kernel.observe('<private>secret data</private> some public part', 'context', 'test-source');
    });

    it('stops without errors', async () => {
      await kernel.stop();
      // Registry should be cleared after shutdown
      assert.equal(kernel.registry.size, 0, 'registry should be empty after stop');
    });
  });
});
