import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const KEEP_LINES = 10;
const MIN_LINES_TO_SUMMARIZE = 20;

export class ShellSummarizer implements SummarizerPlugin {
  name = 'shell-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['shell', 'command-output'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const lineCount = content.split('\n').length;
    return lineCount >= MIN_LINES_TO_SUMMARIZE;
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
        content_type: 'shell',
      };
    }

    const head = lines.slice(0, KEEP_LINES);
    const tail = lines.slice(-KEEP_LINES);
    const omitted = lines.length - KEEP_LINES * 2;

    const summary = [
      `[${lines.length} lines total]`,
      ...head,
      `... (${omitted} lines omitted) ...`,
      ...tail,
    ].join('\n');

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: Math.round((1 - tokensSummarized / tokensOriginal) * 100),
      content_type: 'shell',
    };
  }
}
