/**
 * Tests for knowledge entry relevance decay.
 * Verifies that entries lose relevance over time unless actively accessed,
 * and that explicit source entries decay slower.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('Knowledge relevance decay', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);
  });

  after(async () => { await storage.close(); });

  it('recent entries rank higher than old entries', async () => {
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // Save a "recent" entry
    const recent = await kb.save({
      category: 'decision',
      title: 'Use PostgreSQL for database',
      content: 'We decided to use PostgreSQL as our primary database',
      tags: ['database'],
      source_type: 'observed',
    });

    // Save an "old" entry by backdating its created_at directly in the DB
    const old = await kb.save({
      category: 'decision',
      title: 'Use MySQL for database',
      content: 'We decided to use MySQL as our primary database',
      tags: ['database'],
      source_type: 'observed',
    });

    // Backdate the old entry by 30 days
    storage.exec(
      'UPDATE knowledge SET created_at = ? WHERE id = ?',
      [now - THIRTY_DAYS_MS, old.id]
    );

    // Search for "database" — both should match
    const results = kb.search('database');
    assert.ok(results.length >= 2, `expected at least 2 results, got ${results.length}`);

    const recentResult = results.find(r => r.id === recent.id);
    const oldResult = results.find(r => r.id === old.id);
    assert.ok(recentResult, 'recent entry should appear in results');
    assert.ok(oldResult, 'old entry should appear in results');
    assert.ok(
      recentResult!.relevance_score > oldResult!.relevance_score,
      `recent score (${recentResult!.relevance_score}) should be higher than old score (${oldResult!.relevance_score})`
    );
  });

  it('frequently accessed entries resist decay', async () => {
    const now = Date.now();
    const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;

    // Save two entries, both old
    const accessed = await kb.save({
      category: 'pattern',
      title: 'Singleton pattern for logging',
      content: 'Use singleton pattern for the logging service',
      tags: ['pattern', 'logging'],
      source_type: 'observed',
    });

    const neglected = await kb.save({
      category: 'pattern',
      title: 'Singleton pattern for caching',
      content: 'Use singleton pattern for the caching layer',
      tags: ['pattern', 'caching'],
      source_type: 'observed',
    });

    // Backdate both entries by 20 days
    storage.exec(
      'UPDATE knowledge SET created_at = ? WHERE id = ?',
      [now - TWENTY_DAYS_MS, accessed.id]
    );
    storage.exec(
      'UPDATE knowledge SET created_at = ? WHERE id = ?',
      [now - TWENTY_DAYS_MS, neglected.id]
    );

    // Give the accessed entry a high access count
    storage.exec(
      'UPDATE knowledge SET access_count = 50 WHERE id = ?',
      [accessed.id]
    );
    // Leave the neglected entry at 0 access count
    storage.exec(
      'UPDATE knowledge SET access_count = 0 WHERE id = ?',
      [neglected.id]
    );

    // Search for "singleton pattern"
    const results = kb.search('singleton pattern');
    assert.ok(results.length >= 2, `expected at least 2 results, got ${results.length}`);

    const accessedResult = results.find(r => r.id === accessed.id);
    const neglectedResult = results.find(r => r.id === neglected.id);
    assert.ok(accessedResult, 'accessed entry should appear in results');
    assert.ok(neglectedResult, 'neglected entry should appear in results');
    assert.ok(
      accessedResult!.relevance_score > neglectedResult!.relevance_score,
      `accessed score (${accessedResult!.relevance_score}) should be higher than neglected score (${neglectedResult!.relevance_score})`
    );
  });

  it('explicit source entries decay slower', async () => {
    const now = Date.now();
    const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;

    // Save an explicit entry
    const explicit = await kb.save({
      category: 'decision',
      title: 'Always use ESLint for linting',
      content: 'Team decided ESLint is the linting standard',
      tags: ['linting'],
      source_type: 'explicit',
    });

    // Save an observed entry with the same age
    const observed = await kb.save({
      category: 'decision',
      title: 'Always use Prettier for linting',
      content: 'Observed that Prettier is used for linting enforcement',
      tags: ['linting'],
      source_type: 'observed',
    });

    // Backdate both by the same amount
    storage.exec(
      'UPDATE knowledge SET created_at = ?, access_count = 0 WHERE id = ?',
      [now - TWENTY_DAYS_MS, explicit.id]
    );
    storage.exec(
      'UPDATE knowledge SET created_at = ?, access_count = 0 WHERE id = ?',
      [now - TWENTY_DAYS_MS, observed.id]
    );

    // Search for "linting"
    const results = kb.search('linting');
    assert.ok(results.length >= 2, `expected at least 2 results, got ${results.length}`);

    const explicitResult = results.find(r => r.id === explicit.id);
    const observedResult = results.find(r => r.id === observed.id);
    assert.ok(explicitResult, 'explicit entry should appear in results');
    assert.ok(observedResult, 'observed entry should appear in results');
    assert.ok(
      explicitResult!.relevance_score > observedResult!.relevance_score,
      `explicit score (${explicitResult!.relevance_score}) should be higher than observed score (${observedResult!.relevance_score})`
    );
  });
});
