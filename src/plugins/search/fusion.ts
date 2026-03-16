import type { SearchPlugin, SearchResult, SearchOpts, SearchOrchestrator, SearchIntent } from '../../core/types.js';
import { IntentClassifier } from './intent.js';

export class SearchFusion implements SearchOrchestrator {
  private plugins: SearchPlugin[] = [];
  private classifier: IntentClassifier;

  constructor(plugins: SearchPlugin[]) {
    this.plugins = [...plugins].sort((a, b) => a.priority - b.priority);
    this.classifier = new IntentClassifier();
  }

  classify(query: string): SearchIntent {
    return this.classifier.classify(query);
  }

  async execute(query: string, opts: SearchOpts): Promise<SearchResult[]> {
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
    return allResults.slice(0, opts.limit || 5);
  }
}
