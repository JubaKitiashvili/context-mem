import type { SearchPlugin, SearchResult, SearchOpts, SearchOrchestrator, SearchIntent, SearchWeights, ObservationType } from '../../core/types.js';
import { DEFAULT_SEARCH_WEIGHTS } from '../../core/types.js';
import { IntentClassifier } from './intent.js';
import { softmax, normalizeBlock, selectBlocks } from './block-selector.js';

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

    allResults = rerank(allResults, intent.intent_type);
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

const INTENT_WEIGHTS: Record<string, { relevance: number; recency: number; access: number }> = {
  causal:   { relevance: 0.20, recency: 0.70, access: 0.10 },
  temporal: { relevance: 0.10, recency: 0.75, access: 0.15 },
  lookup:   { relevance: 0.80, recency: 0.10, access: 0.10 },
  general:  { relevance: 0.55, recency: 0.30, access: 0.15 },
};

/**
 * Rerank search results by combining original relevance with recency and access frequency.
 * Weights are intent-specific: causal favors recency, lookup favors relevance,
 * temporal heavily favors recency, general uses balanced weights.
 *
 * For general intent, weights are adjusted dynamically based on result characteristics
 * (AttnRes mechanism: fixed query × content-dependent keys → adaptive weights).
 */
export function rerank(results: SearchResult[], intentType: SearchIntent['intent_type'] = 'general'): SearchResult[] {
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

  return results.map(r => {
    const age = now - (r.timestamp || now);
    const recencyBoost = Math.pow(0.5, age / HALF_LIFE_MS);
    const accessBoost = Math.log2((r.access_count || 0) + 2) / 10;

    return {
      ...r,
      relevance_score: r.relevance_score * (weights.relevance + weights.recency * recencyBoost + weights.access * accessBoost),
    };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
}

interface BlockPlugins {
  session: SearchPlugin[];
  project: SearchPlugin[];
  global: SearchPlugin[];
  archive: SearchPlugin[];
}

export class BlockSearchOrchestrator {
  private blocks: BlockPlugins;
  private blockNames: Array<keyof BlockPlugins> = ['session', 'project', 'global', 'archive'];

  constructor(blocks: BlockPlugins) {
    this.blocks = blocks;
  }

  async execute(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    // Phase 1: Lightweight probe — get top-3 raw scores from each block's first plugin
    const blockScores: number[] = [];

    for (const blockName of this.blockNames) {
      const plugins = this.blocks[blockName];
      if (plugins.length === 0) {
        blockScores.push(0);
        continue;
      }

      try {
        const probeResults = await plugins[0].search(query, { ...opts, limit: 3 });
        blockScores.push(probeResults.length > 0 ? Math.max(...probeResults.map(r => r.relevance_score)) : 0);
      } catch {
        blockScores.push(0);
      }
    }

    // Normalize block probe scores before attention computation so blocks with
    // any results are fairly compared regardless of absolute score magnitude.
    // This prevents a high-scoring block from starving out a weaker but relevant block.
    const maxBlockScore = Math.max(...blockScores);
    const normalizedBlockScores = maxBlockScore > 0
      ? blockScores.map(s => s / maxBlockScore)
      : blockScores.map(() => 1);

    // Block attention via softmax
    const selectedIndices = selectBlocks(normalizedBlockScores, 0.05);

    if (selectedIndices.length === 0) return [];

    const attention = softmax(normalizedBlockScores);

    // Phase 2: Deep search on selected blocks + normalization
    let allResults: SearchResult[] = [];

    for (const idx of selectedIndices) {
      const blockName = this.blockNames[idx];
      const plugins = this.blocks[blockName];
      if (plugins.length === 0) continue;

      const fusion = new SearchFusion(plugins);
      const results = await fusion.execute(query, opts);

      // Per-block normalization (RMSNorm analogue)
      const normalized = normalizeBlock(results);

      // Weight by block attention
      for (const r of normalized) {
        allResults.push({
          ...r,
          relevance_score: r.relevance_score * attention[idx],
        });
      }
    }

    // Deduplicate by id (same entry might appear in multiple blocks)
    const seen = new Set<string>();
    allResults = allResults.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // Apply adaptive reranking
    const classifier = new IntentClassifier();
    const intent = classifier.classify(query);
    allResults = rerank(allResults, intent.intent_type);

    return allResults.slice(0, opts.limit || 5);
  }
}
