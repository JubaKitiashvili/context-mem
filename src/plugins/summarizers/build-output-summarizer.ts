import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const BUILD_KEYWORDS = /\b(Compiling|Bundling|Route|Bundle size|webpack|vite|esbuild|Building)\b/i;
const ROUTE_REGEX = /(?:Route|GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/gi;
const BUNDLE_SIZE_REGEX = /(\S+)\s*[\-:]\s*([\d.]+\s*(?:kB|KB|MB|B|bytes))/gi;
const WARNING_REGEX = /\bwarning\b/gi;
const BUILD_TIME_REGEX = /(?:built|compiled|bundled|done)\s+in\s+([\d.]+\s*(?:ms|s|m|min))/i;

export class BuildOutputSummarizer implements SummarizerPlugin {
  name = 'build-output-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['build-output'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    return BUILD_KEYWORDS.test(content);
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    // Extract routes
    const routes: string[] = [];
    let routeMatch;
    const routeRegex = new RegExp(ROUTE_REGEX.source, 'gi');
    while ((routeMatch = routeRegex.exec(content)) !== null) {
      const route = routeMatch[1];
      if (!routes.includes(route)) routes.push(route);
    }

    // Extract bundle sizes
    const bundleSizes: string[] = [];
    let sizeMatch;
    const sizeRegex = new RegExp(BUNDLE_SIZE_REGEX.source, 'gi');
    while ((sizeMatch = sizeRegex.exec(content)) !== null) {
      bundleSizes.push(`${sizeMatch[1]}: ${sizeMatch[2]}`);
    }

    // Count warnings
    const warningMatches = content.match(WARNING_REGEX);
    const warningCount = warningMatches ? warningMatches.length : 0;

    // Extract build time
    const buildTimeMatch = content.match(BUILD_TIME_REGEX);
    const buildTime = buildTimeMatch ? buildTimeMatch[1] : 'unknown';

    const summaryParts = [
      `# Build Output Summary`,
      '',
      `## Build time: ${buildTime}`,
      `## Warnings: ${warningCount}`,
      '',
      `## Routes found (${routes.length})`,
      ...routes.map(r => `  ${r}`),
      '',
      `## Bundle sizes (${bundleSizes.length})`,
      ...bundleSizes.map(b => `  ${b}`),
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'build-output',
    };
  }
}
