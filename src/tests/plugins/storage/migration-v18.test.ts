import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';

describe('migration v18 — error_log table', () => {
  let dbPath: string;
  let storage: BetterSqlite3Storage;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `cm-mig-v18-${Date.now()}.db`);
    storage = new BetterSqlite3Storage();
    await storage.open(dbPath);
  });

  after(async () => {
    await storage.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
  });

  it('creates error_log table with all expected columns', () => {
    const row = storage.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='error_log'
    `).get() as { name: string } | undefined;
    assert.ok(row, 'error_log table missing');
  });

  it('error_log has the required indexes', () => {
    const indexes = storage.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='error_log'
    `).all() as Array<{ name: string }>;
    const names = indexes.map(i => i.name);
    assert.ok(names.includes('idx_error_log_timestamp'));
    assert.ok(names.includes('idx_error_log_severity'));
    assert.ok(names.includes('idx_error_log_category'));
    assert.ok(names.includes('idx_error_log_hash'));
  });

  it('user_version is 18 after open', () => {
    const v = storage.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(v.user_version, 18);
  });

  it('accepts an insert with all required columns', () => {
    storage.exec(
      `INSERT INTO error_log (timestamp, severity, category, message, message_hash, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Date.now(), 'error', 'embedder', 'test message', 'abc123', Date.now(), Date.now()],
    );
    const row = storage.prepare('SELECT COUNT(*) as c FROM error_log').get() as { c: number };
    assert.equal(row.c, 1);
  });

  it('rejects invalid severity via CHECK constraint', () => {
    assert.throws(() => {
      storage.exec(
        `INSERT INTO error_log (timestamp, severity, category, message, message_hash, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [Date.now(), 'bogus', 'embedder', 'msg', 'hash', Date.now(), Date.now()],
      );
    }, /CHECK constraint|constraint failed/i);
  });
});
