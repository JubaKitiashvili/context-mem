import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    expect(chain.chain_id).toBeTruthy();
    expect(chain.session_id).toBe('sess-1');
    expect(chain.parent_session).toBeNull();
    expect(chain.project_path).toBe('/project/path');
    expect(chain.handoff_reason).toBe('auto');
  });

  it('links sessions in a chain', () => {
    const first = session.createChainEntry('sess-1', '/project', null, 'auto');
    const second = session.createChainEntry('sess-2', '/project', 'sess-1', 'auto');
    expect(second.chain_id).toBe(first.chain_id);
    expect(second.parent_session).toBe('sess-1');
  });

  it('gets the latest chain entry for a project', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.createChainEntry('sess-2', '/project', 'sess-1', 'auto');
    const latest = session.getLatestChainEntry('/project');
    expect(latest?.session_id).toBe('sess-2');
  });

  it('returns null for unknown project', () => {
    const latest = session.getLatestChainEntry('/unknown');
    expect(latest).toBeNull();
  });

  it('gets chain history', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.createChainEntry('sess-2', '/project', 'sess-1', 'manual');
    session.createChainEntry('sess-3', '/project', 'sess-2', 'compaction');
    const history = session.getChainHistory('sess-3');
    expect(history).toHaveLength(3);
    expect(history[0].session_id).toBe('sess-3');
    expect(history[2].session_id).toBe('sess-1');
  });

  it('updates chain summary and token estimate', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.updateChainEntry('sess-1', { summary: 'Built feature X', token_estimate: 340000 });
    const entry = session.getLatestChainEntry('/project');
    expect(entry?.summary).toBe('Built feature X');
    expect(entry?.token_estimate).toBe(340000);
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
    expect(prompt).toContain('Session Handoff');
    expect(prompt).toBeTruthy();
  });

  it('snapshot limit is 16KB', () => {
    expect(session.getSnapshotMaxBytes()).toBe(16384);
  });
});
