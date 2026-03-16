import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ulid, estimateTokens, fnv1a64 } from '../../core/utils.js';

describe('ulid', () => {
  it('generates 26-char string', () => {
    const id = ulid();
    assert.equal(id.length, 26);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid()));
    assert.equal(ids.size, 100);
  });

  it('is sortable by time', async () => {
    const a = ulid();
    await new Promise(r => setTimeout(r, 2));
    const b = ulid();
    assert.ok(a < b);
  });
});

describe('estimateTokens', () => {
  it('estimates tokens from string length', () => {
    const text = 'hello world this is a test';
    const tokens = estimateTokens(text);
    assert.ok(tokens > 0);
    assert.ok(tokens < text.length);
  });

  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });
});

describe('fnv1a64', () => {
  it('returns consistent hash for same input', () => {
    assert.equal(fnv1a64('hello'), fnv1a64('hello'));
  });

  it('returns different hash for different input', () => {
    assert.notEqual(fnv1a64('hello'), fnv1a64('world'));
  });

  it('returns a string', () => {
    assert.equal(typeof fnv1a64('test'), 'string');
  });
});
