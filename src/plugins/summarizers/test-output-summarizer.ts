import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const TEST_DETECT_PATTERN = /Tests:.*total|PASS\s|FAIL\s|test suites/i;
const TESTS_LINE_REGEX = /^Tests:\s*(.+)$/m;
const PASS_COUNT_REGEX = /(\d+)\s+passed/i;
const FAIL_COUNT_REGEX = /(\d+)\s+failed/i;
const SKIP_COUNT_REGEX = /(\d+)\s+(?:skipped|pending|todo)/i;
const TOTAL_COUNT_REGEX = /(\d+)\s+total/i;
const SUITE_COUNT_REGEX = /Test Suites:\s*.*?(\d+)\s+total/i;
const DURATION_REGEX = /Time:\s*([\d.]+\s*(?:ms|s|m))/i;
const FAILED_TEST_REGEX = /(?:FAIL|✕|✗|×)\s+(.+)/g;

export class TestOutputSummarizer implements SummarizerPlugin {
  name = 'test-output-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['test-output'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    return TEST_DETECT_PATTERN.test(content);
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    // Extract the "Tests:" line specifically to avoid matching "Test Suites:" counts
    const testsLineMatch = content.match(TESTS_LINE_REGEX);
    const testsLine = testsLineMatch ? testsLineMatch[1] : content;
    const passMatch = testsLine.match(PASS_COUNT_REGEX);
    const failMatch = testsLine.match(FAIL_COUNT_REGEX);
    const skipMatch = testsLine.match(SKIP_COUNT_REGEX);
    const totalMatch = testsLine.match(TOTAL_COUNT_REGEX);
    const suiteMatch = content.match(SUITE_COUNT_REGEX);
    const durationMatch = content.match(DURATION_REGEX);

    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    const total = totalMatch ? parseInt(totalMatch[1], 10) : passed + failed + skipped;
    const suites = suiteMatch ? parseInt(suiteMatch[1], 10) : 0;
    const duration = durationMatch ? durationMatch[1] : 'unknown';

    // Extract failed test names (up to 10)
    const failedTests: string[] = [];
    let failedMatch;
    const failedRegex = new RegExp(FAILED_TEST_REGEX.source, 'g');
    while ((failedMatch = failedRegex.exec(content)) !== null && failedTests.length < 10) {
      failedTests.push(failedMatch[1].trim());
    }

    const summaryParts = [
      `# Test Results`,
      '',
      `## Counts`,
      `  Passed: ${passed}`,
      `  Failed: ${failed}`,
      `  Skipped: ${skipped}`,
      `  Total: ${total}`,
      `  Suites: ${suites}`,
      `  Duration: ${duration}`,
    ];

    if (failedTests.length > 0) {
      summaryParts.push('', `## Failed tests (${failedTests.length})`);
      for (const t of failedTests) {
        summaryParts.push(`  - ${t}`);
      }
    }

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'test-output',
    };
  }
}
