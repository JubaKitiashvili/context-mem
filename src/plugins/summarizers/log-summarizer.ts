import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const MIN_LINES_TO_SUMMARIZE = 10;

// Patterns that indicate log-like content
const TIMESTAMP_PATTERNS = [
  /\d{4}-\d{2}-\d{2}/,   // ISO date: 2024-01-01
  /\d{2}:\d{2}:\d{2}/,   // Time: 12:34:56
];

const LOG_LEVEL_PATTERNS = [
  /\[(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\]/,  // Bracketed: [INFO]
  /\b(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b/,  // Bare: INFO
];

// Strips timestamps from a line for deduplication comparison
function normalizeLogLine(line: string): string {
  return line
    // ISO datetime with optional milliseconds: 2024-01-01T12:34:56.789Z or 2024-01-01 12:34:56
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, '<TIMESTAMP>')
    // Date only: 2024-01-01
    .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>')
    // Time only: 12:34:56.789
    .replace(/\d{2}:\d{2}:\d{2}(?:\.\d+)?/g, '<TIME>')
    // Unix timestamps (10-13 digit numbers at word boundary)
    .replace(/\b\d{10,13}\b/g, '<TS>')
    .trim();
}

export class LogSummarizer implements SummarizerPlugin {
  name = 'log-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['log', 'syslog', 'application-log'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < MIN_LINES_TO_SUMMARIZE) return false;

    // Check if a meaningful portion of lines match log patterns
    let matchCount = 0;
    for (const line of lines) {
      const hasTimestamp = TIMESTAMP_PATTERNS.some(p => p.test(line));
      const hasLogLevel = LOG_LEVEL_PATTERNS.some(p => p.test(line));
      if (hasTimestamp || hasLogLevel) matchCount++;
    }

    // At least 30% of lines should look like log lines
    return matchCount / lines.length >= 0.3;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const lines = content.split('\n');
    const tokensOriginal = estimateTokens(content);

    if (lines.length < MIN_LINES_TO_SUMMARIZE) {
      return {
        summary: content,
        tokens_original: tokensOriginal,
        tokens_summarized: tokensOriginal,
        savings_pct: 0,
        content_type: 'log',
      };
    }

    // Track deduplicated lines: normalized key → { firstLine, count, lastLine }
    const seen = new Map<string, { firstLine: string; count: number; lastLine: string }>();
    // Preserve insertion order (first seen)
    const order: string[] = [];

    for (const line of lines) {
      const normalized = normalizeLogLine(line);
      if (seen.has(normalized)) {
        const entry = seen.get(normalized)!;
        entry.count++;
        entry.lastLine = line;
      } else {
        seen.set(normalized, { firstLine: line, count: 1, lastLine: line });
        order.push(normalized);
      }
    }

    const outputLines: string[] = [];
    for (const key of order) {
      const { firstLine, count } = seen.get(key)!;
      if (count > 1) {
        outputLines.push(`[×${count}] ${firstLine}`);
      } else {
        outputLines.push(firstLine);
      }
    }

    const summary = outputLines.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'log',
    };
  }
}
