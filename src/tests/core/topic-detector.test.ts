import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { detectTopics, storeTopics } from '../../core/topic-detector.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('Topic Detector', () => {
  describe('detectTopics', () => {
    it('detects database topic from keywords', () => {
      const topics = detectTopics('We need to optimize the PostgreSQL query for the users table');
      const names = topics.map(t => t.name);
      assert.ok(names.includes('database'));
    });

    it('detects auth topic', () => {
      const topics = detectTopics('Implement JWT token refresh for the login flow');
      const names = topics.map(t => t.name);
      assert.ok(names.includes('auth'));
    });

    it('detects multiple topics from mixed content', () => {
      const topics = detectTopics('Deploy the Docker container with the new API endpoint and fix the security vulnerability');
      const names = topics.map(t => t.name);
      assert.ok(names.includes('deployment'));
      assert.ok(names.includes('api'));
      assert.ok(names.includes('security'));
    });

    it('returns empty for content without topic keywords', () => {
      const topics = detectTopics('The weather is nice today');
      assert.equal(topics.length, 0);
    });

    it('returns empty for empty content', () => {
      assert.deepEqual(detectTopics(''), []);
      assert.deepEqual(detectTopics('  '), []);
    });

    it('confidence increases with more keyword matches', () => {
      const few = detectTopics('Run the test');
      const many = detectTopics('Run the test suite with jest, check coverage, mock the fixtures, add e2e integration tests');
      const fewTesting = few.find(t => t.name === 'testing');
      const manyTesting = many.find(t => t.name === 'testing');
      assert.ok(fewTesting);
      assert.ok(manyTesting);
      assert.ok(manyTesting!.confidence > fewTesting!.confidence, 'more matches should give higher confidence');
    });

    it('considers entity names for topic detection', () => {
      const topics = detectTopics('Working on the module', undefined, ['PostgreSQL', 'Redis']);
      const names = topics.map(t => t.name);
      assert.ok(names.includes('database'));
    });
  });

  describe('storeTopics', () => {
    let storage: BetterSqlite3Storage;

    before(async () => {
      storage = await createTestDb();
      // Need an observation to link to
      storage.exec(
        `INSERT INTO observations (id, type, content, metadata, indexed_at)
         VALUES ('obs-topic-1', 'context', 'test', '{}', 1000)`,
      );
    });

    after(async () => { await storage.close(); });

    it('creates topic and links to observation', () => {
      storeTopics(storage, 'obs-topic-1', [{ name: 'database', confidence: 0.8 }]);

      const topic = storage.prepare('SELECT id, name, observation_count FROM topics WHERE name = ?').get('database') as {
        id: string; name: string; observation_count: number;
      };
      assert.ok(topic);
      assert.equal(topic.name, 'database');
      assert.equal(topic.observation_count, 1);

      const link = storage.prepare('SELECT confidence FROM observation_topics WHERE observation_id = ? AND topic_id = ?')
        .get('obs-topic-1', topic.id) as { confidence: number };
      assert.equal(link.confidence, 0.8);
    });

    it('increments count for existing topic', () => {
      storage.exec(
        `INSERT INTO observations (id, type, content, metadata, indexed_at)
         VALUES ('obs-topic-2', 'context', 'test2', '{}', 2000)`,
      );
      storeTopics(storage, 'obs-topic-2', [{ name: 'database', confidence: 0.9 }]);

      const topic = storage.prepare('SELECT observation_count FROM topics WHERE name = ?').get('database') as { observation_count: number };
      assert.equal(topic.observation_count, 2);
    });
  });
});
