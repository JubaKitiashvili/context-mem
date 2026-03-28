import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../../core/session.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('SessionManager — chain operations', () => {
  let storage: BetterSqlite3Storage;
  let session: SessionManager;

  beforeEach(async () => {
    storage = await createTestDb();
    session = new SessionManager(storage);
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates a new chain for the first session', () => {
    const chain = session.createChainEntry('sess-1', '/project/path', null, 'auto');
    assert.ok(chain.chain_id);
    assert.strictEqual(chain.session_id, 'sess-1');
    assert.strictEqual(chain.parent_session, null);
    assert.strictEqual(chain.project_path, '/project/path');
    assert.strictEqual(chain.handoff_reason, 'auto');
  });

  it('links sessions in a chain', () => {
    const first = session.createChainEntry('sess-1', '/project', null, 'auto');
    const second = session.createChainEntry('sess-2', '/project', 'sess-1', 'auto');
    assert.strictEqual(second.chain_id, first.chain_id);
    assert.strictEqual(second.parent_session, 'sess-1');
  });

  it('gets the latest chain entry for a project', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.createChainEntry('sess-2', '/project', 'sess-1', 'auto');
    const latest = session.getLatestChainEntry('/project');
    assert.strictEqual(latest?.session_id, 'sess-2');
  });

  it('returns null for unknown project', () => {
    const latest = session.getLatestChainEntry('/unknown');
    assert.strictEqual(latest, null);
  });

  it('gets chain history', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.createChainEntry('sess-2', '/project', 'sess-1', 'manual');
    session.createChainEntry('sess-3', '/project', 'sess-2', 'compaction');
    const history = session.getChainHistory('sess-3');
    assert.strictEqual(history.length, 3);
    assert.strictEqual(history[0].session_id, 'sess-3');
    assert.strictEqual(history[2].session_id, 'sess-1');
  });

  it('updates chain summary and token estimate', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.updateChainEntry('sess-1', { summary: 'Built feature X', token_estimate: 340000 });
    const entry = session.getLatestChainEntry('/project');
    assert.strictEqual(entry?.summary, 'Built feature X');
    assert.strictEqual(entry?.token_estimate, 340000);
  });

  it('generates continuation prompt from snapshot', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.saveSnapshot('sess-1', {
      session_id: 'sess-1',
      observations_stored: 10,
      total_content_bytes: 5000,
      total_summary_bytes: 500,
      searches_performed: 3,
      discovery_tokens: 100,
      read_tokens: 200,
      tokens_saved: 4300,
      savings_percentage: 86,
    });
    const prompt = session.generateContinuationPrompt('sess-1');
    assert.ok(prompt.includes('Session Handoff'));
    assert.ok(prompt);
  });

  it('snapshot limit is 16KB', () => {
    assert.strictEqual(session.getSnapshotMaxBytes(), 16384);
  });
});
