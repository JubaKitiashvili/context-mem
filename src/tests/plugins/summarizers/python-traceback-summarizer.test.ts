import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PythonTracebackSummarizer } from '../../../plugins/summarizers/python-traceback-summarizer.js';

const STANDARD_TB = `Traceback (most recent call last):
  File "/home/user/myapp/main.py", line 42, in <module>
    result = process(data)
  File "/home/user/myapp/processor.py", line 18, in process
    return transform(item)
  File "/home/user/myapp/transform.py", line 7, in transform
    raise ValueError("bad input")
ValueError: bad input`;

const LIB_FRAME_TB = `Traceback (most recent call last):
  File "/usr/lib/python3.11/site-packages/django/core/handlers/base.py", line 100, in _get_response
    response = self.process_exception_by_middleware(e, request)
  File "/home/user/myapp/views.py", line 55, in get
    raise PermissionError("Access denied")
PermissionError: Access denied`;

const THREE_FRAME_TB = `Traceback (most recent call last):
  File "/home/user/myapp/app.py", line 10, in run
    self.start()
  File "/home/user/myapp/base.py", line 22, in start
    self.init()
  File "/home/user/myapp/core.py", line 35, in init
    raise RuntimeError("init failed")
RuntimeError: init failed`;

const CHAINED_TB = `Traceback (most recent call last):
  File "/home/user/myapp/db.py", line 12, in connect
    raise ConnectionError("timeout")
ConnectionError: timeout

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/home/user/myapp/main.py", line 5, in <module>
    db.connect()
  File "/home/user/myapp/db.py", line 20, in connect
    raise RuntimeError("db init failed") from e
RuntimeError: db init failed`;

const RANDOM_TRACEBACK_TEXT = `This function has no traceback to speak of.
The word Traceback appears here but there are no frames.
Just some text mentioning traceback and errors generally.`;

const MALFORMED_TB = `Traceback (most recent call last):
(no frames available)
SomeError: something`;

describe('PythonTracebackSummarizer', () => {
  const s = new PythonTracebackSummarizer();

  it('detects a standard CPython traceback', () => {
    assert.equal(s.detect(STANDARD_TB), true);
  });

  it('does not match text that merely contains the word Traceback without frames', () => {
    assert.equal(s.detect(RANDOM_TRACEBACK_TEXT), false);
  });

  it('detects a chained exception traceback', () => {
    assert.equal(s.detect(CHAINED_TB), true);
  });

  it('extracts outer exception type and message correctly', async () => {
    const result = await s.summarize(STANDARD_TB, {});
    assert.ok(result.summary.includes('ValueError'), `Missing type: ${result.summary}`);
    assert.ok(result.summary.includes('bad input'), `Missing message: ${result.summary}`);
    assert.equal(result.content_type, 'python-traceback');
  });

  it('prefers user-code frames over site-packages frames', async () => {
    const result = await s.summarize(LIB_FRAME_TB, {});
    // Primary frame should be from views.py (user code), not django site-packages
    assert.ok(
      result.summary.includes('views.py'),
      `Expected user-code frame (views.py) in: ${result.summary}`,
    );
    assert.ok(
      !result.summary.includes('django/core'),
      `Should not surface lib frame as primary: ${result.summary}`,
    );
  });

  it('handles a 3-frame stack and shows context chain', async () => {
    const result = await s.summarize(THREE_FRAME_TB, {});
    assert.ok(result.summary.includes('RuntimeError'), `Missing type: ${result.summary}`);
    assert.ok(result.summary.includes('init failed'), `Missing message: ${result.summary}`);
    // core.py is the innermost user frame; context frames from app.py and base.py should appear
    assert.ok(result.summary.includes('core.py'), `Missing primary frame: ${result.summary}`);
  });

  it('produces positive token savings', async () => {
    const result = await s.summarize(STANDARD_TB, {});
    assert.ok(result.savings_pct > 0, `Expected savings > 0, got ${result.savings_pct}`);
    assert.ok(result.tokens_original > result.tokens_summarized,
      `Original (${result.tokens_original}) should exceed summarized (${result.tokens_summarized})`);
  });

  it('falls back gracefully on malformed/frameless traceback', async () => {
    const result = await s.summarize(MALFORMED_TB, {});
    // Should not throw and should return a non-empty summary
    assert.ok(result.summary.length > 0, 'Expected non-empty fallback summary');
    assert.equal(result.content_type, 'python-traceback');
  });

  it('detects chained exception with "During handling" pattern', async () => {
    const result = await s.summarize(CHAINED_TB, {});
    // Should surface the outer RuntimeError (last exception in the chain)
    assert.ok(result.summary.includes('RuntimeError'), `Missing RuntimeError: ${result.summary}`);
    assert.ok(result.summary.includes('db init failed'), `Missing message: ${result.summary}`);
  });
});
