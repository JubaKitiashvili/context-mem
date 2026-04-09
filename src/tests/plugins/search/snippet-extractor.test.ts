import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBestSnippet } from '../../../plugins/search/snippet-extractor.js';

describe('extractBestSnippet', () => {
  it('returns the most relevant sentence', () => {
    const text = 'The project uses React for the frontend. Database migrations run with Prisma. Authentication is handled by NextAuth with JWT tokens.';
    const snippet = extractBestSnippet(text, 'authentication JWT tokens', 300);
    assert.ok(snippet.includes('Authentication'), `Expected snippet about auth, got: ${snippet}`);
  });

  it('returns full text if shorter than maxLen', () => {
    const text = 'Short text here.';
    assert.equal(extractBestSnippet(text, 'anything', 300), text);
  });

  it('handles empty text', () => {
    assert.equal(extractBestSnippet('', 'query', 300), '');
  });

  it('falls back to first sentence if no match', () => {
    const text = 'First sentence about nothing. Second sentence about nothing. Third sentence.';
    const snippet = extractBestSnippet(text, 'xyznonexistent', 300);
    assert.ok(snippet.includes('First'), 'Should fall back to first sentence');
  });

  it('respects maxLen', () => {
    const text = 'A'.repeat(500) + '. Short sentence.';
    const snippet = extractBestSnippet(text, 'test', 50);
    assert.ok(snippet.length <= 50, `Snippet too long: ${snippet.length}`);
  });
});
