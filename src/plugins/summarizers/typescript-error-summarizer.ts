import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const TS_ERROR_PATTERN = /error TS\d+:/;
const TS_ERROR_LINE_REGEX = /^(.+?)\(\d+,\d+\):\s*error (TS\d+):\s*(.+)$/;

export class TypescriptErrorSummarizer implements SummarizerPlugin {
  name = 'typescript-error-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['typescript-error'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    return TS_ERROR_PATTERN.test(content);
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const lines = content.split('\n');
    const tokensOriginal = estimateTokens(content);

    const errorsPerFile = new Map<string, number>();
    const errorCodes = new Map<string, number>();
    const errorMessages: string[] = [];

    for (const line of lines) {
      const match = line.match(TS_ERROR_LINE_REGEX);
      if (match) {
        const [, file, code, message] = match;
        errorsPerFile.set(file, (errorsPerFile.get(file) || 0) + 1);
        errorCodes.set(code, (errorCodes.get(code) || 0) + 1);
        if (errorMessages.length < 3) {
          errorMessages.push(`${code}: ${message}`);
        }
      }
    }

    const totalErrors = Array.from(errorsPerFile.values()).reduce((a, b) => a + b, 0);

    // Sort error codes by count descending
    const sortedCodes = Array.from(errorCodes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Sort files by error count descending
    const sortedFiles = Array.from(errorsPerFile.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const summaryParts = [
      `# TypeScript Errors: ${totalErrors} total`,
      '',
      `## Errors per file (top ${sortedFiles.length})`,
      ...sortedFiles.map(([file, count]) => `  ${file}: ${count}`),
      '',
      `## Error codes (top ${sortedCodes.length})`,
      ...sortedCodes.map(([code, count]) => `  ${code}: ${count} occurrences`),
      '',
      `## First errors`,
      ...errorMessages.map(m => `  - ${m}`),
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'typescript-error',
    };
  }
}
