import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const JS_FRAME_RE = /^\s+at\s+.+\(.+:\d+:\d+\)/m;
const PYTHON_FRAME_RE = /File ".+", line \d+/m;
const ERROR_HEADER_RE = /^(\w*Error|Traceback|FATAL|PANIC|Exception)/m;

export class ErrorSummarizer implements SummarizerPlugin {
  name = 'error-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['error', 'stacktrace', 'traceback'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    return (
      ERROR_HEADER_RE.test(content) ||
      JS_FRAME_RE.test(content) ||
      PYTHON_FRAME_RE.test(content)
    );
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);
    const lines = content.split('\n');

    // Detect Python traceback
    if (/Traceback \(most recent call last\):/m.test(content)) {
      return this._summarizePython(content, lines, tokensOriginal);
    }

    // Detect JS/Node.js stack trace
    if (/^\s+at\s+/m.test(content)) {
      return this._summarizeJS(content, lines, tokensOriginal);
    }

    // Generic error without stack
    return this._summarizeGeneric(content, tokensOriginal);
  }

  private _summarizeJS(
    _content: string,
    lines: string[],
    tokensOriginal: number,
  ): SummaryResult {
    // Find the error header line (e.g. "TypeError: Cannot read property...")
    const headerIndex = lines.findIndex((l) => /^\w*Error[:\s]/.test(l.trim()));
    const errorLine = headerIndex >= 0 ? lines[headerIndex].trim() : lines[0].trim();

    // Extract type and message
    const match = errorLine.match(/^(\w*Error):\s*(.*)/);
    const errorType = match ? match[1] : 'Error';
    const message = match ? match[2] : errorLine;

    // Collect top 3 "at" frames
    const frames: string[] = [];
    for (const line of lines) {
      if (frames.length >= 3) break;
      const trimmed = line.trim();
      if (/^at\s+/.test(trimmed)) {
        frames.push(trimmed);
      }
    }

    const frameLines = frames.map((f) => `  ${f}`).join('\n');
    const summary = frames.length > 0
      ? `[${errorType}]: ${message}\n${frameLines}`
      : `[${errorType}]: ${message}`;

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'stacktrace',
    };
  }

  private _summarizePython(
    _content: string,
    lines: string[],
    tokensOriginal: number,
  ): SummaryResult {
    // Last non-empty line is usually the error type+message
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const lastLine = nonEmpty[nonEmpty.length - 1]?.trim() ?? '';

    const match = lastLine.match(/^(\w+(?:Error|Exception|Warning|Interrupt|Exit)):\s*(.*)/);
    const errorType = match ? match[1] : 'Exception';
    const message = match ? match[2] : lastLine;

    // Collect top 3 "File" frames
    const frames: string[] = [];
    for (const line of lines) {
      if (frames.length >= 3) break;
      const trimmed = line.trim();
      if (/^File ".+", line \d+/.test(trimmed)) {
        frames.push(trimmed);
      }
    }

    const frameLines = frames.map((f) => `  ${f}`).join('\n');
    const summary = frames.length > 0
      ? `[${errorType}]: ${message}\n${frameLines}`
      : `[${errorType}]: ${message}`;

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'traceback',
    };
  }

  private _summarizeGeneric(content: string, tokensOriginal: number): SummaryResult {
    // Return the first meaningful line containing the error
    const lines = content.split('\n');
    const errorLine = lines.find((l) => /error|exception|fatal|panic/i.test(l)) ?? lines[0];
    const summary = errorLine.trim();

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'error',
    };
  }
}
