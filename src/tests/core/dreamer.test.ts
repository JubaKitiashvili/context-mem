/**
 * Tests for the Dreamer background agent.
 * Validates stale marking, auto-archiving, explicit entry protection,
 * and interval cleanup.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { Dreamer } from '../../core/dreamer.js';
import { GlobalKnowledgeStore } from '../../core/global-store.js';
import { createTestDb } from '../helpers.js';

describe('Dreamer background agent', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;
  let dreamer: Dreamer;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);
    dreamer = new Dreamer(kb, storage, {
      cycleMs: 60_000, // won't auto-fire during tests
      staleThresholdDays: 30,
      archiveThresholdDays: 90,
    });
  });

  after(async () => {
    dreamer.stop();
    await storage.close();
  });

  it('marks entries stale after threshold', async () => {
    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const entry = await kb.save({
      category: 'decision',
      title: 'Use Redis for caching',
      content: 'We decided to use Redis as our caching layer',
      tags: ['caching'],
      source_type: 'observed',
    });

    // Backdate last_accessed beyond the stale threshold
    storage.exec(
      'UPDATE knowledge SET last_accessed = ? WHERE id = ?',
      [now - THIRTY_ONE_DAYS_MS, entry.id],
    );

    const count = await dreamer.markStaleEntries();
    assert.ok(count >= 1, `expected at least 1 stale entry, got ${count}`);

    // Verify the stale flag was set
    const row = storage.prepare('SELECT stale FROM knowledge WHERE id = ?').get(entry.id) as { stale: number };
    assert.equal(row.stale, 1, 'entry should be marked stale');
  });

  it('does not mark recently accessed entries as stale', async () => {
    const entry = await kb.save({
      category: 'pattern',
      title: 'Fresh entry pattern',
      content: 'This entry was just accessed',
      tags: ['fresh'],
      source_type: 'observed',
    });

    // last_accessed is set to now by save(), so it should not be stale
    await dreamer.markStaleEntries();

    const row = storage.prepare('SELECT stale FROM knowledge WHERE id = ?').get(entry.id) as { stale: number };
    assert.equal(row.stale, 0, 'recently accessed entry should not be stale');
  });

  it('archives old non-explicit entries', async () => {
    const NINETY_ONE_DAYS_MS = 91 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const entry = await kb.save({
      category: 'error',
      title: 'Old observed error',
      content: 'Some old error that was observed',
      tags: ['old'],
      source_type: 'observed',
    });

    // Backdate last_accessed beyond the archive threshold
    storage.exec(
      'UPDATE knowledge SET last_accessed = ? WHERE id = ?',
      [now - NINETY_ONE_DAYS_MS, entry.id],
    );

    const count = await dreamer.archiveOldEntries();
    assert.ok(count >= 1, `expected at least 1 archived entry, got ${count}`);

    const row = storage.prepare('SELECT archived FROM knowledge WHERE id = ?').get(entry.id) as { archived: number };
    assert.equal(row.archived, 1, 'old non-explicit entry should be archived');
  });

  it('never archives explicit entries', async () => {
    const NINETY_ONE_DAYS_MS = 91 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const entry = await kb.save({
      category: 'decision',
      title: 'Critical explicit decision',
      content: 'This was an explicit team decision that should never be auto-archived',
      tags: ['critical'],
      source_type: 'explicit',
    });

    // Backdate last_accessed beyond the archive threshold
    storage.exec(
      'UPDATE knowledge SET last_accessed = ? WHERE id = ?',
      [now - NINETY_ONE_DAYS_MS, entry.id],
    );

    await dreamer.archiveOldEntries();

    const row = storage.prepare('SELECT archived FROM knowledge WHERE id = ?').get(entry.id) as { archived: number };
    assert.equal(row.archived, 0, 'explicit entry should never be auto-archived');
  });

  it('stop() cleans up interval', () => {
    const d = new Dreamer(kb, storage, { cycleMs: 100_000 });
    d.start();
    d.stop();
    // Calling stop again should be safe (idempotent)
    d.stop();
    // If we get here without throwing, the interval was cleaned up
    assert.ok(true, 'stop() should clean up without error');
  });

  it('detects potential contradictions within a category', async () => {
    // Save two entries with high word overlap but potentially conflicting content
    await kb.save({
      category: 'decision',
      title: 'Database choice PostgreSQL production',
      content: 'We chose PostgreSQL for production database hosting',
      tags: ['database'],
      source_type: 'observed',
    });

    await kb.save({
      category: 'decision',
      title: 'Database choice MySQL production',
      content: 'We chose MySQL for production database hosting',
      tags: ['database'],
      source_type: 'observed',
    });

    const contradictions = await dreamer.detectContradictions();
    // The two entries share several words: "database", "choice", "production", "hosting", "chose"
    assert.ok(contradictions >= 1, `expected at least 1 contradiction detected, got ${contradictions}`);

    const contradictionLogs = dreamer.getLogs().filter(l => l.type === 'contradiction');
    assert.ok(contradictionLogs.length >= 1, 'should have contradiction log entries');
  });

  it('cycle() runs all three phases without error', async () => {
    // Just verify the full cycle doesn't throw
    await dreamer.cycle();
    assert.ok(true, 'cycle should complete without error');
  });

  describe('promotionScan', () => {
    it('detects knowledge accessed in 3+ distinct sessions', async () => {
      const kb2 = new KnowledgeBase(storage);
      const entry = await kb2.save({
        category: 'pattern',
        title: 'Frequently accessed pattern',
        content: 'This pattern is accessed often across sessions',
        tags: [],
        shareable: true,
        source_type: 'explicit',
      });

      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-1', Date.now()],
      );
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-2', Date.now()],
      );
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-3', Date.now()],
      );

      const d = new Dreamer(kb2, storage, { promotionSessionThreshold: 3 });
      const candidates = await d.promotionScan();

      const found = candidates.find(c => c.id === entry.id);
      assert.ok(found, 'entry accessed in 3 sessions should be a promotion candidate');
      assert.equal(found!.sessions, 3, 'should report 3 sessions');

      const promoteLogs = d.getLogs().filter(l => l.type === 'promote' && l.entry_id === entry.id);
      assert.ok(promoteLogs.length >= 1, 'should have a promote log entry');
    });

    it('skips entries already auto-promoted', async () => {
      const kb2 = new KnowledgeBase(storage);
      const entry = await kb2.save({
        category: 'pattern',
        title: 'Already promoted pattern',
        content: 'This pattern was already promoted',
        tags: [],
        shareable: true,
        source_type: 'explicit',
      });

      storage.exec('UPDATE knowledge SET auto_promoted = 1 WHERE id = ?', [entry.id]);

      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-a', Date.now()],
      );
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-b', Date.now()],
      );
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-c', Date.now()],
      );

      const d = new Dreamer(kb2, storage, { promotionSessionThreshold: 3 });
      const candidates = await d.promotionScan();

      const found = candidates.find(c => c.id === entry.id);
      assert.equal(found, undefined, 'already auto-promoted entry should not be a candidate');
    });

    it('skips entries with shareable = 0', async () => {
      const kb2 = new KnowledgeBase(storage);
      const entry = await kb2.save({
        category: 'pattern',
        title: 'Non-shareable pattern',
        content: 'This pattern is not shareable',
        tags: [],
        shareable: false,
        source_type: 'explicit',
      });

      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-x', Date.now()],
      );
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-y', Date.now()],
      );
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, 'sess-z', Date.now()],
      );

      const d = new Dreamer(kb2, storage, { promotionSessionThreshold: 3 });
      const candidates = await d.promotionScan();

      const found = candidates.find(c => c.id === entry.id);
      assert.equal(found, undefined, 'non-shareable entry should not be a promotion candidate');
    });
  });

  describe('duplicateScan', () => {
    it('detects and logs duplicate entries in global store', async () => {
      const storage = await createTestDb();
      const kb = new KnowledgeBase(storage);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-dreamer-dup-'));
      const globalStore = new GlobalKnowledgeStore(undefined, path.join(tmpDir, 'global.db'));
      globalStore.open();

      const dreamer = new Dreamer(kb, storage, { cycleMs: 60_000, globalStore });

      // Add two similar entries to global store
      globalStore.promote({
        id: 'l1', category: 'pattern', title: 'Use connection pooling for PostgreSQL',
        content: 'Always use connection pooling when connecting to PostgreSQL databases for better performance',
        tags: ['database'], shareable: true, relevance_score: 1, access_count: 5,
        created_at: Date.now() - 100000, last_accessed: Date.now(), archived: false, source_type: 'explicit',
      }, 'project-a');

      globalStore.promote({
        id: 'l2', category: 'pattern', title: 'PostgreSQL connection pooling best practice',
        content: 'Use connection pooling when connecting to PostgreSQL for better performance and resource management',
        tags: ['postgres'], shareable: true, relevance_score: 1, access_count: 3,
        created_at: Date.now(), last_accessed: Date.now(), archived: false, source_type: 'explicit',
      }, 'project-b');

      const count = await dreamer.duplicateScan();
      assert.ok(count >= 1, `should detect at least 1 duplicate pair, got ${count}`);

      dreamer.stop();
      globalStore.close();
      await storage.close();
      fs.rmSync(tmpDir, { recursive: true });
    });
  });
});
