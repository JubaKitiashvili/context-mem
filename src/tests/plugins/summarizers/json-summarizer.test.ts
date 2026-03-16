import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JsonSummarizer } from '../../../plugins/summarizers/json-summarizer.js';

describe('JsonSummarizer', () => {
  const summarizer = new JsonSummarizer();

  it('detects JSON content', () => {
    assert.equal(summarizer.detect('{"key": "value"}'), true);
    assert.equal(summarizer.detect('[1, 2, 3]'), true);
    assert.equal(summarizer.detect('not json'), false);
  });

  it('summarizes object as schema', async () => {
    const json = JSON.stringify({ name: 'John', age: 30, scores: [1, 2, 3] });
    const result = await summarizer.summarize(json, {});
    assert.ok(result.summary.includes('name'));
    assert.ok(result.summary.includes('string'));
    assert.ok(result.summary.includes('number'));
    assert.ok(result.summary.includes('array[3]'));
  });

  it('summarizes array of objects', async () => {
    const json = JSON.stringify([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ]);
    const result = await summarizer.summarize(json, {});
    assert.ok(result.summary.includes('array[3]'));
    assert.ok(result.summary.includes('id'));
  });

  it('handles nested objects', async () => {
    const json = JSON.stringify({ user: { profile: { name: 'test' } } });
    const result = await summarizer.summarize(json, {});
    assert.ok(result.summary.includes('user'));
    assert.ok(result.summary.includes('profile'));
  });
});
