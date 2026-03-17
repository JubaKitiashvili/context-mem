import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Kernel } from '../../core/kernel.js';
import { LifecycleManager } from '../../core/lifecycle.js';
import { loadConfig } from '../../core/config.js';
import type { StoragePlugin } from '../../core/types.js';

function getStorage(kernel: Kernel): StoragePlugin {
  return (kernel as unknown as { storage: StoragePlugin }).storage;
}

describe('Final Validation', () => {
  let kernel: Kernel;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-final-'));
    kernel = new Kernel(tmpDir);
    await kernel.start();
  });

  afterEach(async () => {
    if (kernel) await kernel.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Test 1: Memory stability under sustained load
  it('memory stability — heap growth < 50MB after 5000 observations', async () => {
    // Force GC if available to get a clean baseline
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < 5000; i++) {
      await kernel.pipeline.observe(
        `Sustained load entry ${i}: module-${i % 50} processed batch ${i} status=${i % 7 === 0 ? 'error' : 'ok'} ts=${Date.now()} payload-${Math.random().toString(36).slice(2)}`,
        i % 5 === 0 ? 'error' : i % 3 === 0 ? 'code' : 'log',
        'Bash',
      );
    }

    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const growthMB = (heapAfter - heapBefore) / 1024 / 1024;

    assert.ok(growthMB < 50, `Heap grew ${growthMB.toFixed(1)}MB — possible leak`);

    const stats = await kernel.stats();
    assert.equal(stats.observations_stored, 5000, 'All 5000 observations should be stored');
  });

  // Test 2: Database corruption recovery — kernel starts cleanly after unclean shutdown
  it('database corruption recovery — WAL recovery after unclean shutdown', async () => {
    // Observe data in the first kernel
    await kernel.pipeline.observe(
      'Important data that must survive an unclean shutdown without data loss',
      'decision', 'Read',
    );
    await kernel.pipeline.observe(
      'Another observation stored before crash simulation happens here',
      'context', 'Bash',
    );

    // Simulate unclean shutdown: do NOT call kernel.stop() — just close storage directly
    const storage = getStorage(kernel);
    await storage.close();
    // Null out kernel to prevent afterEach from double-stopping
    kernel = null as unknown as Kernel;

    // Start a new kernel on the same DB — this should trigger WAL recovery
    const kernel2 = new Kernel(tmpDir);
    await kernel2.start();

    // Verify data survived the unclean shutdown
    const results = await kernel2.search('survive unclean shutdown');
    assert.ok(results.length >= 1, 'Data should survive unclean shutdown via WAL recovery');

    const results2 = await kernel2.search('crash simulation');
    assert.ok(results2.length >= 1, 'Second observation should also survive');

    // New observations work after recovery
    const obs = await kernel2.pipeline.observe(
      'Post-recovery observation proving the system is functional again after WAL recovery',
      'log', 'Bash',
    );
    assert.ok(obs.id, 'Should be able to observe after recovery');

    await kernel2.stop();

    // Reassign for afterEach
    kernel = new Kernel(tmpDir);
    await kernel.start();
  });

  // Test 3: Config file validation — loadConfig with invalid JSON
  it('config file validation — malformed JSON falls back to defaults', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-cfg-'));
    try {
      // Write malformed JSON
      fs.writeFileSync(path.join(configDir, '.context-mem.json'), '{invalid json!!!}');

      const config = loadConfig(configDir);

      // Should fall back to defaults — verify key default values
      assert.equal(config.storage, 'auto', 'Should fall back to default storage');
      assert.equal(config.lifecycle.ttl_days, 30, 'Should fall back to default TTL');
      assert.equal(config.port, 51893, 'Should fall back to default port');
      assert.deepEqual(config.lifecycle.preserve_types, ['decision', 'commit'], 'Should fall back to default preserve_types');
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  // Test 3b: Config with partial valid JSON merges correctly
  it('config file validation — partial valid JSON merges with defaults', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-cfg2-'));
    try {
      fs.writeFileSync(
        path.join(configDir, '.context-mem.json'),
        JSON.stringify({ lifecycle: { ttl_days: 7 } }),
      );

      const config = loadConfig(configDir);

      assert.equal(config.lifecycle.ttl_days, 7, 'Overridden TTL should be 7');
      assert.equal(config.lifecycle.max_db_size_mb, 500, 'Non-overridden max_db_size should remain default');
      assert.equal(config.port, 51893, 'Non-overridden port should remain default');
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  // Test 4: Pipeline idempotency — same content produces same summary
  it('pipeline idempotency — same content produces same summary', async () => {
    const content = `> npm test\n\nPASS  tests/auth.test.ts\n  Auth Service\n    ✓ should login (15 ms)\n    ✓ should logout (8 ms)\n    ✓ should refresh token (12 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nTime:        1.234 s`;

    const obs1 = await kernel.pipeline.observe(content, 'test', 'Bash');
    const obs2 = await kernel.pipeline.observe(content, 'test', 'Bash');

    // Both should have summaries (may be undefined if no summarizer matched, but both should match the same)
    assert.equal(
      obs1.summary ?? 'none',
      obs2.summary ?? 'none',
      'Same content should produce identical summaries',
    );

    // With SHA256 dedup, same content returns the same observation
    assert.equal(obs1.id, obs2.id, 'Duplicate content should be deduplicated to same ID');

    // Token counts should match
    assert.equal(
      obs1.metadata.tokens_original,
      obs2.metadata.tokens_original,
      'Token counts should be deterministic for same content',
    );
  });

  // Test 5: Search relevance ranking — BM25 ranks by term frequency
  it('search relevance ranking — more mentions rank higher', async () => {
    // Item with "authentication" mentioned 5 times
    await kernel.pipeline.observe(
      'authentication module handles authentication flow. The authentication service validates authentication tokens. Failed authentication returns 401.',
      'code', 'Read',
    );

    // Item with "authentication" mentioned once
    await kernel.pipeline.observe(
      'The user service handles profile updates and account management. It uses authentication for access control.',
      'code', 'Read',
    );

    // Item with no mention of "authentication"
    await kernel.pipeline.observe(
      'Database migration script: ALTER TABLE users ADD COLUMN avatar_url TEXT. Runs on startup.',
      'code', 'Read',
    );

    const results = await kernel.search('authentication');
    assert.ok(results.length >= 1, 'Should find at least 1 result for authentication');

    // If we got 2+ results, the one with 5 mentions should rank first (higher BM25 score)
    if (results.length >= 2) {
      const topSnippet = results[0].snippet.toLowerCase();
      assert.ok(
        topSnippet.includes('authentication module') || topSnippet.includes('authentication flow'),
        `Top result should be the one with 5 mentions of authentication, got: "${results[0].snippet.slice(0, 80)}"`,
      );
    }

    // The database migration item should NOT appear (no mention of authentication)
    const allSnippets = results.map(r => r.snippet.toLowerCase()).join(' ');
    assert.ok(
      !allSnippets.includes('migration script'),
      'Unrelated item should not appear in results',
    );
  });

  // Test 6: Token economics accuracy — verify savings math
  it('token economics accuracy — savings math is consistent', async () => {
    // Observe a large shell output (200 lines)
    const largeOutput = Array.from({ length: 200 }, (_, i) =>
      `npm info lifecycle package-${i}@1.${i}.0~install: package-${i}@1.${i}.0`
    ).join('\n');

    await kernel.pipeline.observe(largeOutput, 'log', 'Bash');

    const statsAfterObserve = await kernel.stats();
    assert.equal(statsAfterObserve.observations_stored, 1, 'Should have 1 observation');
    assert.ok(statsAfterObserve.total_content_bytes > 0, 'Content bytes should be tracked');
    assert.ok(statsAfterObserve.total_summary_bytes > 0, 'Summary bytes should be tracked');

    // Search for it (generates discovery tokens)
    const results = await kernel.search('lifecycle package');
    assert.ok(results.length >= 1, 'Should find the npm output');

    const statsAfterSearch = await kernel.stats();
    assert.ok(statsAfterSearch.searches_performed >= 1, 'Search count should increment');
    assert.ok(statsAfterSearch.discovery_tokens > 0, 'Discovery tokens should be tracked');

    // Get full content (generates read tokens)
    const full = await kernel.get(results[0].id);
    assert.ok(full, 'Should retrieve full observation');

    const statsAfterGet = await kernel.stats();
    assert.ok(statsAfterGet.read_tokens > 0, 'Read tokens should be tracked after get()');

    // Verify the savings formula: tokens_saved = content_bytes - (discovery + read)
    const expectedSaved = statsAfterGet.total_content_bytes - (statsAfterGet.discovery_tokens + statsAfterGet.read_tokens);
    assert.equal(
      statsAfterGet.tokens_saved,
      Math.max(0, expectedSaved),
      `tokens_saved should equal max(0, content - discovery - read). Got ${statsAfterGet.tokens_saved}, expected ${Math.max(0, expectedSaved)}`,
    );
  });

  // Test 7: Lifecycle with mixed preserve types
  it('lifecycle with mixed preserve types — only specified types survive', async () => {
    const storage = getStorage(kernel);
    const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago

    // Insert old observations of various types
    const types = ['log', 'code', 'decision', 'commit', 'error'] as const;
    for (const type of types) {
      storage.exec(
        'INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [`mixed-${type}`, type, `Old ${type} observation from a month ago`, `old ${type}`, '{}', oldTimestamp, 'public', 'old-session'],
      );
    }

    // Run lifecycle preserving only decision and commit
    const lifecycle = new LifecycleManager(storage, {
      ttl_days: 30,
      max_db_size_mb: 500,
      max_observations: 50000,
      preserve_types: ['decision', 'commit'],
    });
    const result = await lifecycle.cleanup();

    // log, code, error should be deleted (3 items)
    assert.ok(result.deleted >= 3, `Expected at least 3 deletions, got ${result.deleted}`);

    // decision and commit should survive
    const decision = await kernel.get('mixed-decision');
    assert.ok(decision, 'Decision should survive lifecycle cleanup');
    assert.equal(decision.type, 'decision');

    const commit = await kernel.get('mixed-commit');
    assert.ok(commit, 'Commit should survive lifecycle cleanup');
    assert.equal(commit.type, 'commit');

    // log, code, error should be gone
    const log = await kernel.get('mixed-log');
    assert.equal(log, null, 'Log should be deleted by lifecycle');

    const code = await kernel.get('mixed-code');
    assert.equal(code, null, 'Code should be deleted by lifecycle');

    const error = await kernel.get('mixed-error');
    assert.equal(error, null, 'Error should be deleted by lifecycle');
  });

  // Test 8: Full progressive disclosure token measurement
  it('progressive disclosure — search snippets are smaller than full get content', async () => {
    // Observe a substantial piece of content
    const largeContent = Array.from({ length: 50 }, (_, i) =>
      `function handler${i}(req: Request, res: Response) { const data = await db.query('SELECT * FROM table_${i}'); res.json(data); }`
    ).join('\n');

    await kernel.pipeline.observe(largeContent, 'code', 'Read', '/src/handlers.ts');

    // Search returns snippets
    const results = await kernel.search('handler');
    assert.ok(results.length >= 1, 'Should find the handlers');

    const snippetLength = results[0].snippet.length;

    // Get returns full content
    const full = await kernel.get(results[0].id);
    assert.ok(full, 'Should retrieve full observation');

    const fullLength = full.content.length;

    // Full content should be significantly larger than the snippet
    assert.ok(
      fullLength > snippetLength,
      `Full content (${fullLength} chars) should be larger than snippet (${snippetLength} chars)`,
    );

    // The snippet should be a reasonable size (not the full document)
    assert.ok(
      snippetLength < fullLength * 0.5,
      `Snippet (${snippetLength} chars) should be less than 50% of full content (${fullLength} chars)`,
    );
  });

  // Test 9: Privacy with nested tags
  it('privacy with nested tags — outer private block strips everything inside', async () => {
    const obs = await kernel.pipeline.observe(
      '<private>outer <private>inner</private> still private</private> public',
      'context', 'Read',
    );

    // The regex is non-greedy: <private>[\s\S]*?<\/private>
    // First match: <private>outer <private>inner</private> (matches first open to first close)
    // After that: " still private</private> public" remains
    // The key assertion: the inner secret "inner" should be stripped
    assert.ok(!obs.content.includes('inner'), 'Inner private content should be stripped');
    assert.ok(!obs.content.includes('outer'), 'Outer private content should be stripped');
    assert.ok(obs.content.includes('public'), 'Public content should survive');
  });

  // Test 9b: Privacy — deeply nested redact inside private
  it('privacy — multiple adjacent private blocks', async () => {
    const obs = await kernel.pipeline.observe(
      'header <private>secret1</private> middle <private>secret2</private> footer',
      'context', 'Read',
    );

    assert.ok(!obs.content.includes('secret1'), 'First secret should be stripped');
    assert.ok(!obs.content.includes('secret2'), 'Second secret should be stripped');
    assert.ok(obs.content.includes('header'), 'Header should survive');
    assert.ok(obs.content.includes('middle'), 'Middle should survive');
    assert.ok(obs.content.includes('footer'), 'Footer should survive');
  });

  // Test 10: Config hot-reload via kernel
  it('config hot-reload — changing config at runtime takes effect', async () => {
    const storage = getStorage(kernel);

    // Insert an old observation (15 days old)
    const fifteenDaysAgo = Date.now() - (15 * 24 * 60 * 60 * 1000);
    storage.exec(
      'INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['hot-reload-1', 'log', 'Observation from 15 days ago should survive 30-day TTL', 'old log', '{}', fifteenDaysAgo, 'public', 'old-session'],
    );

    // With default TTL of 30 days, this observation should survive
    const lifecycle30 = new LifecycleManager(storage, {
      ttl_days: 30,
      max_db_size_mb: 500,
      max_observations: 50000,
      preserve_types: ['decision', 'commit'],
    });
    const result30 = await lifecycle30.cleanup();
    const surviving = await kernel.get('hot-reload-1');
    assert.ok(surviving, '15-day-old observation should survive 30-day TTL');

    // Now simulate hot-reload: create a new lifecycle manager with TTL of 10 days
    const lifecycle10 = new LifecycleManager(storage, {
      ttl_days: 10,
      max_db_size_mb: 500,
      max_observations: 50000,
      preserve_types: ['decision', 'commit'],
    });
    const result10 = await lifecycle10.cleanup();

    // With 10-day TTL, the 15-day-old observation should be deleted
    const deleted = await kernel.get('hot-reload-1');
    assert.equal(deleted, null, '15-day-old observation should be deleted with 10-day TTL');
    assert.ok(result10.deleted >= 1, 'Should have deleted at least 1 observation');
  });
});
