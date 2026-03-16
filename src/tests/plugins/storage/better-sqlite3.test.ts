import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';

describe('BetterSqlite3Storage', () => {
  let storage: BetterSqlite3Storage;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    storage = new BetterSqlite3Storage();
    await storage.init({});
    await storage.open(dbPath);
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates database with correct schema', () => {
    const tables = storage.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    assert.ok(names.includes('observations'));
    assert.ok(names.includes('token_stats'));
  });

  it('supports FTS5', () => {
    assert.equal(storage.supportsFTS5, true);
  });

  it('uses WAL mode', () => {
    const result = storage.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    assert.equal(result.journal_mode, 'wal');
  });

  it('can insert and retrieve an observation', () => {
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['test-1', 'code', 'const x = 1;', 'variable declaration', '{}', Date.now(), 'public']
    );
    const row = storage.prepare('SELECT * FROM observations WHERE id = ?').get('test-1') as Record<string, unknown>;
    assert.equal(row.content, 'const x = 1;');
  });

  it('FTS5 index is populated via trigger', () => {
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['fts-1', 'error', 'TypeError: cannot read property', 'type error', '{}', Date.now(), 'public']
    );
    const results = storage.prepare(
      "SELECT * FROM obs_fts WHERE obs_fts MATCH 'TypeError'"
    ).all();
    assert.equal(results.length, 1);
  });

  it('trigram index is populated via trigger', () => {
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['tri-1', 'log', 'authentication middleware failed', 'auth fail', '{}', Date.now(), 'public']
    );
    const results = storage.prepare(
      "SELECT * FROM obs_trigram WHERE obs_trigram MATCH '\"uthenti\"'"
    ).all();
    assert.equal(results.length, 1);
  });

  it('schema version is set', () => {
    const result = storage.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.ok(result.user_version >= 1);
  });
});
