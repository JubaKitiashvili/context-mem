/**
 * Tests for TimeTraveler — time-travel debugging.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TimeTraveler } from '../../core/time-travel.js';
import { createTestDb } from '../helpers.js';
import type { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';

describe('TimeTraveler', () => {
  let storage: BetterSqlite3Storage;
  let traveler: TimeTraveler;

  // Fixed reference timestamps
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const fiveDaysAgo = now - 5 * DAY;
  const threeDaysAgo = now - 3 * DAY;
  const oneDayAgo = now - 1 * DAY;

  before(async () => {
    storage = await createTestDb();
    traveler = new TimeTraveler(storage);

    // Seed observations at different times
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-1', 'code', 'old code', 'old code summary', '{}', fiveDaysAgo, 'public'],
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-2', 'error', 'recent error', 'error summary', '{}', oneDayAgo, 'public'],
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-3', 'decision', 'latest decision', 'decision summary', '{}', now, 'public'],
    );

    // Seed knowledge at different times
    storage.exec(
      `INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['kn-1', 'pattern', 'Old pattern', 'Pattern content', '["old"]', 1, 1.0, 0, fiveDaysAgo, 0],
    );
    storage.exec(
      `INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['kn-2', 'decision', 'New decision', 'Decision content', '["new"]', 1, 1.0, 0, oneDayAgo, 0],
    );

    // Seed events at different times
    storage.exec(
      `INSERT INTO events (id, session_id, event_type, priority, data, context_bytes, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['ev-1', 'sess-1', 'observation', 4, '{}', 0, fiveDaysAgo],
    );
    storage.exec(
      `INSERT INTO events (id, session_id, event_type, priority, data, context_bytes, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['ev-2', 'sess-1', 'knowledge_created', 3, '{}', 0, oneDayAgo],
    );
    storage.exec(
      `INSERT INTO events (id, session_id, event_type, priority, data, context_bytes, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['ev-3', 'sess-1', 'error_detected', 2, '{}', 0, now],
    );
  });

  after(async () => {
    await storage.close();
  });

  // -----------------------------------------------------------------------
  // parseDate tests
  // -----------------------------------------------------------------------

  describe('parseDate', () => {
    it('handles "3 days ago"', () => {
      const before = Date.now();
      const result = traveler.parseDate('3 days ago');
      const expected = before - 3 * DAY;
      // Allow 100ms tolerance for execution time
      assert.ok(Math.abs(result - expected) < 100, `Expected ~${expected}, got ${result}`);
    });

    it('handles "last week"', () => {
      const before = Date.now();
      const result = traveler.parseDate('last week');
      const expected = before - 7 * DAY;
      assert.ok(Math.abs(result - expected) < 100, `Expected ~${expected}, got ${result}`);
    });

    it('handles "yesterday"', () => {
      const before = Date.now();
      const result = traveler.parseDate('yesterday');
      const expected = before - 1 * DAY;
      assert.ok(Math.abs(result - expected) < 100, `Expected ~${expected}, got ${result}`);
    });

    it('handles ISO date string', () => {
      const result = traveler.parseDate('2026-03-25');
      const expected = new Date('2026-03-25').getTime();
      assert.equal(result, expected);
    });
  });

  // -----------------------------------------------------------------------
  // snapshot tests
  // -----------------------------------------------------------------------

  describe('snapshot', () => {
    it('returns correct data for target date', () => {
      // Snapshot at threeDaysAgo should only see fiveDaysAgo items
      const snap = traveler.snapshot(threeDaysAgo, 'all');
      assert.equal(snap.observations.total, 1, 'should see 1 observation from 5 days ago');
      assert.equal(snap.knowledge.total, 1, 'should see 1 knowledge from 5 days ago');
      assert.equal(snap.events.total, 1, 'should see 1 event from 5 days ago');
    });

    it('respects scope filter', () => {
      const snap = traveler.snapshot(now + 1000, 'knowledge');
      // Only knowledge should be populated, observations and events should be empty
      assert.ok(snap.knowledge.total > 0, 'knowledge should have entries');
      assert.equal(snap.observations.total, 0, 'observations should be empty when scope is knowledge');
      assert.equal(snap.events.total, 0, 'events should be empty when scope is knowledge');
    });
  });

  // -----------------------------------------------------------------------
  // compare test
  // -----------------------------------------------------------------------

  describe('compare', () => {
    it('shows delta between dates', () => {
      const delta = traveler.compare(threeDaysAgo);
      // Since threeDaysAgo, 2 more observations were added (oneDayAgo + now)
      assert.equal(delta.observations.total_then, 1);
      assert.equal(delta.observations.total_now, 3);
      assert.equal(delta.observations.added, 2);
      // Since threeDaysAgo, 1 more knowledge was added (oneDayAgo)
      assert.equal(delta.knowledge.total_then, 1);
      assert.equal(delta.knowledge.total_now, 2);
      assert.equal(delta.knowledge.added, 1);
      // Events between threeDaysAgo and now: 2 (oneDayAgo + now)
      assert.equal(delta.events.between, 2);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('invalid date returns error', () => {
      assert.throws(
        () => traveler.parseDate('not a real date at all xyz'),
        { message: /Cannot parse date/ },
      );
    });
  });
});
