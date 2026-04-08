/**
 * Tests for Phase 4 Killer Features:
 * - Decision Trail builder
 * - Session Narrative generator
 * - Regression Fingerprinting
 * - Memory Pressure Predictor
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { createTestDb } from '../helpers.js';

describe('Decision Trail', () => {
  let storage: BetterSqlite3Storage;

  before(async () => {
    storage = await createTestDb();
    // Seed decision observations
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, session_id, importance_score, pinned, compression_tier)
       VALUES ('dec-1', 'decision', 'We decided to use PostgreSQL for the database', 'Use PostgreSQL', '{"significance_flags":["DECISION"]}', ${Date.now() - 1000}, 'sess-1', 0.9, 1, 'verbatim')`
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, session_id, importance_score, pinned, compression_tier)
       VALUES ('err-1', 'error', 'MySQL connection timeout in production', 'MySQL timeout', '{"significance_flags":["PROBLEM"]}', ${Date.now() - 2000}, 'sess-1', 0.8, 0, 'verbatim')`
    );
  });

  after(async () => { await storage.close(); });

  it('builds trail for matching query', async () => {
    const { buildTrail } = await import('../../core/decision-trail.js');
    const trail = buildTrail(storage, 'PostgreSQL');
    assert.ok(trail, 'should find a trail');
    assert.ok(trail!.decision.includes('PostgreSQL'));
    assert.ok(trail!.evidence_chain.length > 0, 'should have evidence');
  });

  it('returns null for no matching decision', async () => {
    const { buildTrail } = await import('../../core/decision-trail.js');
    const trail = buildTrail(storage, 'nonexistent_xyzzy');
    assert.equal(trail, null);
  });

  it('evidence chain is chronologically ordered', async () => {
    const { buildTrail } = await import('../../core/decision-trail.js');
    const trail = buildTrail(storage, 'PostgreSQL');
    if (trail && trail.evidence_chain.length >= 2) {
      for (let i = 1; i < trail.evidence_chain.length; i++) {
        assert.ok(trail.evidence_chain[i].timestamp >= trail.evidence_chain[i - 1].timestamp);
      }
    }
  });
});

describe('Session Narrative', () => {
  let storage: BetterSqlite3Storage;

  before(async () => {
    storage = await createTestDb();
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier)
       VALUES ('narr-1', 'decision', 'Switch to httpOnly cookies', 'Use httpOnly cookies', '{}', ${Date.now()}, 0.9, 1, 'verbatim')`
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier)
       VALUES ('narr-2', 'code', 'Updated auth middleware', 'Auth middleware update', '{}', ${Date.now()}, 0.5, 0, 'verbatim')`
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier)
       VALUES ('narr-3', 'error', 'JWT refresh rotation failing', 'JWT rotation error', '{}', ${Date.now()}, 0.8, 0, 'verbatim')`
    );
  });

  after(async () => { await storage.close(); });

  it('generates PR format', async () => {
    const { generateNarrative } = await import('../../core/narrative-generator.js');
    const text = generateNarrative(storage, { format: 'pr' });
    assert.ok(text.includes('## Summary'));
    assert.ok(text.includes('## Test Plan'));
  });

  it('generates standup format', async () => {
    const { generateNarrative } = await import('../../core/narrative-generator.js');
    const text = generateNarrative(storage, { format: 'standup' });
    assert.ok(text.includes('**Done:**'));
    assert.ok(text.includes('**Next:**'));
    assert.ok(text.includes('**Blockers:**'));
  });

  it('generates ADR format', async () => {
    const { generateNarrative } = await import('../../core/narrative-generator.js');
    const text = generateNarrative(storage, { format: 'adr' });
    assert.ok(text.includes('## Context'));
    assert.ok(text.includes('## Decision'));
    assert.ok(text.includes('## Consequences'));
  });

  it('generates onboarding format', async () => {
    const { generateNarrative } = await import('../../core/narrative-generator.js');
    const text = generateNarrative(storage, { format: 'onboarding' });
    assert.ok(text.includes('# Project Overview'));
  });

  it('empty DB returns minimal output', async () => {
    const emptyStorage = await createTestDb();
    const { generateNarrative } = await import('../../core/narrative-generator.js');
    const text = generateNarrative(emptyStorage, { format: 'pr' });
    assert.ok(text.includes('## Summary'));
    await emptyStorage.close();
  });

  it('output is deterministic', async () => {
    const { generateNarrative } = await import('../../core/narrative-generator.js');
    const text1 = generateNarrative(storage, { format: 'pr' });
    const text2 = generateNarrative(storage, { format: 'pr' });
    assert.equal(text1, text2);
  });
});

describe('Regression Fingerprinting', () => {
  let storage: BetterSqlite3Storage;

  before(async () => {
    storage = await createTestDb();
    const kb = new KnowledgeBase(storage);
    await kb.save({ category: 'pattern', title: 'Use strict mode', content: 'Always use strict mode', tags: [], source_type: 'observed' });
  });

  after(async () => { await storage.close(); });

  it('captures fingerprint with correct structure', async () => {
    const { captureFingerprint } = await import('../../core/regression-fingerprint.js');
    const fp = captureFingerprint(storage, 'sess-fp', 'task_complete');
    assert.ok(Array.isArray(fp.knowledge_ids));
    assert.ok(Array.isArray(fp.recent_files));
    assert.ok(typeof fp.timestamp === 'number');
  });

  it('stores fingerprint in DB', async () => {
    const row = storage.prepare('SELECT COUNT(*) as cnt FROM working_fingerprints').get() as { cnt: number };
    assert.ok(row.cnt >= 1);
  });

  it('diff detects new errors', async () => {
    const { captureFingerprint, diffFingerprints } = await import('../../core/regression-fingerprint.js');
    const baseline = captureFingerprint(storage, 'sess-fp2', 'test');

    // Add an error after baseline
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at, importance_score, pinned, compression_tier)
       VALUES ('err-fp', 'error', 'New error after fingerprint', '{}', ${Date.now() + 1000}, 0.8, 0, 'verbatim')`
    );

    const diff = diffFingerprints(storage, baseline);
    assert.ok(diff.added_errors.length >= 1, 'should detect new error');
  });

  it('getLastFingerprint retrieves most recent', async () => {
    const { getLastFingerprint } = await import('../../core/regression-fingerprint.js');
    const fp = getLastFingerprint(storage);
    assert.ok(fp, 'should find a fingerprint');
    assert.ok(fp!.timestamp > 0);
  });
});

describe('Memory Pressure Predictor', () => {
  let storage: BetterSqlite3Storage;

  before(async () => {
    storage = await createTestDb();

    // Low importance, old, never accessed — high risk
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at, importance_score, pinned, compression_tier, access_count)
       VALUES ('risk-high', 'log', 'Old unimportant log', '{}', ${Date.now() - 60 * 24 * 60 * 60 * 1000}, 0.2, 0, 'verbatim', 0)`
    );

    // High importance, recent, accessed — low risk
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at, importance_score, pinned, compression_tier, access_count)
       VALUES ('risk-low', 'decision', 'Important recent decision', '{}', ${Date.now()}, 0.9, 0, 'verbatim', 10)`
    );

    // Pinned — should not appear
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at, importance_score, pinned, compression_tier, access_count)
       VALUES ('risk-pinned', 'decision', 'Pinned decision', '{}', ${Date.now() - 100 * 24 * 60 * 60 * 1000}, 0.3, 1, 'verbatim', 0)`
    );
  });

  after(async () => { await storage.close(); });

  it('low-importance old entries rank highest risk', async () => {
    const { predictLoss } = await import('../../core/pressure-predictor.js');
    const entries = predictLoss(storage, 10);
    assert.ok(entries.length > 0);
    const highRisk = entries.find(e => e.id === 'risk-high');
    const lowRisk = entries.find(e => e.id === 'risk-low');
    assert.ok(highRisk, 'high-risk entry should appear');
    if (highRisk && lowRisk) {
      assert.ok(highRisk.risk_score > lowRisk.risk_score, 'old unimportant should have higher risk');
    }
  });

  it('pinned entries never appear', async () => {
    const { predictLoss } = await import('../../core/pressure-predictor.js');
    const entries = predictLoss(storage, 50);
    const pinned = entries.find(e => e.id === 'risk-pinned');
    assert.equal(pinned, undefined, 'pinned entries should not appear in predictions');
  });

  it('includes risk reasons', async () => {
    const { predictLoss } = await import('../../core/pressure-predictor.js');
    const entries = predictLoss(storage, 10);
    const highRisk = entries.find(e => e.id === 'risk-high');
    assert.ok(highRisk);
    assert.ok(highRisk!.reasons.length > 0, 'should have at least one reason');
  });

  it('respects limit parameter', async () => {
    const { predictLoss } = await import('../../core/pressure-predictor.js');
    const entries = predictLoss(storage, 1);
    assert.ok(entries.length <= 1);
  });
});
