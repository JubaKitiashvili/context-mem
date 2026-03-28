import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const MIN_CONSISTENT_LINES = 5;

export class CsvSummarizer implements SummarizerPlugin {
  name = 'csv-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['csv'];

  /** Cached non-empty lines from detect() to avoid re-splitting in summarize() */
  private _lastLines: string[] | null = null;
  private _lastContent: string | null = null;

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < MIN_CONSISTENT_LINES) {
      this._lastLines = null;
      this._lastContent = null;
      return false;
    }

    // Check first 10 lines for consistent comma count
    const checkLines = lines.slice(0, 10);
    const commaCounts = checkLines.map(l => (l.match(/,/g) || []).length);

    // All lines must have at least 1 comma
    if (commaCounts[0] === 0) {
      this._lastLines = null;
      this._lastContent = null;
      return false;
    }

    // Check consistency: all lines should have the same comma count
    const firstCount = commaCounts[0];
    const consistentLines = commaCounts.filter(c => c === firstCount).length;
    const matched = consistentLines >= MIN_CONSISTENT_LINES;
    this._lastLines = matched ? lines : null;
    this._lastContent = matched ? content : null;
    return matched;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const lines = (this._lastLines && this._lastContent === content)
      ? this._lastLines
      : content.split('\n').filter(l => l.trim().length > 0);
    this._lastLines = null;
    this._lastContent = null;
    const tokensOriginal = estimateTokens(content);

    const rowCount = lines.length;
    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim());
    const columnCount = headers.length;

    // Sample first 3 data rows
    const sampleRows = lines.slice(1, 4);

    const summaryParts = [
      `# CSV Summary`,
      '',
      `## Dimensions: ${rowCount} rows x ${columnCount} columns`,
      '',
      `## Headers`,
      `  ${headers.join(' | ')}`,
      '',
      `## Sample rows (first 3)`,
      ...sampleRows.map((r, i) => `  [${i + 1}] ${r}`),
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'csv',
    };
  }
}
