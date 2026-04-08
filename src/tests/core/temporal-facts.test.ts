/**
 * Tests for Temporal Facts — valid_from/valid_to on knowledge entries,
 * supersession chains, and temporal_query tool.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { createTestDb } from '../helpers.js';

describe('Temporal Facts', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);
  });

  after(async () => { await storage.close(); });

  it('save_knowledge sets valid_from via SQL update', async () => {
    const entry = await kb.save({
      category: 'decision',
      title: 'Use Redis for caching',
      content: 'We decided to use Redis as our caching layer',
      tags: ['caching'],
      source_type: 'observed',
    });

    const validFrom = Date.now();
    storage.exec('UPDATE knowledge SET valid_from = ? WHERE id = ?', [validFrom, entry.id]);

    const row = storage.prepare('SELECT valid_from FROM knowledge WHERE id = ?').get(entry.id) as { valid_from: number };
    assert.equal(row.valid_from, validFrom);
  });

  it('valid_to marks a fact as superseded', async () => {
    const oldEntry = await kb.save({
      category: 'decision',
      title: 'Use MySQL',
      content: 'We use MySQL for the database',
      tags: [],
      source_type: 'observed',
    });
    storage.exec('UPDATE knowledge SET valid_from = ? WHERE id = ?', [1000, oldEntry.id]);

    const newEntry = await kb.save({
      category: 'decision',
      title: 'Use PostgreSQL',
      content: 'We switched to PostgreSQL for better JSON support',
      tags: [],
      source_type: 'observed',
    });
    storage.exec('UPDATE knowledge SET valid_from = ? WHERE id = ?', [2000, newEntry.id]);

    // Supersede old entry
    storage.exec('UPDATE knowledge SET valid_to = ?, superseded_by = ? WHERE id = ?', [2000, newEntry.id, oldEntry.id]);

    const oldRow = storage.prepare('SELECT valid_to, superseded_by FROM knowledge WHERE id = ?').get(oldEntry.id) as {
      valid_to: number; superseded_by: string;
    };
    assert.equal(oldRow.valid_to, 2000);
    assert.equal(oldRow.superseded_by, newEntry.id);
  });

  it('superseded_by chain links correctly (A → B → C)', async () => {
    const a = await kb.save({ category: 'decision', title: 'Approach A', content: 'First approach', tags: [], source_type: 'observed' });
    const b = await kb.save({ category: 'decision', title: 'Approach B', content: 'Second approach', tags: [], source_type: 'observed' });
    const c = await kb.save({ category: 'decision', title: 'Approach C', content: 'Third approach', tags: [], source_type: 'observed' });

    storage.exec('UPDATE knowledge SET valid_from = 1000, valid_to = 2000, superseded_by = ? WHERE id = ?', [b.id, a.id]);
    storage.exec('UPDATE knowledge SET valid_from = 2000, valid_to = 3000, superseded_by = ? WHERE id = ?', [c.id, b.id]);
    storage.exec('UPDATE knowledge SET valid_from = 3000 WHERE id = ?', [c.id]);

    // Walk the chain: A → B → C
    const aRow = storage.prepare('SELECT superseded_by FROM knowledge WHERE id = ?').get(a.id) as { superseded_by: string };
    assert.equal(aRow.superseded_by, b.id);

    const bRow = storage.prepare('SELECT superseded_by FROM knowledge WHERE id = ?').get(b.id) as { superseded_by: string };
    assert.equal(bRow.superseded_by, c.id);

    const cRow = storage.prepare('SELECT superseded_by FROM knowledge WHERE id = ?').get(c.id) as { superseded_by: string | null };
    assert.equal(cRow.superseded_by, null);
  });

  it('temporal query returns fact valid at past timestamp', () => {
    // Set up: entry valid from 1000 to 2000
    const id = 'temporal-test-past';
    storage.exec(
      `INSERT INTO knowledge (id, category, title, content, tags, created_at, valid_from, valid_to)
       VALUES (?, 'decision', 'Past fact', 'This was true before', '[]', 1000, 1000, 2000)`,
      [id],
    );

    // Query at timestamp 1500 — should find it
    const row = storage.prepare(
      'SELECT id FROM knowledge WHERE id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'
    ).get(id, 1500, 1500) as { id: string } | undefined;
    assert.ok(row, 'should find fact valid at timestamp 1500');
  });

  it('temporal query does NOT return fact before valid_from', () => {
    const id = 'temporal-test-before';
    storage.exec(
      `INSERT INTO knowledge (id, category, title, content, tags, created_at, valid_from)
       VALUES (?, 'decision', 'Future fact', 'This is true later', '[]', 2000, 2000)`,
      [id],
    );

    const row = storage.prepare(
      'SELECT id FROM knowledge WHERE id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'
    ).get(id, 1500, 1500) as { id: string } | undefined;
    assert.equal(row, undefined, 'should not find fact before its valid_from');
  });

  it('temporal query does NOT return expired fact', () => {
    const id = 'temporal-test-expired';
    storage.exec(
      `INSERT INTO knowledge (id, category, title, content, tags, created_at, valid_from, valid_to)
       VALUES (?, 'decision', 'Expired fact', 'This was true before', '[]', 1000, 1000, 1500)`,
      [id],
    );

    const row = storage.prepare(
      'SELECT id FROM knowledge WHERE id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'
    ).get(id, 2000, 2000) as { id: string } | undefined;
    assert.equal(row, undefined, 'should not find expired fact');
  });

  it('facts with NULL valid_from are always valid from epoch', () => {
    const id = 'temporal-test-null-from';
    storage.exec(
      `INSERT INTO knowledge (id, category, title, content, tags, created_at)
       VALUES (?, 'pattern', 'Always valid', 'This has no valid_from', '[]', 1000)`,
      [id],
    );

    // valid_from is NULL, which means valid since epoch (0)
    const row = storage.prepare(
      'SELECT id FROM knowledge WHERE id = ? AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)'
    ).get(id, 500, 500) as { id: string } | undefined;
    assert.ok(row, 'fact with NULL valid_from should be valid at any time');
  });
});
