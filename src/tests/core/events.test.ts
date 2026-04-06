import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventTracker } from '../../core/events.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('EventTracker', () => {
  let storage: BetterSqlite3Storage;
  let tracker: EventTracker;

  beforeEach(async () => {
    storage = await createTestDb();
    tracker = new EventTracker(storage);
  });

  afterEach(async () => { await storage.close(); });

  // --- emit ---

  it('emit returns a ContextEvent with correct fields', () => {
    const evt = tracker.emit('sess-1', 'task_start', { task: 'test' });
    assert.ok(typeof evt.id === 'string');
    assert.ok(evt.id.length > 0);
    assert.equal(evt.session_id, 'sess-1');
    assert.equal(evt.event_type, 'task_start');
    assert.deepEqual(evt.data, { task: 'test' });
    assert.ok(typeof evt.timestamp === 'number');
    assert.ok(evt.timestamp > 0);
  });

  it('emit persists event to storage', () => {
    tracker.emit('sess-1', 'error', { message: 'boom' });
    const row = storage.prepare('SELECT COUNT(*) as n FROM events WHERE session_id = ?').get('sess-1') as { n: number };
    assert.equal(row.n, 1);
  });

  it('emit with no data defaults to empty object', () => {
    const evt = tracker.emit('sess-1', 'search');
    assert.deepEqual(evt.data, {});
  });

  // --- priority levels ---

  it('task_start and task_complete have priority 1', () => {
    const a = tracker.emit('s', 'task_start');
    const b = tracker.emit('s', 'task_complete');
    assert.equal(a.priority, 1);
    assert.equal(b.priority, 1);
  });

  it('error events have priority 1', () => {
    const evt = tracker.emit('s', 'error', { message: 'oops' });
    assert.equal(evt.priority, 1);
  });

  it('file_modify and decision have priority 2', () => {
    const a = tracker.emit('s', 'file_modify', { file: 'foo.ts' });
    const b = tracker.emit('s', 'decision', { reason: 'refactor' });
    assert.equal(a.priority, 2);
    assert.equal(b.priority, 2);
  });

  it('dependency_change and knowledge_save have priority 3', () => {
    const a = tracker.emit('s', 'dependency_change');
    const b = tracker.emit('s', 'knowledge_save');
    assert.equal(a.priority, 3);
    assert.equal(b.priority, 3);
  });

  it('file_read and search have priority 4', () => {
    const a = tracker.emit('s', 'file_read');
    const b = tracker.emit('s', 'search');
    assert.equal(a.priority, 4);
    assert.equal(b.priority, 4);
  });

  it('unknown event types default to priority 4', () => {
    const evt = tracker.emit('s', 'custom_event_xyz');
    assert.equal(evt.priority, 4);
  });

  // --- agent field ---

  it('emit stores agent when provided', () => {
    const evt = tracker.emit('sess-1', 'task_start', {}, 'agent-007');
    assert.equal(evt.agent, 'agent-007');
  });

  it('emit stores no agent when omitted', () => {
    const evt = tracker.emit('sess-1', 'task_start', {});
    assert.equal(evt.agent, undefined);
  });

  // --- context_bytes ---

  it('emit computes context_bytes as UTF-8 length of JSON data', () => {
    const data = { key: 'value' };
    const expected = Buffer.byteLength(JSON.stringify(data), 'utf8');
    const evt = tracker.emit('sess-1', 'search', data);
    assert.equal(evt.context_bytes, expected);
  });

  // --- query ---

  it('query returns events for the given session', () => {
    tracker.emit('sess-a', 'error', { msg: 'a' });
    tracker.emit('sess-b', 'error', { msg: 'b' });
    const results = tracker.query('sess-a');
    assert.equal(results.length, 1);
    assert.equal(results[0].session_id, 'sess-a');
  });

  it('query returns events in descending timestamp order', async () => {
    tracker.emit('sess-1', 'error');
    // Small delay to ensure distinct timestamps
    await new Promise(r => setTimeout(r, 2));
    tracker.emit('sess-1', 'task_start');
    const results = tracker.query('sess-1');
    assert.equal(results.length, 2);
    assert.ok(results[0].timestamp >= results[1].timestamp);
  });

  it('query filters by event_type', () => {
    tracker.emit('sess-1', 'error', { msg: 'err' });
    tracker.emit('sess-1', 'task_start');
    tracker.emit('sess-1', 'error', { msg: 'err2' });
    const results = tracker.query('sess-1', { event_type: 'error' });
    assert.equal(results.length, 2);
    for (const r of results) assert.equal(r.event_type, 'error');
  });

  it('query filters by priority (returns events with priority <= threshold)', () => {
    tracker.emit('sess-1', 'error');        // P1
    tracker.emit('sess-1', 'file_modify');  // P2
    tracker.emit('sess-1', 'search');       // P4
    const results = tracker.query('sess-1', { priority: 2 });
    for (const r of results) assert.ok(r.priority <= 2);
    assert.equal(results.length, 2);
  });

  it('query filters by from timestamp', async () => {
    tracker.emit('sess-1', 'error');
    await new Promise(r => setTimeout(r, 5));
    const mid = Date.now();
    await new Promise(r => setTimeout(r, 2));
    tracker.emit('sess-1', 'task_start');
    const results = tracker.query('sess-1', { from: mid });
    assert.equal(results.length, 1);
    assert.equal(results[0].event_type, 'task_start');
  });

  it('query filters by to timestamp', async () => {
    tracker.emit('sess-1', 'task_start');
    await new Promise(r => setTimeout(r, 5));
    const mid = Date.now();
    await new Promise(r => setTimeout(r, 2));
    tracker.emit('sess-1', 'error');
    const results = tracker.query('sess-1', { to: mid });
    assert.equal(results.length, 1);
    assert.equal(results[0].event_type, 'task_start');
  });

  it('query respects limit option', () => {
    for (let i = 0; i < 10; i++) {
      tracker.emit('sess-1', 'search');
    }
    const results = tracker.query('sess-1', { limit: 3 });
    assert.equal(results.length, 3);
  });

  it('query default limit is 50', () => {
    for (let i = 0; i < 60; i++) {
      tracker.emit('sess-1', 'search');
    }
    const results = tracker.query('sess-1');
    assert.equal(results.length, 50);
  });

  it('query returns empty when no events exist', () => {
    const results = tracker.query('no-such-session');
    assert.equal(results.length, 0);
  });

  it('query deserializes data from JSON', () => {
    tracker.emit('sess-1', 'decision', { reason: 'performance', score: 42 });
    const results = tracker.query('sess-1');
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].data, { reason: 'performance', score: 42 });
  });

  // --- detectErrorFix ---

  it('detectErrorFix returns empty when no error-fix pairs', () => {
    tracker.emit('sess-1', 'task_start');
    tracker.emit('sess-1', 'task_complete');
    const fixes = tracker.detectErrorFix('sess-1');
    assert.equal(fixes.length, 0);
  });

  it('detectErrorFix detects error followed by file_modify', async () => {
    tracker.emit('sess-1', 'error', { message: 'crash' });
    await new Promise(r => setTimeout(r, 2));
    tracker.emit('sess-1', 'file_modify', { file: 'src/fix.ts' });
    const fixes = tracker.detectErrorFix('sess-1');
    assert.equal(fixes.length, 1);
    assert.equal(fixes[0].file, 'src/fix.ts');
    assert.ok(typeof fixes[0].error_event === 'string');
    assert.ok(typeof fixes[0].fix_event === 'string');
  });

  it('detectErrorFix links correct error id to fix id', async () => {
    const errEvt = tracker.emit('sess-1', 'error', { message: 'crash' });
    await new Promise(r => setTimeout(r, 2));
    const fixEvt = tracker.emit('sess-1', 'file_modify', { file: 'src/fix.ts' });
    const fixes = tracker.detectErrorFix('sess-1');
    assert.equal(fixes[0].error_event, errEvt.id);
    assert.equal(fixes[0].fix_event, fixEvt.id);
  });

  it('detectErrorFix ignores file_modify without a preceding error', async () => {
    tracker.emit('sess-1', 'file_modify', { file: 'src/unrelated.ts' });
    const fixes = tracker.detectErrorFix('sess-1');
    assert.equal(fixes.length, 0);
  });

  it('detectErrorFix resets after a fix is detected', async () => {
    tracker.emit('sess-1', 'error', { message: 'e1' });
    await new Promise(r => setTimeout(r, 2));
    tracker.emit('sess-1', 'file_modify', { file: 'src/a.ts' });
    await new Promise(r => setTimeout(r, 2));
    // second file_modify without a new error should NOT produce another fix pair
    tracker.emit('sess-1', 'file_modify', { file: 'src/b.ts' });
    const fixes = tracker.detectErrorFix('sess-1');
    assert.equal(fixes.length, 1);
  });
});
