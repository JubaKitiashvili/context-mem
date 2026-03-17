import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const HTML_DETECT_PATTERN = /<html|<head|<body|<!DOCTYPE/i;
const HEADING_TAG_REGEX = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
const TITLE_REGEX = /<title[^>]*>(.*?)<\/title>/i;
const NAV_REGEX = /<nav[^>]*>([\s\S]*?)<\/nav>/gi;
const FORM_REGEX = /<form[\s>]/gi;

export class HtmlSummarizer implements SummarizerPlugin {
  name = 'html-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['html'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    return HTML_DETECT_PATTERN.test(content);
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    // Extract <title>
    const titleMatch = content.match(TITLE_REGEX);
    const title = titleMatch ? titleMatch[1].trim() : '(no title)';

    // Extract headings
    const headings: string[] = [];
    let headingMatch;
    const headingRegex = new RegExp(HEADING_TAG_REGEX.source, 'gi');
    while ((headingMatch = headingRegex.exec(content)) !== null) {
      const level = headingMatch[1];
      const text = headingMatch[2].replace(/<[^>]*>/g, '').trim();
      headings.push(`h${level}: ${text}`);
    }

    // Find <nav> sections
    const navSections: string[] = [];
    let navMatch;
    const navRegex = new RegExp(NAV_REGEX.source, 'gi');
    while ((navMatch = navRegex.exec(content)) !== null) {
      const navText = navMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      navSections.push(navText.slice(0, 200));
    }

    // Count <form> elements
    const formMatches = content.match(FORM_REGEX);
    const formCount = formMatches ? formMatches.length : 0;

    const summaryParts = [
      `# HTML Document: ${title}`,
      '',
      `## Headings (${headings.length})`,
      ...headings.map(h => `  - ${h}`),
      '',
      `## Navigation sections: ${navSections.length}`,
      ...navSections.map((n, i) => `  nav[${i}]: ${n}`),
      '',
      `## Forms: ${formCount}`,
      `## Size: ${content.length} chars`,
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'html',
    };
  }
}
