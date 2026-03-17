import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const HEADING_REGEX = /^#{1,6}\s/;

export class MarkdownSummarizer implements SummarizerPlugin {
  name = 'markdown-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['markdown'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const lines = content.split('\n');
    let headingCount = 0;
    for (const line of lines) {
      if (HEADING_REGEX.test(line)) headingCount++;
      if (headingCount >= 2) return true;
    }
    return false;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const lines = content.split('\n');
    const tokensOriginal = estimateTokens(content);

    // Extract title (first heading)
    let title = '';
    for (const line of lines) {
      if (HEADING_REGEX.test(line)) {
        title = line.replace(/^#+\s/, '').trim();
        break;
      }
    }

    // Build heading tree
    const headings: string[] = [];
    for (const line of lines) {
      if (HEADING_REGEX.test(line)) {
        headings.push(line.trim());
      }
    }

    // Count code blocks
    let codeBlockCount = 0;
    for (const line of lines) {
      if (line.trim().startsWith('```')) codeBlockCount++;
    }
    codeBlockCount = Math.floor(codeBlockCount / 2);

    // Count links
    const linkMatches = content.match(/\[([^\]]*)\]\([^)]*\)/g);
    const linkCount = linkMatches ? linkMatches.length : 0;

    const summaryParts = [
      `# Document: ${title || '(untitled)'}`,
      '',
      `## Structure (${headings.length} headings)`,
      ...headings.map(h => `  ${h}`),
      '',
      `## Stats`,
      `- Lines: ${lines.length}`,
      `- Code blocks: ${codeBlockCount}`,
      `- Links: ${linkCount}`,
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'markdown',
    };
  }
}
