import type { SearchPlugin, SearchResult, SearchOpts, SearchOrchestrator, SearchIntent, ObservationType } from '../../core/types.js';
import { IntentClassifier } from './intent.js';

const SEARCH_WINDOW_MS = 60_000;       // 60-second sliding window
const SEARCH_MAX_FULL = 3;             // calls 1-3: full results
const SEARCH_MAX_LIMITED = 8;          // calls 4-8: 1 result + warning
const SEARCH_BLOCK_AFTER = 8;          // call 9+: blocked

export class SearchFusion implements SearchOrchestrator {
  private plugins: SearchPlugin[] = [];
  private classifier: IntentClassifier;
  private searchCallCount = 0;
  private searchWindowStart = Date.now();

  constructor(plugins: SearchPlugin[]) {
    this.plugins = [...plugins].sort((a, b) => a.priority - b.priority);
    this.classifier = new IntentClassifier();
  }

  classify(query: string): SearchIntent {
    return this.classifier.classify(query);
  }

  resetThrottle(): void {
    this.searchCallCount = 0;
    this.searchWindowStart = Date.now();
  }

  async execute(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    const now = Date.now();
    if (now - this.searchWindowStart > SEARCH_WINDOW_MS) {
      this.searchCallCount = 0;
      this.searchWindowStart = now;
    }

    this.searchCallCount++;

    if (this.searchCallCount > SEARCH_BLOCK_AFTER) {
      return [{
        id: '__throttled__',
        title: 'Search throttled',
        snippet: 'Search rate limit exceeded. Please wait before searching again.',
        relevance_score: 0,
        type: 'context' as ObservationType,
        timestamp: now,
      }];
    }

    const intent = this.classify(query);
    const enrichedOpts: SearchOpts = {
      ...opts,
      type_boosts: { ...opts.type_boosts, ...intent.type_boosts },
    };

    let allResults: SearchResult[] = [];
    const seenIds = new Set<string>();

    for (const plugin of this.plugins) {
      try {
        const results = await plugin.search(query, enrichedOpts);
        for (const r of results) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            const boost = enrichedOpts.type_boosts?.[r.type] || 0;
            allResults.push({ ...r, relevance_score: r.relevance_score + boost });
          }
        }
        if (!plugin.shouldFallback(results)) break;
      } catch {
        continue;
      }
    }

    allResults.sort((a, b) => b.relevance_score - a.relevance_score);
    allResults = allResults.slice(0, opts.limit || 5);

    if (this.searchCallCount > SEARCH_MAX_FULL && allResults.length > 0) {
      const limited = allResults.slice(0, 1);
      limited.push({
        id: '__throttle_warning__',
        title: 'Search throttled',
        snippet: `Search frequency high (${this.searchCallCount}/${SEARCH_MAX_LIMITED} in window). Results limited to 1. Slow down to get full results.`,
        relevance_score: 0,
        type: 'context' as ObservationType,
        timestamp: now,
      });
      return limited;
    }

    return allResults;
  }
}
