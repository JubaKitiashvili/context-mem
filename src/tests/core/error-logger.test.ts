import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { ErrorLogger } from '../../core/error-logger.js';

describe('ErrorLogger', () => {
  let dbPath: string;
  let storage: BetterSqlite3Storage;
  let logger: ErrorLogger;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `cm-errlog-${Date.now()}.db`);
    storage = new BetterSqlite3Storage();
    await storage.open(dbPath);
  });

  beforeEach(() => {
    storage.exec('DELETE FROM error_log', []);
    logger = new ErrorLogger(storage, { throttleMs: 1000, maxAgeMs: 60_000, maxRows: 100 });
  });

  after(async () => {
    logger.stop();
    await storage.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('log() is synchronous and fast (<1ms)', () => {
    const start = process.hrtime.bigint();
    logger.log({ severity: 'error', category: 'embedder', message: 'model not loaded' });
    const elapsedNs = Number(process.hrtime.bigint() - start);
    assert.ok(elapsedNs < 1_000_000, `log() took ${elapsedNs}ns — expected <1ms`);
  });

  it('log() writes a row after the next microtask', async () => {
    logger.log({ severity: 'error', category: 'embedder', message: 'model not loaded' });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    const rows = logger.query({ limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, 'model not loaded');
    assert.equal(rows[0].category, 'embedder');
    assert.equal(rows[0].severity, 'error');
  });

  it('throttles duplicate (category, message) within the window', async () => {
    for (let i = 0; i < 5; i++) {
      logger.log({ severity: 'warn', category: 'entity', message: 'same message' });
    }
    await new Promise(r => setTimeout(r, 20));
    const rows = logger.query({ limit: 10 });
    assert.equal(rows.length, 1, 'expected a single row after throttling');
    assert.equal(rows[0].occurrences, 5);
  });

  it('accepts an Error object and records stack', async () => {
    const err = new Error('boom');
    logger.log({ severity: 'error', category: 'pipeline', message: 'pipeline failed', error: err });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    const rows = logger.query({ limit: 1 });
    assert.ok(rows[0].stack && rows[0].stack.length > 0);
  });

  it('query() filters by severity and category', async () => {
    logger.log({ severity: 'info', category: 'llm', message: 'a' });
    logger.log({ severity: 'error', category: 'embedder', message: 'b' });
    logger.log({ severity: 'error', category: 'llm', message: 'c' });
    await new Promise(r => setTimeout(r, 20));

    const errs = logger.query({ severity: 'error' });
    assert.equal(errs.length, 2);
    const embedErrs = logger.query({ severity: 'error', category: 'embedder' });
    assert.equal(embedErrs.length, 1);
    assert.equal(embedErrs[0].message, 'b');
  });

  it('summary() groups by (category, message_hash)', async () => {
    logger.log({ severity: 'error', category: 'embedder', message: 'A' });
    await new Promise(r => setTimeout(r, 1100)); // escape throttle window
    logger.log({ severity: 'error', category: 'embedder', message: 'A' });
    logger.log({ severity: 'error', category: 'entity', message: 'B' });
    await new Promise(r => setTimeout(r, 20));

    const s = logger.summary();
    const embedA = s.find(r => r.category === 'embedder' && r.message === 'A');
    assert.ok(embedA);
    assert.ok(embedA!.count >= 2);
  });

  it('prune() deletes rows older than maxAgeMs', async () => {
    storage.exec(
      `INSERT INTO error_log (timestamp, severity, category, message, message_hash, first_seen, last_seen)
       VALUES (?, 'error', 'embedder', 'old', 'oldhash', ?, ?)`,
      [Date.now() - 120_000, Date.now() - 120_000, Date.now() - 120_000],
    );
    logger.log({ severity: 'error', category: 'embedder', message: 'new' });
    await new Promise(r => setTimeout(r, 20));
    logger.prune();
    const rows = logger.query({ limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, 'new');
  });

  it('logger failures never throw', () => {
    const orphanLogger = new ErrorLogger(storage, { throttleMs: 1000, maxAgeMs: 60_000, maxRows: 100 });
    assert.doesNotThrow(() => {
      orphanLogger.log({ severity: 'error', category: 'other', message: 'test' });
    });
    orphanLogger.stop();
  });
});
