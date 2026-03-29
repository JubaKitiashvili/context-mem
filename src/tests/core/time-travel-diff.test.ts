import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TimeTraveler } from '../../core/time-travel.js';
import { createTestDb } from '../helpers.js';

describe('time-travel diff', () => {
  it('returns knowledge added between dates', async () => {
    const storage = await createTestDb();
    const tt = new TimeTraveler(storage);

    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;

    // Insert knowledge at different times
    storage.exec(
      'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, last_accessed, archived, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['k-old', 'pattern', 'Old entry', 'content', '[]', 1, 1, 0, yesterday - 100000, yesterday, 0, 'explicit'],
    );
    storage.exec(
      'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, last_accessed, archived, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['k-new', 'decision', 'New entry', 'content', '[]', 1, 1, 0, now - 1000, now, 0, 'explicit'],
    );

    const result = tt.diff(new Date(yesterday).toISOString(), new Date(now + 1000).toISOString());
    assert.ok(result.knowledge.added.length >= 1, 'should find added entries');
    assert.ok(result.knowledge.added.some(e => e.id === 'k-new'));

    await storage.close();
  });

  it('excludes entries outside the date range', async () => {
    const storage = await createTestDb();
    const tt = new TimeTraveler(storage);

    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;

    storage.exec(
      'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, last_accessed, archived, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['k-old', 'pattern', 'Old entry', 'content', '[]', 1, 1, 0, yesterday - 100000, yesterday, 0, 'explicit'],
    );

    // Query only a window AFTER old entry
    const result = tt.diff(new Date(yesterday).toISOString(), new Date(now + 1000).toISOString());
    assert.ok(!result.knowledge.added.some(e => e.id === 'k-old'), 'old entry should be excluded');

    await storage.close();
  });

  it('returns empty diff when no data in range', async () => {
    const storage = await createTestDb();
    const tt = new TimeTraveler(storage);

    const now = Date.now();
    const result = tt.diff(new Date(now - 1000).toISOString(), new Date(now).toISOString());

    assert.deepEqual(result.knowledge.added, []);
    assert.deepEqual(result.knowledge.archived, []);
    assert.equal(result.observations.count, 0);
    assert.deepEqual(result.events, []);

    await storage.close();
  });

  it('returns observations by type', async () => {
    const storage = await createTestDb();
    const tt = new TimeTraveler(storage);

    const now = Date.now();

    storage.exec(
      "INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['obs-1', 'code', 'code content', 'summary', '{}', now - 500, 'public'],
    );
    storage.exec(
      "INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['obs-2', 'error', 'error content', 'summary', '{}', now - 500, 'public'],
    );

    const result = tt.diff(new Date(now - 1000).toISOString(), new Date(now + 1000).toISOString());

    assert.equal(result.observations.count, 2);
    assert.equal(result.observations.by_type['code'], 1);
    assert.equal(result.observations.by_type['error'], 1);

    await storage.close();
  });
});
