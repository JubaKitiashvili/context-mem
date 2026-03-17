import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFTS5Query } from '../../../plugins/search/fts5-utils.js';

describe('sanitizeFTS5Query', () => {
  it('wraps single term in quotes', () => {
    assert.equal(sanitizeFTS5Query('hello'), '"hello"');
  });

  it('wraps multiple terms in quotes separated by space', () => {
    assert.equal(sanitizeFTS5Query('hello world'), '"hello" "world"');
  });

  it('escapes internal double quotes', () => {
    assert.equal(sanitizeFTS5Query('say "hi"'), '"say" """hi"""');
  });

  it('returns empty quoted string for empty input', () => {
    assert.equal(sanitizeFTS5Query(''), '""');
  });

  it('handles special characters (parentheses, asterisks, etc.)', () => {
    const result = sanitizeFTS5Query('foo(bar) baz*');
    assert.equal(result, '"foo(bar)" "baz*"');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeFTS5Query('  hello  '), '"hello"');
    assert.equal(sanitizeFTS5Query('  foo   bar  '), '"foo" "bar"');
  });
});
