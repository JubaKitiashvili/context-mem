import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { truncate, MAX_PASSTHROUGH } from '../../core/truncation.js';

describe('truncation', () => {
  it('passes through short content unchanged', () => {
    const short = 'hello world';
    const result = truncate(short);
    assert.equal(result.content, short);
    assert.equal(result.tier, 3);
  });

  it('passes through content within MAX_PASSTHROUGH', () => {
    const content = 'x\n'.repeat(100);
    const result = truncate(content);
    assert.equal(result.content, content);
  });

  it('applies 60/40 head/tail line split on large content', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line-${i}`);
    const content = lines.join('\n');
    const result = truncate(content);

    assert.equal(result.tier, 3);
    // Should contain the header showing total lines
    assert.ok(result.content.includes('[2000 lines total]'));
    // Should contain the omitted marker
    assert.ok(result.content.includes('lines omitted'));

    // Verify 60/40 split: first 600 lines preserved, last 400 lines preserved
    // Head: line-0 through line-599
    assert.ok(result.content.includes('line-0'));
    assert.ok(result.content.includes('line-599'));
    // line-600 should be omitted (first omitted line)
    assert.ok(!result.content.includes('line-600\n') || result.content.indexOf('line-600') > result.content.indexOf('omitted'));

    // Tail: line-1600 through line-1999
    assert.ok(result.content.includes('line-1600'));
    assert.ok(result.content.includes('line-1999'));
  });

  it('preserves error lines at the end with 60/40 split', () => {
    // Generate 2000 lines: 1900 filler + 100 error lines at the end
    const filler = Array.from({ length: 1900 }, (_, i) => `info: processing item ${i}`);
    const errors = Array.from({ length: 100 }, (_, i) => `CRITICAL_BUG: problem at step ${i}`);
    const content = [...filler, ...errors].join('\n');
    const result = truncate(content);

    assert.equal(result.tier, 3);

    // With 400 tail lines, all 100 error lines should be preserved
    // (they are in the last 100 lines, well within the 400 tail window)
    for (let i = 0; i < 100; i++) {
      assert.ok(
        result.content.includes(`CRITICAL_BUG: problem at step ${i}`),
        `Error line ${i} should be preserved in tail`
      );
    }
  });

  it('applies aggressive 60/40 split (240 head / 160 tail)', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line-${i}`);
    const content = lines.join('\n');
    const result = truncate(content, true);

    assert.equal(result.tier, 3);
    // Head: line-0 through line-239
    assert.ok(result.content.includes('line-0'));
    assert.ok(result.content.includes('line-239'));

    // Tail: line-1840 through line-1999
    assert.ok(result.content.includes('line-1840'));
    assert.ok(result.content.includes('line-1999'));

    // Omitted count: 2000 - 240 - 160 = 1600
    assert.ok(result.content.includes('1600 lines omitted'));
  });

  it('applies char-level 60/40 split when lines are few but content is large', () => {
    // Create content with few lines but lots of chars (exceeds 8000 char budget)
    const longLine = 'x'.repeat(5000);
    const content = `${longLine}\n${longLine}`;
    const result = truncate(content);

    assert.equal(result.tier, 3);
    assert.ok(result.content.includes('chars omitted'));
    // Head budget = 600 * 8 = 4800 chars, tail budget = 400 * 8 = 3200 chars
    // The head portion should be 4800 chars
    const parts = result.content.split('chars omitted');
    assert.ok(parts.length === 2, 'Should have exactly one omission marker');
  });
});
