import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ShellSummarizer } from '../../../plugins/summarizers/shell-summarizer.js';

describe('ShellSummarizer', () => {
  let summarizer: ShellSummarizer;

  it('detects command-like output', () => {
    summarizer = new ShellSummarizer();
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}: some output`).join('\n');
    assert.equal(summarizer.detect(lines), true);
  });

  it('does not detect short output', () => {
    summarizer = new ShellSummarizer();
    assert.equal(summarizer.detect('hello'), false);
  });

  it('summarizes by keeping first/last lines', async () => {
    summarizer = new ShellSummarizer();
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const result = await summarizer.summarize(lines, {});
    assert.ok(result.summary.includes('line 0'));
    assert.ok(result.summary.includes('line 99'));
    assert.ok(result.summary.includes('100 lines'));
    assert.ok(result.savings_pct > 50);
  });

  it('returns full content if under threshold', async () => {
    summarizer = new ShellSummarizer();
    const short = 'line 1\nline 2\nline 3';
    const result = await summarizer.summarize(short, {});
    assert.equal(result.summary, short);
  });
});
