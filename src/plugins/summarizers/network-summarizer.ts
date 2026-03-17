import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const HTTP_METHOD_REGEX = /\b(GET|POST|PUT|DELETE|PATCH)\b/g;
const STATUS_CODE_REGEX = /\b([2-5]\d{2})\b/g;
const ENDPOINT_REGEX = /(?:GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/g;

export class NetworkSummarizer implements SummarizerPlugin {
  name = 'network-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['network'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    // Skip small content — not worth summarizing
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 10) return false;

    const hasMethod = /\b(GET|POST|PUT|DELETE|PATCH)\b/.test(content);
    const hasStatus = /\b[2-5]\d{2}\b/.test(content);
    return hasMethod && hasStatus;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    // Method distribution
    const methodDist = new Map<string, number>();
    let methodMatch;
    const methodRegex = new RegExp(HTTP_METHOD_REGEX.source, 'g');
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      const method = methodMatch[1];
      methodDist.set(method, (methodDist.get(method) || 0) + 1);
    }

    // Status code distribution
    const statusDist = new Map<string, number>();
    let statusMatch;
    const statusRegex = new RegExp(STATUS_CODE_REGEX.source, 'g');
    while ((statusMatch = statusRegex.exec(content)) !== null) {
      const code = statusMatch[1];
      const category = `${code[0]}xx`;
      statusDist.set(category, (statusDist.get(category) || 0) + 1);
    }

    // Unique endpoints
    const endpoints = new Set<string>();
    let endpointMatch;
    const endpointRegex = new RegExp(ENDPOINT_REGEX.source, 'g');
    while ((endpointMatch = endpointRegex.exec(content)) !== null) {
      endpoints.add(endpointMatch[1]);
    }

    const summaryParts = [
      `# Network Summary`,
      '',
      `## Methods`,
      ...Array.from(methodDist.entries()).map(([m, c]) => `  ${m}: ${c}`),
      '',
      `## Status codes`,
      ...Array.from(statusDist.entries()).sort().map(([s, c]) => `  ${s}: ${c}`),
      '',
      `## Unique endpoints: ${endpoints.size}`,
      ...Array.from(endpoints).slice(0, 20).map(e => `  ${e}`),
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'network',
    };
  }
}
