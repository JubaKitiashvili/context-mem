import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Kernel } from '../../core/kernel.js';

describe('E2E Integration', () => {
  let kernel: Kernel;
  let tmpDir: string;

  afterEach(async () => {
    if (kernel) await kernel.stop();
    // Clean up temp dir
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  });

  it('full observe → search → get → stats cycle', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-e2e-'));
    kernel = new Kernel(tmpDir);
    await kernel.start();

    // Observe some content
    const obs = await kernel.pipeline.observe(
      'function authenticate(user: string, pass: string): boolean { return bcrypt.compare(pass, user.hash); }',
      'code',
      'Read'
    );
    assert.ok(obs.id);
    assert.equal(obs.type, 'code');

    // Search for it
    const searchResults = await kernel.search('authenticate');
    assert.ok(searchResults.length >= 1);
    assert.equal(searchResults[0].id, obs.id);

    // Get full content
    const full = await kernel.get(obs.id);
    assert.ok(full);
    assert.ok(full.content.includes('authenticate'));

    // Check stats
    const stats = await kernel.stats();
    assert.equal(stats.observations_stored, 1);
    assert.ok(stats.tokens_saved >= 0);
  });

  it('privacy: private content is cleaned on stop', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-e2e-'));
    kernel = new Kernel(tmpDir);
    await kernel.start();

    // Observe content with private tags
    const obs = await kernel.pipeline.observe(
      'public info <private>secret key 12345</private> more public',
      'context',
      'Bash'
    );
    assert.ok(obs.id);
    assert.ok(!obs.content.includes('secret key')); // Privacy stripped

    // Verify it's stored
    const found = await kernel.get(obs.id);
    assert.ok(found);

    // Stop should clean private observations — clear outer ref to prevent afterEach double-stop
    const kernelToStop = kernel;
    (kernel as Kernel | null) = null!;
    await kernelToStop.stop();

    // Re-open and verify private data is gone
    const kernel2 = new Kernel(tmpDir);
    await kernel2.start();
    const gone = await kernel2.get(obs.id);
    assert.equal(gone, null); // Cleaned up
    await kernel2.stop();
  });

  it('multiple observations with different types', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-e2e-'));
    kernel = new Kernel(tmpDir);
    await kernel.start();

    await kernel.pipeline.observe('TypeError: cannot read property x of undefined\n  at Object.<anonymous> (/app/index.js:10:5)\n  at Module._compile (internal/modules/cjs/loader.js:999:30)', 'error', 'Bash');
    await kernel.pipeline.observe('{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}', 'context', 'Bash');
    await kernel.pipeline.observe('const hello = () => "world";', 'code', 'Read');

    const stats = await kernel.stats();
    assert.equal(stats.observations_stored, 3);

    // Search should find error
    const results = await kernel.search('TypeError');
    assert.ok(results.length >= 1);
  });
});
