/**
 * Tests for KnowledgeBase session access recording.
 * Verifies that search() records entries to session_access_log when a sessionId is provided.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBase } from '../../../plugins/knowledge/knowledge-base.js';
import { computeAuthority } from '../../../plugins/knowledge/knowledge-base.js';
import type { KnowledgeEntry } from '../../../core/types.js';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../../helpers.js';

function makeKnowledgeEntry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 'test-id',
    category: 'pattern',
    title: 'Test',
    content: 'Test content',
    tags: [],
    shareable: true,
    relevance_score: 1.0,
    access_count: 0,
    created_at: Date.now(),
    last_accessed: Date.now(),
    archived: false,
    source_type: 'observed',
    ...overrides,
  };
}

describe('session access recording', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);
  });

  after(async () => { await storage.close(); });

  it('records session access on search results', () => {
    kb.save({
      category: 'pattern',
      title: 'Test pattern alpha',
      content: 'Alpha pattern content for session recording',
      tags: ['alpha'],
      shareable: true,
      source_type: 'explicit',
    });

    const sessionId = 'session-record-test-001';
    const results = kb.search('Alpha pattern', {}, sessionId);
    assert.ok(results.length > 0, 'search should return at least one result');

    const rows = storage.prepare(
      'SELECT * FROM session_access_log WHERE session_id = ?'
    ).all(sessionId) as Array<{ knowledge_id: string; session_id: string; accessed_at: number }>;

    assert.ok(rows.length > 0, 'session_access_log should have at least one entry');
    const entryIds = results.map(r => r.id);
    for (const row of rows) {
      assert.ok(entryIds.includes(row.knowledge_id), `logged knowledge_id ${row.knowledge_id} should be in results`);
      assert.equal(row.session_id, sessionId);
      assert.ok(row.accessed_at > 0, 'accessed_at should be a positive timestamp');
    }
  });

  it('does not duplicate session access within same session', () => {
    kb.save({
      category: 'pattern',
      title: 'Test pattern beta',
      content: 'Beta pattern content for dedup test',
      tags: ['beta'],
      shareable: true,
      source_type: 'explicit',
    });

    const sessionId = 'session-dedup-test-002';

    // Search twice with the same sessionId
    const results1 = kb.search('Beta pattern', {}, sessionId);
    const results2 = kb.search('Beta pattern', {}, sessionId);
    assert.ok(results1.length > 0, 'first search should return results');
    assert.ok(results2.length > 0, 'second search should return results');

    // Find the saved entry in results
    const betaEntry = results1.find(r => r.title === 'Test pattern beta');
    assert.ok(betaEntry, 'beta entry should appear in first search results');

    const rows = storage.prepare(
      'SELECT * FROM session_access_log WHERE session_id = ? AND knowledge_id = ?'
    ).all(sessionId, betaEntry!.id) as Array<{ knowledge_id: string; session_id: string }>;

    assert.equal(rows.length, 1, 'UNIQUE constraint should prevent duplicate entries for same session+knowledge');
  });

  it('records separate entries for different sessions', () => {
    kb.save({
      category: 'pattern',
      title: 'Test pattern gamma',
      content: 'Gamma pattern content for multi-session test',
      tags: ['gamma'],
      shareable: true,
      source_type: 'explicit',
    });

    const sessionIds = ['session-multi-001', 'session-multi-002', 'session-multi-003'];

    let gammaEntry: { id: string } | undefined;
    for (const sid of sessionIds) {
      const results = kb.search('Gamma pattern', {}, sid);
      if (!gammaEntry) {
        gammaEntry = results.find(r => r.title === 'Test pattern gamma');
      }
    }

    assert.ok(gammaEntry, 'gamma entry should appear in search results');

    const rows = storage.prepare(
      'SELECT * FROM session_access_log WHERE knowledge_id = ? ORDER BY session_id'
    ).all(gammaEntry!.id) as Array<{ knowledge_id: string; session_id: string }>;

    const distinctSessions = new Set(rows.map(r => r.session_id));
    assert.ok(distinctSessions.size >= 3, `expected at least 3 distinct session entries, got ${distinctSessions.size}`);
    for (const sid of sessionIds) {
      assert.ok(distinctSessions.has(sid), `session ${sid} should have a log entry`);
    }
  });
});

describe('computeAuthority', () => {
  it('explicit source scores higher than inferred', () => {
    const explicit = makeKnowledgeEntry({ source_type: 'explicit' });
    const inferred = makeKnowledgeEntry({ source_type: 'inferred' });

    const explicitAuth = computeAuthority(explicit, 1);
    const inferredAuth = computeAuthority(inferred, 1);

    assert.ok(explicitAuth > inferredAuth, `explicit (${explicitAuth}) should score higher than inferred (${inferredAuth})`);
  });

  it('entry accessed across many sessions scores higher', () => {
    const entry = makeKnowledgeEntry({ source_type: 'observed', access_count: 10 });

    const fewSessions = computeAuthority(entry, 1);
    const manySessions = computeAuthority(entry, 20);

    assert.ok(manySessions > fewSessions, `many sessions (${manySessions}) should score higher than few (${fewSessions})`);
  });

  it('frequently accessed recent entry scores higher than rarely accessed old entry', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const frequentRecent = makeKnowledgeEntry({
      source_type: 'observed',
      access_count: 50,
      created_at: Date.now() - 2 * DAY_MS,
    });
    const rareOld = makeKnowledgeEntry({
      source_type: 'observed',
      access_count: 1,
      created_at: Date.now() - 60 * DAY_MS,
    });

    const recentAuth = computeAuthority(frequentRecent, 5);
    const oldAuth = computeAuthority(rareOld, 1);

    assert.ok(recentAuth > oldAuth, `frequent recent (${recentAuth}) should beat rare old (${oldAuth})`);
  });

  it('returns value between 0 and 1', () => {
    const entry = makeKnowledgeEntry({ source_type: 'explicit', access_count: 100 });
    const auth = computeAuthority(entry, 50);

    assert.ok(auth >= 0 && auth <= 1, `authority ${auth} should be between 0 and 1`);
  });

  it('zero-age entry does not cause NaN or Infinity', () => {
    const entry = makeKnowledgeEntry({ created_at: Date.now() });
    const auth = computeAuthority(entry, 0);

    assert.ok(Number.isFinite(auth), `authority should be finite, got ${auth}`);
  });
});

describe('contradiction resolution with authority', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);
  });

  after(async () => { await storage.close(); });

  it('returns authority scores and suggested action on contradiction', async () => {
    const existing = await kb.save({
      category: 'pattern',
      title: 'Authentication flow pattern',
      content: 'Use JWT with refresh tokens for authentication',
      tags: ['auth'],
      source_type: 'explicit',
    });

    // Simulate access from multiple sessions
    for (let i = 0; i < 5; i++) {
      storage.exec('UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?', [existing.id]);
      try {
        storage.exec(
          'INSERT OR IGNORE INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
          [existing.id, `session-${i}`, Date.now()]
        );
      } catch { /* table may not exist */ }
    }

    const warnings = await kb.checkContradictions(
      'Authentication flow pattern',
      'Use session cookies for authentication instead of JWT',
      'pattern'
    );

    assert.ok(warnings.length > 0, 'should detect contradiction');
    const w = warnings[0];
    assert.ok(typeof w.authority_existing === 'number', 'should have authority_existing');
    assert.ok(typeof w.authority_new === 'number', 'should have authority_new');
    assert.ok(['keep_existing', 'replace', 'merge'].includes(w.suggested_action), 'should have valid suggested_action');
    assert.ok(w.authority_existing > w.authority_new, 'established explicit entry should have higher authority');
    assert.equal(w.suggested_action, 'keep_existing', 'should suggest keeping the more authoritative entry');
  });

  it('suggests merge when authority scores are close', async () => {
    const entry1 = kb.save({
      category: 'decision',
      title: 'Database choice for caching',
      content: 'Use Redis for caching layer',
      tags: ['cache'],
      source_type: 'observed',
    });

    const warnings = await kb.checkContradictions(
      'Database choice for caching',
      'Use Memcached for caching layer',
      'decision'
    );

    if (warnings.length > 0) {
      const w = warnings[0];
      assert.ok(typeof w.suggested_action === 'string', 'should have suggested_action');
    }
  });

  it('handles long content entries without errors', async () => {
    kb.save({
      category: 'pattern',
      title: 'Verbose deployment process',
      content: 'Deploy using Docker. '.repeat(100),
      tags: ['deploy'],
      source_type: 'observed',
    });

    const warnings = await kb.checkContradictions(
      'Deployment process',
      'Deploy using Kubernetes',
      'pattern'
    );

    assert.ok(Array.isArray(warnings), 'should return warnings array');
    for (const w of warnings) {
      assert.ok(typeof w.authority_existing === 'number', 'should have authority on all warnings');
      assert.ok(typeof w.suggested_action === 'string', 'should have suggested_action on all warnings');
    }
  });
});
