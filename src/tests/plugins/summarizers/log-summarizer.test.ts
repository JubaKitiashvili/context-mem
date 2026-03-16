import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LogSummarizer } from '../../../plugins/summarizers/log-summarizer.js';

describe('LogSummarizer', () => {
  let summarizer: LogSummarizer;

  it('detects log-like content', () => {
    summarizer = new LogSummarizer();
    const lines = [
      '2024-01-01 12:00:00 [INFO] Server started on port 3000',
      '2024-01-01 12:00:01 [INFO] Connecting to database',
      '2024-01-01 12:00:02 [ERROR] Connection refused: ECONNREFUSED',
      '2024-01-01 12:00:03 [WARN] Retrying in 5 seconds',
      '2024-01-01 12:00:08 [INFO] Connected to database',
      '2024-01-01 12:00:09 [DEBUG] Query executed in 12ms',
      '2024-01-01 12:00:10 [INFO] Request GET /api/users',
      '2024-01-01 12:00:10 [INFO] Response 200 OK',
      '2024-01-01 12:00:11 [ERROR] Unhandled exception in worker',
      '2024-01-01 12:00:12 [INFO] Shutdown initiated',
    ];
    assert.equal(summarizer.detect(lines.join('\n')), true);
  });

  it('detects content with bare log levels', () => {
    summarizer = new LogSummarizer();
    const lines = Array.from({ length: 15 }, (_, i) =>
      `INFO: processing item ${i} at 12:00:${String(i).padStart(2, '0')}`
    );
    assert.equal(summarizer.detect(lines.join('\n')), true);
  });

  it('does not detect non-log content', () => {
    summarizer = new LogSummarizer();
    const code = [
      'function hello() {',
      '  const x = 1;',
      '  const y = 2;',
      '  return x + y;',
      '}',
      '',
      'const result = hello();',
      'console.log(result);',
      'export default hello;',
      'module.exports = { hello };',
    ].join('\n');
    assert.equal(summarizer.detect(code), false);
  });

  it('does not detect short log content (under 10 lines)', () => {
    summarizer = new LogSummarizer();
    const lines = [
      '2024-01-01 [INFO] Line 1',
      '2024-01-01 [ERROR] Line 2',
      '2024-01-01 [WARN] Line 3',
    ].join('\n');
    assert.equal(summarizer.detect(lines), false);
  });

  it('deduplicates repeated lines', async () => {
    summarizer = new LogSummarizer();
    const repeatedLine = '2024-01-01 12:00:00 [ERROR] connection failed';
    const lines = Array.from({ length: 50 }, () => repeatedLine);
    const content = lines.join('\n');
    const result = await summarizer.summarize(content, {});

    // Should appear only once with count annotation
    const summaryLines = result.summary.split('\n').filter(l => l.trim());
    assert.equal(summaryLines.length, 1);
    assert.ok(result.summary.includes('×50'), `Expected ×50 in: ${result.summary}`);
    assert.ok(result.savings_pct > 0);
  });

  it('keeps unique lines', async () => {
    summarizer = new LogSummarizer();
    const lines = [
      '2024-01-01 12:00:00 [INFO] Server started',
      '2024-01-01 12:00:01 [DEBUG] Config loaded',
      '2024-01-01 12:00:02 [INFO] Listening on port 8080',
      '2024-01-01 12:00:03 [WARN] Low memory warning',
      '2024-01-01 12:00:04 [ERROR] Database timeout',
      '2024-01-01 12:00:05 [INFO] Retrying connection',
      '2024-01-01 12:00:06 [INFO] Connection restored',
      '2024-01-01 12:00:07 [DEBUG] Cache warmed up',
      '2024-01-01 12:00:08 [TRACE] Request received',
      '2024-01-01 12:00:09 [FATAL] Out of memory',
    ];
    const content = lines.join('\n');
    const result = await summarizer.summarize(content, {});

    // All 10 unique lines should be preserved (no count annotation)
    assert.ok(!result.summary.includes('×'), 'Should not have count annotations for unique lines');
    const summaryLines = result.summary.split('\n').filter(l => l.trim());
    assert.equal(summaryLines.length, 10);
  });

  it('handles mixed log levels — dedups per-line, preserves different levels', async () => {
    summarizer = new LogSummarizer();
    const lines = [
      '2024-01-01 12:00:00 [INFO] Request received',
      '2024-01-01 12:00:01 [INFO] Request received',
      '2024-01-01 12:00:02 [INFO] Request received',
      '2024-01-01 12:00:03 [WARN] High latency detected',
      '2024-01-01 12:00:04 [WARN] High latency detected',
      '2024-01-01 12:00:05 [ERROR] Service unavailable',
      '2024-01-01 12:00:06 [ERROR] Service unavailable',
      '2024-01-01 12:00:07 [ERROR] Service unavailable',
      '2024-01-01 12:00:08 [INFO] Health check passed',
      '2024-01-01 12:00:09 [DEBUG] Metrics exported',
    ];
    const content = lines.join('\n');
    const result = await summarizer.summarize(content, {});

    const summaryLines = result.summary.split('\n').filter(l => l.trim());

    // Should have 5 unique message types, not 10 original lines
    assert.equal(summaryLines.length, 5);

    // Check counts are annotated correctly
    const infoLine = summaryLines.find(l => l.includes('Request received'));
    const warnLine = summaryLines.find(l => l.includes('High latency'));
    const errorLine = summaryLines.find(l => l.includes('Service unavailable'));

    assert.ok(infoLine?.includes('×3'), `Expected ×3 for INFO: ${infoLine}`);
    assert.ok(warnLine?.includes('×2'), `Expected ×2 for WARN: ${warnLine}`);
    assert.ok(errorLine?.includes('×3'), `Expected ×3 for ERROR: ${errorLine}`);

    // Unique lines should have no count annotation
    const healthLine = summaryLines.find(l => l.includes('Health check'));
    const debugLine = summaryLines.find(l => l.includes('Metrics'));
    assert.ok(!healthLine?.startsWith('[×'), `Health check should not be annotated: ${healthLine}`);
    assert.ok(!debugLine?.startsWith('[×'), `Metrics line should not be annotated: ${debugLine}`);
  });

  it('returns as-is for content under threshold', async () => {
    summarizer = new LogSummarizer();
    const short = '2024-01-01 [INFO] Line 1\n2024-01-01 [ERROR] Line 2';
    const result = await summarizer.summarize(short, {});
    assert.equal(result.summary, short);
    assert.equal(result.savings_pct, 0);
  });
});
