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
    // Evict expired entries
    for (const [key, entry] of this.searchCache) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.searchCache.delete(key);
      }
    }
    // If still over cap, trim oldest entries
    if (this.searchCache.size > this.CACHE_MAX_ENTRIES) {
      const sorted = [...this.searchCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (const [k] of sorted.slice(0, this.searchCache.size - this.CACHE_MAX_ENTRIES)) {
        this.searchCache.delete(k);
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

    // Intent-adaptive weights: shift emphasis based on query type
    const dynamicWeights = { ...this.weights };
    if (intent.intent_type === 'lookup') {
      dynamicWeights.bm25 = (dynamicWeights.bm25 ?? 0.45) * 1.4;
      dynamicWeights.vector = (dynamicWeights.vector ?? 0.35) * 0.5;
    } else if (intent.intent_type === 'causal' || intent.intent_type === 'temporal') {
      dynamicWeights.vector = (dynamicWeights.vector ?? 0.35) * 1.5;
      dynamicWeights.bm25 = (dynamicWeights.bm25 ?? 0.45) * 0.7;
    }

    // Parallel merge: run ALL plugins, merge weighted results
    const pluginResults = await Promise.all(
      this.plugins.map(async (plugin) => {
        try {
          return { strategy: plugin.strategy, results: await plugin.search(query, enrichedOpts) };
        } catch {
          return { strategy: plugin.strategy, results: [] as SearchResult[] };
        }
      })
    );

    const allResults: SearchResult[] = [];
    const seenIds = new Map<string, number>(); // id → index in allResults
    const strategyHits = new Map<string, number>(); // id → number of strategies that found it

    for (const { strategy, results } of pluginResults) {
      const weight = dynamicWeights[strategy as keyof SearchWeights] ?? 0.1;
      for (const r of results) {
        const boost = enrichedOpts.type_boosts?.[r.type] || 0;
        const weightedScore = (r.relevance_score + boost) * weight;

        if (seenIds.has(r.id)) {
          // Boost existing entry: found by multiple strategies
          const idx = seenIds.get(r.id)!;
          allResults[idx].relevance_score += weightedScore;
          strategyHits.set(r.id, (strategyHits.get(r.id) || 1) + 1);
        } else {
          seenIds.set(r.id, allResults.length);
          strategyHits.set(r.id, 1);
          allResults.push({ ...r, relevance_score: weightedScore });
        }
      }
    }

    // Multi-match confidence boost: results found by 2+ strategies get a bonus
    for (const r of allResults) {
      const count = strategyHits.get(r.id) || 1;
      if (count >= 2) r.relevance_score *= (1 + 0.15 * (count - 1));
    }

    const reranked = rerank(allResults, intent.intent_type, query);
    const finalResults = reranked.slice(0, opts.limit || 5);

    if (this.searchCallCount > SEARCH_MAX_FULL && finalResults.length > 0) {
      const limited = finalResults.slice(0, 1);
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
    this.searchCache.set(canonicalKey, { results: finalResults, timestamp: now });

    return finalResults;
  }
}

const INTENT_WEIGHTS: Record<string, { relevance: number; recency: number; access: number }> = {
  causal:         { relevance: 0.20, recency: 0.70, access: 0.10 },
  temporal:       { relevance: 0.10, recency: 0.75, access: 0.15 },
  lookup:         { relevance: 0.80, recency: 0.10, access: 0.10 },
  recommendation: { relevance: 0.35, recency: 0.35, access: 0.30 },
  general:        { relevance: 0.55, recency: 0.30, access: 0.15 },
};

/**
 * Rerank search results by combining original relevance with recency and access frequency.
 * Weights are intent-specific: causal favors recency, lookup favors relevance,
 * temporal heavily favors recency, general uses balanced weights.
 *
 * For general intent, weights are adjusted dynamically based on result characteristics
 * (AttnRes mechanism: fixed query × content-dependent keys → adaptive weights).
 */
export function rerank(results: SearchResult[], intentType: SearchIntent['intent_type'] = 'general', query?: string): SearchResult[] {
  const now = Date.now();
  let weights = { ...(INTENT_WEIGHTS[intentType] || INTENT_WEIGHTS.general) };

  // Result-aware adjustment for general intent (AttnRes: fixed query × content-dependent keys)
  if (intentType === 'general' && results.length >= 2) {
    const scores = results.map(r => r.relevance_score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;

    const timestamps = results.map(r => r.timestamp || now);
    const timeSpread = (Math.max(...timestamps) - Math.min(...timestamps)) / HALF_LIFE_MS; // relative to 7 days

    if (variance < 0.01) {
      // Scores too close — recency becomes the differentiator
      weights = { ...weights, recency: weights.recency + 0.15, relevance: weights.relevance - 0.15 };
    }

    if (timeSpread < 0.1) {
      // All results are recent — relevance becomes the differentiator
      weights = { ...weights, relevance: weights.relevance + 0.15, recency: weights.recency - 0.15 };
    }
  }

  // Keyword density boost from query terms matching snippet content
  const queryTerms = query
    ? query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
    : [];
  // Build bigrams for phrase matching
  const queryBigrams: string[] = [];
  for (let i = 0; i < queryTerms.length - 1; i++) {
    queryBigrams.push(queryTerms[i] + ' ' + queryTerms[i + 1]);
  }

  return results.map(r => {
    const age = now - (r.timestamp || now);
    const recencyBoost = Math.pow(0.5, age / HALF_LIFE_MS);
    const accessBoost = Math.log2((r.access_count || 0) + 2) / 10;

    // Content-based relevance boost
    let contentBoost = 0;
    if (queryTerms.length > 0 && r.snippet) {
      const snippetLower = r.snippet.toLowerCase();
      const keywordHits = queryTerms.filter(w => snippetLower.includes(w)).length;
      const density = keywordHits / queryTerms.length;
      const bigramHits = queryBigrams.filter(bg => snippetLower.includes(bg)).length;
      const bigramScore = queryBigrams.length > 0 ? bigramHits / queryBigrams.length : 0;
      contentBoost = density * 0.3 + bigramScore * 0.2;
    }

    return {
      ...r,
      relevance_score: r.relevance_score * (weights.relevance + weights.recency * recencyBoost + weights.access * accessBoost + contentBoost),
    };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
}

