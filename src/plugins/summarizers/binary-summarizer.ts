import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';
import { createHash } from 'node:crypto';

const CHECK_BYTES = 512;
const NON_PRINTABLE_THRESHOLD = 0.1;

export class BinarySummarizer implements SummarizerPlugin {
  name = 'binary-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['binary'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const sample = content.slice(0, CHECK_BYTES);
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      // Non-printable: not tab (9), not newline (10), not carriage return (13), not in printable ASCII range (32-126)
      if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code > 126)) {
        nonPrintable++;
      }
    }
    return sample.length > 0 && (nonPrintable / sample.length) > NON_PRINTABLE_THRESHOLD;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    const hash = createHash('sha256').update(content).digest('hex');
    const byteCount = Buffer.byteLength(content, 'utf-8');

    const summary = `[binary content] sha256:${hash} size:${byteCount} bytes`;
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'binary',
    };
  }
}
