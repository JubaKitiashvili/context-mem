import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LifecycleManager } from '../../core/lifecycle.js';
import type { LifecycleConfig } from '../../core/lifecycle.js';
import { createTestDb } from '../helpers.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';

function insertObs(
  storage: BetterSqlite3Storage,
  opts: {
    id: string;
    type?: string;
    indexed_at?: number;
    privacy_level?: string;
    session_id?: string | null;
  },
): void {
  storage.exec(
    `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.type ?? 'context',
      'test content',
      null,
      '{}',
      opts.indexed_at ?? Date.now(),
      opts.privacy_level ?? 'public',
      opts.session_id ?? null,
    ],
  );
}

function makeConfig(overrides: Partial<LifecycleConfig> = {}): LifecycleConfig {
  return {
    ttl_days: 30,
    max_db_size_mb: 500,
    max_observations: 50000,
    preserve_types: ['decision', 'commit'],
    ...overrides,
  };
}

describe('LifecycleManager', () => {
  describe('TTL deletes old observations', () => {
    let storage: BetterSqlite3Storage;

    before(async () => {
      storage = await createTestDb();
    });

    after(async () => {
      await storage.close();
    });

    it('deletes observations older than ttl_days', async () => {
      const oldTs = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days ago
      insertObs(storage, { id: 'old-1', type: 'context', indexed_at: oldTs });
      insertObs(storage, { id: 'recent-1', type: 'context', indexed_at: Date.now() });

      const mgr = new LifecycleManager(storage, makeConfig({ ttl_days: 30 }));
      const result = await mgr.cleanup();

      assert.ok(result.deleted >= 1, 'should delete at least one old observation');
      const row = storage.prepare('SELECT id FROM observations WHERE id = ?').get('old-1');
      assert.equal(row, undefined, 'old observation should be gone');
      const recent = storage.prepare('SELECT id FROM observations WHERE id = ?').get('recent-1');
      assert.ok(recent, 'recent observation should still exist');
    });
  });

  describe('preserves protected types', () => {
    let storage: BetterSqlite3Storage;

    before(async () => {
      storage = await createTestDb();
    });

    after(async () => {
      await storage.close();
    });

    it('keeps decision observations even when older than ttl_days', async () => {
      const oldTs = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days ago
      insertObs(storage, { id: 'old-decision', type: 'decision', indexed_at: oldTs });
      insertObs(storage, { id: 'old-context', type: 'context', indexed_at: oldTs });

      const mgr = new LifecycleManager(storage, makeConfig({ ttl_days: 30, preserve_types: ['decision', 'commit'] }));
      await mgr.cleanup();

      const decision = storage.prepare('SELECT id FROM observations WHERE id = ?').get('old-decision');
      assert.ok(decision, 'old decision observation should be preserved');

      const context = storage.prepare('SELECT id FROM observations WHERE id = ?').get('old-context');
      assert.equal(context, undefined, 'old context observation should be deleted');
    });
  });

  describe('max_observations cap', () => {
    let storage: BetterSqlite3Storage;

    before(async () => {
      storage = await createTestDb();
    });

    after(async () => {
      await storage.close();
    });

    it('trims to max_observations keeping the newest', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        insertObs(storage, {
          id: `cap-obs-${i}`,
          type: 'context',
          indexed_at: now + i, // ascending timestamps so cap-obs-9 is newest
        });
      }

      const mgr = new LifecycleManager(storage, makeConfig({ max_observations: 5 }));
      await mgr.cleanup();

      const rows = storage.prepare('SELECT id FROM observations WHERE id LIKE ?').all('cap-obs-%') as { id: string }[];
      assert.equal(rows.length, 5, 'only 5 observations should remain');

      // The 5 newest should be kept (cap-obs-5 through cap-obs-9)
      const ids = rows.map(r => r.id);
      assert.ok(ids.includes('cap-obs-9'), 'newest observation should be kept');
      assert.ok(!ids.includes('cap-obs-0'), 'oldest observation should be removed');
    });
  });

  describe('session-scoped private cleanup', () => {
    let storage: BetterSqlite3Storage;

    before(async () => {
      storage = await createTestDb();
    });

    after(async () => {
      await storage.close();
    });

    it('deletes private observations for the given session only', async () => {
      insertObs(storage, { id: 'priv-x-1', privacy_level: 'private', session_id: 'session-X' });
      insertObs(storage, { id: 'priv-x-2', privacy_level: 'private', session_id: 'session-X' });
      insertObs(storage, { id: 'priv-y-1', privacy_level: 'private', session_id: 'session-Y' });
      insertObs(storage, { id: 'pub-x-1', privacy_level: 'public', session_id: 'session-X' });

      const mgr = new LifecycleManager(storage, makeConfig());
      const result = await mgr.cleanupSession('session-X');

      assert.equal(result.deleted, 2, 'should delete 2 private obs for session-X');

      const privX1 = storage.prepare('SELECT id FROM observations WHERE id = ?').get('priv-x-1');
      assert.equal(privX1, undefined, 'private session-X obs should be gone');

      const privX2 = storage.prepare('SELECT id FROM observations WHERE id = ?').get('priv-x-2');
      assert.equal(privX2, undefined, 'private session-X obs should be gone');

      const privY1 = storage.prepare('SELECT id FROM observations WHERE id = ?').get('priv-y-1');
      assert.ok(privY1, 'private session-Y obs should be preserved');

      const pubX1 = storage.prepare('SELECT id FROM observations WHERE id = ?').get('pub-x-1');
      assert.ok(pubX1, 'public session-X obs should be preserved');
    });
  });

  describe('preserves recent observations', () => {
    let storage: BetterSqlite3Storage;

    before(async () => {
      storage = await createTestDb();
    });

    after(async () => {
      await storage.close();
    });

    it('does not delete observations within ttl_days', async () => {
      const recentTs = Date.now() - (5 * 24 * 60 * 60 * 1000); // 5 days ago
      insertObs(storage, { id: 'fresh-1', type: 'context', indexed_at: recentTs });
      insertObs(storage, { id: 'fresh-2', type: 'log', indexed_at: Date.now() });

      const mgr = new LifecycleManager(storage, makeConfig({ ttl_days: 30 }));
      const result = await mgr.cleanup();

      const fresh1 = storage.prepare('SELECT id FROM observations WHERE id = ?').get('fresh-1');
      assert.ok(fresh1, 'recent observation should still exist');

      const fresh2 = storage.prepare('SELECT id FROM observations WHERE id = ?').get('fresh-2');
      assert.ok(fresh2, 'very recent observation should still exist');

      assert.equal(result.deleted, 0, 'no observations should be deleted');
    });
  });
});
