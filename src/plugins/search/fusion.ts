import type { SearchPlugin, SearchResult, SearchOpts, SearchOrchestrator, SearchIntent, SearchWeights, ObservationType } from '../../core/types.js';
import { DEFAULT_SEARCH_WEIGHTS } from '../../core/types.js';
import { IntentClassifier } from './intent.js';

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SEARCH_WINDOW_MS = 60_000;       // 60-second sliding window
const SEARCH_MAX_FULL = 3;             // calls 1-3: full results
const SEARCH_MAX_LIMITED = 8;          // calls 4-8: 1 result + warning
const SEARCH_BLOCK_AFTER = 8;          // call 9+: blocked

export class SearchFusion implements SearchOrchestrator {
  private plugins: SearchPlugin[] = [];
  private classifier: IntentClassifier;
  private searchCallCount = 0;
  private searchWindowStart = Date.now();
  private weights: Required<SearchWeights>;

  private searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds
  private readonly CACHE_MAX_ENTRIES = 100;

  /**
   * Canonicalize a query string so that similar queries map to the same key.
   * Strips punctuation, drops short words, and sorts tokens alphabetically.
   */
  canonicalize(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')     // strip punctuation
      .split(/\s+/)                  // tokenize
      .filter(w => w.length > 2)     // drop short words
      .sort()                        // alphabetical (order-independent)
      .join(' ');
  }

  /**
   * Clear all cached search results. Useful for testing.
   */
  clearCache(): void {
    this.searchCache.clear();
  }

  /**
   * Evict expired entries from the cache.
   */
  private evictExpired(now: number): void {
    if (this.searchCache.size <= this.CACHE_MAX_ENTRIES) {
      // Only do a full scan if cache is large or we want to be thorough
      for (const [key, entry] of this.searchCache) {
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          this.searchCache.delete(key);
        }
      }
    } else {
      // Cache too large — evict all expired, then oldest if still over limit
      for (const [key, entry] of this.searchCache) {
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          this.searchCache.delete(key);
        }
      }
    }
  }

  constructor(plugins: SearchPlugin[], weights?: SearchWeights) {
    this.plugins = [...plugins].sort((a, b) => a.priority - b.priority);
    this.classifier = new IntentClassifier();
    this.weights = { ...DEFAULT_SEARCH_WEIGHTS, ...weights };
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

    // --- Cache lookup (before throttle counting) ---
    this.evictExpired(now);
    const canonicalKey = this.canonicalize(query);
    const cached = this.searchCache.get(canonicalKey);
    if (cached && now - cached.timestamp <= this.CACHE_TTL_MS) {
      return cached.results;
    }

    // --- Throttle logic ---
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
        const strategyWeight = this.weights[plugin.strategy] ?? 1;
        const results = await plugin.search(query, enrichedOpts);
        for (const r of results) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            const boost = enrichedOpts.type_boosts?.[r.type] || 0;
            allResults.push({ ...r, relevance_score: (r.relevance_score + boost) * strategyWeight });
          }
        }
        if (!plugin.shouldFallback(results)) break;
      } catch {
        continue;
      }
    }

    allResults = rerank(allResults);
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
      // Cache even throttled results
      this.searchCache.set(canonicalKey, { results: limited, timestamp: now });
      return limited;
    }

    // --- Store in cache ---
    this.searchCache.set(canonicalKey, { results: allResults, timestamp: now });

    return allResults;
  }
}

/**
 * Rerank search results by combining original relevance with recency and access frequency.
 * Weights: 70% original relevance, 20% recency (exponential decay, 7-day half-life),
 * 10% access frequency (logarithmic).
 */
export function rerank(results: SearchResult[]): SearchResult[] {
  const now = Date.now();

  return results.map(r => {
    const age = now - (r.timestamp || now);
    const recencyBoost = Math.pow(0.5, age / HALF_LIFE_MS); // 1.0 for new, 0.5 after 7 days
    const accessBoost = Math.log2((r.access_count || 0) + 2) / 10; // small boost for frequently accessed

    return {
      ...r,
      relevance_score: r.relevance_score * (0.7 + 0.2 * recencyBoost + 0.1 * accessBoost),
    };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
}
