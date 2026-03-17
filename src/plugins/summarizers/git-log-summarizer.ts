import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const FULL_COMMIT_REGEX = /^commit [a-f0-9]{40}/m;
const ONELINE_COMMIT_REGEX = /^[a-f0-9]{7,}\s/m;
const AUTHOR_REGEX = /^Author:\s*(.+)$/gm;
const DATE_REGEX = /^Date:\s*(.+)$/gm;
const CONVENTIONAL_REGEX = /\b(feat|fix|refactor|test|docs|chore|style|perf|ci|build|revert)[\s(:]/gi;

export class GitLogSummarizer implements SummarizerPlugin {
  name = 'git-log-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['git-log'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    return FULL_COMMIT_REGEX.test(content) || ONELINE_COMMIT_REGEX.test(content);
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    // Count commits
    const fullCommits = content.match(/^commit [a-f0-9]{40}/gm);
    const onelineCommits = content.match(/^[a-f0-9]{7,}\s/gm);
    const commitCount = fullCommits ? fullCommits.length : (onelineCommits ? onelineCommits.length : 0);

    // Unique authors
    const authors = new Set<string>();
    let authorMatch;
    const authorRegex = new RegExp(AUTHOR_REGEX.source, 'gm');
    while ((authorMatch = authorRegex.exec(content)) !== null) {
      authors.add(authorMatch[1].trim());
    }

    // Date range
    const dates: string[] = [];
    let dateMatch;
    const dateRegex = new RegExp(DATE_REGEX.source, 'gm');
    while ((dateMatch = dateRegex.exec(content)) !== null) {
      dates.push(dateMatch[1].trim());
    }

    // Commit type distribution
    const typeDistribution = new Map<string, number>();
    let typeMatch;
    const typeRegex = new RegExp(CONVENTIONAL_REGEX.source, 'gi');
    while ((typeMatch = typeRegex.exec(content)) !== null) {
      const type = typeMatch[1].toLowerCase();
      typeDistribution.set(type, (typeDistribution.get(type) || 0) + 1);
    }

    const sortedTypes = Array.from(typeDistribution.entries())
      .sort((a, b) => b[1] - a[1]);

    const summaryParts = [
      `# Git Log Summary`,
      '',
      `## Commits: ${commitCount}`,
      `## Authors: ${authors.size}`,
      ...Array.from(authors).map(a => `  - ${a}`),
      '',
      `## Date range`,
      dates.length > 0 ? `  From: ${dates[dates.length - 1]}` : '  (no dates found)',
      dates.length > 0 ? `  To: ${dates[0]}` : '',
      '',
      `## Commit types`,
      ...sortedTypes.map(([type, count]) => `  ${type}: ${count}`),
    ];

    const summary = summaryParts.join('\n');
    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'git-log',
    };
  }
}
