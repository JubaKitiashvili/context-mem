import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateTitle, generateTags } from '../../core/auto-tagger.js';

describe('auto-tagger', () => {
  describe('generateTitle', () => {
    it('extracts first sentence as title', () => {
      const title = generateTitle('Use refresh token rotation for JWT auth. This prevents token theft.');
      assert.equal(title, 'Use refresh token rotation for JWT auth.');
    });

    it('falls back to keywords when no sentence', () => {
      const title = generateTitle('jwt refresh token rotation authentication security tokens');
      assert.ok(title.length > 0);
      assert.ok(title.length <= 80);
    });

    it('truncates long content', () => {
      const title = generateTitle('A'.repeat(200));
      assert.ok(title.length <= 80);
    });
  });

  describe('generateTags', () => {
    it('extracts top keywords as tags', () => {
      const tags = generateTags('PostgreSQL connection pooling improves PostgreSQL performance for database connections');
      assert.ok(tags.includes('postgresql'));
      assert.ok(tags.includes('connection') || tags.includes('pooling'));
      assert.ok(tags.length <= 5);
    });

    it('filters stopwords', () => {
      const tags = generateTags('the quick brown fox jumps over the lazy dog');
      assert.ok(!tags.includes('the'));
      assert.ok(!tags.includes('over'));
    });

    it('returns empty array for empty content', () => {
      const tags = generateTags('');
      assert.deepEqual(tags, []);
    });
  });
});
