import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignalScore } from '../../core/noise-filter.js';

describe('computeSignalScore', () => {
  it('scores high-quality content above 0.5', () => {
    const content = 'The authentication system uses JWT tokens for session management. When a user logs in, the server generates a signed token containing the user ID and expiration time.';
    const score = computeSignalScore(content);
    assert.ok(score > 0.5, `Expected > 0.5, got ${score}`);
  });

  it('scores repetitive content below 0.5', () => {
    const content = 'loading...\nloading...\nloading...\nloading...\nloading...\nloading...\nloading...\nloading...\nloading...\nloading...';
    const score = computeSignalScore(content);
    assert.ok(score < 0.5, `Expected < 0.5, got ${score}`);
  });

  it('scores separator lines as noisy', () => {
    const content = '========================================\n========================================\n========================================';
    const score = computeSignalScore(content);
    assert.ok(score < 0.5, `Expected < 0.5, got ${score}`);
  });

  it('scores normal conversation as high signal', () => {
    const content = 'I prefer using PostgreSQL for production databases. The JSON support is excellent and the query planner handles complex joins well. For development, SQLite works fine.';
    const score = computeSignalScore(content);
    assert.ok(score > 0.6, `Expected > 0.6, got ${score}`);
  });

  it('returns a value between 0 and 1', () => {
    const contents = ['hello world', '', 'a'.repeat(1000), 'the quick brown fox jumped over the lazy dog'];
    for (const c of contents) {
      const score = computeSignalScore(c);
      assert.ok(score >= 0 && score <= 1, `Score ${score} out of range for "${c.slice(0, 30)}"`);
    }
  });
});
