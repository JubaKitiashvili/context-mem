import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTemporalRange, stripTemporalExpressions, inTemporalRange } from '../../plugins/search/temporal-resolver.js';

describe('temporal-resolver', () => {
  const ref = new Date('2023-03-25T00:00:00Z');

  describe('resolveTemporalRange', () => {
    it('resolves "10 days ago"', () => {
      const r = resolveTemporalRange('What did I buy 10 days ago?', ref);
      assert.ok(r);
      assert.equal(r!.confidence, 'high');
      // March 25 - 10 days = March 15, ±1 day tolerance
      const expected = new Date('2023-03-15T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('resolves "N days ago" with word number', () => {
      const r = resolveTemporalRange('Five days ago I went...', ref);
      assert.ok(r);
      const expected = new Date('2023-03-20T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('resolves "a week ago"', () => {
      const r = resolveTemporalRange('What happened a week ago?', ref);
      assert.ok(r);
      const expected = new Date('2023-03-18T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('resolves "four weeks ago"', () => {
      const r = resolveTemporalRange('business milestone four weeks ago', ref);
      assert.ok(r);
      const expected = new Date('2023-02-25T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('resolves "last Saturday" correctly', () => {
      // March 25 2023 is a Saturday. "last Saturday" means one week back.
      const r = resolveTemporalRange('last Saturday', ref);
      assert.ok(r);
      const expected = new Date('2023-03-18T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('resolves "last Thursday" from a Saturday ref', () => {
      // March 25 is Sat. Last Thu is March 23.
      const r = resolveTemporalRange('last Thursday', ref);
      assert.ok(r);
      const expected = new Date('2023-03-23T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('resolves "yesterday"', () => {
      const r = resolveTemporalRange('yesterday I did something', ref);
      assert.ok(r);
      const expected = new Date('2023-03-24T00:00:00Z');
      assert.ok(inTemporalRange(expected, r!));
    });

    it('returns null for queries without temporal expressions', () => {
      const r = resolveTemporalRange('What is my favorite color?', ref);
      assert.equal(r, null);
    });

    it('handles "couple of days ago" with tolerance', () => {
      const r = resolveTemporalRange('a couple of days ago', ref);
      assert.ok(r);
      assert.equal(r!.confidence, 'medium');
    });
  });

  describe('stripTemporalExpressions', () => {
    it('strips temporal phrases from queries', () => {
      assert.equal(stripTemporalExpressions('jewelry I got last Saturday'), 'jewelry I got');
      assert.equal(stripTemporalExpressions('What did I buy 10 days ago?'), 'What did I buy ?');
      assert.equal(stripTemporalExpressions('business milestone four weeks ago'), 'business milestone');
    });

    it('returns original query when no temporal expressions', () => {
      assert.equal(stripTemporalExpressions('What is my favorite color?'), 'What is my favorite color?');
    });
  });

  describe('inTemporalRange', () => {
    it('returns true for date inside range', () => {
      const range = {
        start: new Date('2023-03-14T00:00:00Z'),
        end: new Date('2023-03-16T00:00:00Z'),
        confidence: 'high' as const,
        matched: '10 days ago',
      };
      assert.equal(inTemporalRange(new Date('2023-03-15T12:00:00Z'), range), true);
      assert.equal(inTemporalRange(new Date('2023-03-13T00:00:00Z'), range), false);
    });
  });
});
