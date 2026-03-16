import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorSummarizer } from '../../../plugins/summarizers/error-summarizer.js';

const NODE_STACK = `TypeError: Cannot read properties of undefined (reading 'foo')
    at Object.<anonymous> (/home/user/app/src/index.ts:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1364:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1422:10)
    at Module.load (node:internal/modules/cjs/loader:1203:32)
    at Module._load (node:internal/modules/cjs/loader:1019:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:128:12)
    at node:internal/main/run_main_module:28:49
    at node:internal/bootstrap/node:451:3
    at node:internal/bootstrap/node:600:3
    at node:internal/bootstrap/node:700:5`;

const PYTHON_STACK = `Traceback (most recent call last):
  File "/home/user/app/main.py", line 42, in <module>
    result = process(data)
  File "/home/user/app/processor.py", line 18, in process
    return transform(item)
  File "/home/user/app/transform.py", line 7, in transform
    raise ValueError("bad input")
ValueError: bad input`;

describe('ErrorSummarizer', () => {
  const summarizer = new ErrorSummarizer();

  it('detects Node.js stack trace', () => {
    assert.equal(summarizer.detect(NODE_STACK), true);
  });

  it('detects Python traceback', () => {
    assert.equal(summarizer.detect(PYTHON_STACK), true);
  });

  it('does not detect regular content', () => {
    const regular = 'Hello world\nThis is just some normal text.\nNo errors here.';
    assert.equal(summarizer.detect(regular), false);
  });

  it('summarizes Node.js error', async () => {
    const result = await summarizer.summarize(NODE_STACK, {});
    // Must include error type and message
    assert.ok(result.summary.includes('TypeError'), `Missing error type in: ${result.summary}`);
    assert.ok(
      result.summary.includes("Cannot read properties of undefined"),
      `Missing message in: ${result.summary}`,
    );
    // Must include exactly 3 "at" frames
    const frameMatches = result.summary.match(/\bat\s+/g) ?? [];
    assert.equal(frameMatches.length, 3, `Expected 3 frames, got ${frameMatches.length}`);
    // Savings should be significant for a 10-frame trace
    assert.ok(result.savings_pct > 0, `Expected positive savings, got ${result.savings_pct}`);
  });

  it('summarizes Python traceback', async () => {
    const result = await summarizer.summarize(PYTHON_STACK, {});
    // Must include error type and message
    assert.ok(result.summary.includes('ValueError'), `Missing error type in: ${result.summary}`);
    assert.ok(result.summary.includes('bad input'), `Missing message in: ${result.summary}`);
    // Must include up to 3 "File" frames
    const fileMatches = result.summary.match(/File "/g) ?? [];
    assert.ok(fileMatches.length >= 1 && fileMatches.length <= 3,
      `Expected 1–3 File frames, got ${fileMatches.length}`);
    assert.ok(result.savings_pct > 0, `Expected positive savings, got ${result.savings_pct}`);
  });

  it('handles generic error without stack', async () => {
    const genericError = 'Error: something broke';
    const result = await summarizer.summarize(genericError, {});
    assert.ok(
      result.summary.includes('something broke') || result.summary.includes('Error'),
      `Expected error message in summary: ${result.summary}`,
    );
  });
});
