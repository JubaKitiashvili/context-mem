/**
 * LLM-based reranker ("judge").
 *
 * Takes a small pool of search candidates and asks an LLM to score each
 * for semantic relevance to the query. Blends the LLM score with the
 * underlying retrieval score so a poorly-calibrated LLM call can't
 * catastrophically drop a high-confidence retrieval result.
 *
 * Optional — only used when `ai_curation.enabled` is true.
 */

import type { LLMProvider } from '../../core/llm-provider.js';
import type { SearchResult } from '../../core/types.js';

export interface LLMJudgeCandidate {
  id: string;
  content: string;
  retrievalScore: number;
}

type ScorableResult = SearchResult & { score?: number };

export interface LLMJudgeOptions {
  /** Maximum characters of content passed per candidate to the LLM. */
  contentSnippetChars?: number;
  /** Maximum candidates sent to the LLM in one call. */
  maxCandidates?: number;
  /** Weight blend: retrieval_weight + llm_weight must equal 1. */
  retrievalWeight?: number;
  llmWeight?: number;
  /** Minimum milliseconds between LLM calls (simple rate limiting). */
  minRequestIntervalMs?: number;
}

const DEFAULTS: Required<LLMJudgeOptions> = {
  contentSnippetChars: 1500,
  maxCandidates: 30,
  retrievalWeight: 0.5,
  llmWeight: 0.5,
  minRequestIntervalMs: 2200,
};

/**
 * LLMJudge — minimalist reranker that asks an LLM to score candidates 0..10.
 * Blends the normalized LLM score with the retrieval score.
 */
export class LLMJudge {
  private provider: LLMProvider;
  private opts: Required<LLMJudgeOptions>;
  private lastRequestAt = 0;

  constructor(provider: LLMProvider, opts: LLMJudgeOptions = {}) {
    this.provider = provider;
    this.opts = { ...DEFAULTS, ...opts };
  }

  private async rateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = this.opts.minRequestIntervalMs - elapsed;
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }
    this.lastRequestAt = Date.now();
  }

  /**
   * Score each candidate from 0..10 for relevance to the query.
   * Returns a score array aligned to the input candidates.
   * Returns null on failure (caller should fall back to retrieval scores).
   */
  private async scoreCandidates(query: string, candidates: LLMJudgeCandidate[]): Promise<number[] | null> {
    if (candidates.length === 0) return [];

    const maxLen = this.opts.contentSnippetChars;
    const numbered = candidates
      .map((c, i) => `[${i}] ${c.content.slice(0, maxLen)}`)
      .join('\n\n');

    const prompt =
      `Rate each session's usefulness for answering this question. Prioritize sessions that contain the ` +
      `direct answer, then sessions with indirect clues (preferences, past activities, related entities).\n\n` +
      `Score 0-10:\n` +
      `- 10 = directly contains the answer (mentions the fact, entity, or event asked about)\n` +
      `- 7-9 = strongly relevant (same topic, closely related entities, specific details)\n` +
      `- 4-6 = indirect clues (user preferences or background info that helps infer the answer)\n` +
      `- 0-3 = unrelated or only tangentially connected\n\n` +
      `Consider synonyms and related concepts: "sibling" = brother/sister, "cooking" includes baking/recipes, ` +
      `"movie/show" includes stand-up specials and streaming content the user mentioned.\n\n` +
      `Question: "${query}"\n\n` +
      `Sessions:\n${numbered}\n\n` +
      `Return ONLY a JSON object mapping ALL ${candidates.length} indices to scores, like {"0": 8, "1": 3, ...}.`;

    await this.rateLimit();

    try {
      const result = await this.provider.complete(prompt, {});
      if (!result) return null;

      // The provider returns parsed JSON; try to coerce into a score map
      let scoresObj: Record<string, unknown> | null = null;
      if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
        scoresObj = result as Record<string, unknown>;
      } else if (typeof result === 'string') {
        const match = result.match(/\{[^{}]*\}/);
        if (match) {
          try { scoresObj = JSON.parse(match[0]) as Record<string, unknown>; } catch {}
        }
      }
      if (!scoresObj) return null;

      const scores = new Array(candidates.length).fill(0);
      for (const [k, v] of Object.entries(scoresObj)) {
        const idx = parseInt(k, 10);
        if (!isNaN(idx) && idx >= 0 && idx < candidates.length && typeof v === 'number') {
          scores[idx] = Math.max(0, Math.min(10, v));
        }
      }
      return scores;
    } catch {
      return null;
    }
  }

  /**
   * Rerank search results using the LLM as a semantic judge.
   * Blends LLM scores with retrieval scores so a bad LLM call can't drop correct docs.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    contentLookup: (id: string) => string | undefined,
    limit: number,
  ): Promise<SearchResult[]> {
    if (results.length === 0) return results;

    const pool = results.slice(0, Math.max(limit, this.opts.maxCandidates));
    const candidates: LLMJudgeCandidate[] = pool.map(r => ({
      id: r.id,
      content: contentLookup(r.id) || '',
      retrievalScore: r.relevance_score || 0,
    }));

    const llmScores = await this.scoreCandidates(query, candidates);
    if (!llmScores) return results.slice(0, limit);

    // Normalize retrieval scores to 0..1
    const retrievalMax = Math.max(...pool.map(r => r.relevance_score || 0)) || 1;
    const wRet = this.opts.retrievalWeight;
    const wLlm = this.opts.llmWeight;

    const blended: ScorableResult[] = pool.map((r, i) => {
      const retrievalNorm = (r.relevance_score || 0) / retrievalMax;
      const llmNorm = (llmScores[i] || 0) / 10;
      const fusedScore = retrievalNorm * wRet + llmNorm * wLlm;
      return { ...r, relevance_score: fusedScore, score: fusedScore };
    });

    blended.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

    // Append any remaining results that weren't in the LLM-judged pool
    const seen = new Set(blended.map(r => r.id));
    const tail = results.filter(r => !seen.has(r.id));

    return [...blended, ...tail].slice(0, limit);
  }
}
