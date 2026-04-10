# Search Architecture Refactor Plan

**Date:** 2026-04-10
**Status:** PLANNED
**Goal:** Fix architectural issues found in search audit; make benchmarks reflect real product performance

## Current State (pre-refactor scores)

| Benchmark | BM25-only | +Vector rerank |
|---|---|---|
| LME R@5 | 97.2% | 97.4% |
| LME R@10 | 98.4% | 98.6% |
| LoCoMo | 98.0% | ~98.0% |
| ConvoMem | 98.4% | — |
| MemBench | 96.6% | — |

## Problems Found (Audit Summary)

### P1: Content reranker triplicated with divergent coefficients
- `bm25.ts` lines 98-143: IDF-weighted, full content, boost 0.5/0.3
- `fusion.ts` rerank() lines 229-259: density-based (no IDF), snippet only, boost 0.3/0.2
- `kernel-adapter.js` lines 214-277: IDF-weighted, DB content, boost **4.0/2.0**
- **Impact:** Adapter boost 8x stronger than core = inflated benchmark scores

### P2: IDF reranker in wrong layer
- BM25 plugin does post-retrieval reranking (should be fusion's job)
- Results get double-reranked: once in BM25, again in fusion
- Scores from BM25 are pre-boosted before fusion sees them

### P3: BM25 and vector scores on incomparable scales
- BM25: `abs(score) * weight` → range ~0.1-10.0
- Vector: cosine similarity → range 0.0-1.0
- Fusion weights (bm25: 0.45, vector: 0.35) are nominal — BM25 dominates
- **This is why vector search barely helps in fusion**

### P4: Benchmark-specific synonyms in production core
- ~40% of EXPANSIONS are benchmark patches (supervillain, digestive, karate, etc.)
- Comments confirm: `// MemBench patterns`, `// Targeted additions for failure patterns`
- Evaluation data contamination in production code

### P5: Adapter has extra strategies not in core
- Trigram fallback: adapter only
- Individual temporal keywords: adapter only
- Vector threshold: 0.15 (adapter) vs 0.20 (core)
- Reranker coefficients: 4.0/2.0 (adapter) vs 0.5/0.3 (core)

### P6: Dead code
- `mmrDiversify()` in fusion.ts — defined, never called
- `BlockSearchOrchestrator` in fusion.ts — never instantiated
- `block-selector.ts` — only used by dead BlockSearchOrchestrator
- `shouldFallback()` on all plugins — fusion never calls it
- `SearchIntent.keywords` — populated, never read
- `sanitizeFTS5()` (no Query suffix) — zero imports

## Implementation Plan

### Phase 1: Dead Code Cleanup (zero risk)

**Files:** fusion.ts, block-selector.ts, fts5-utils.ts, intent.ts, all plugin shouldFallback

1. Remove `mmrDiversify()` and `snippetOverlap()` from fusion.ts
2. Remove `BlockSearchOrchestrator` class from fusion.ts
3. Remove `block-selector.ts` imports from fusion.ts
4. Remove `sanitizeFTS5()` (non-Query version) from fts5-utils.ts
5. Remove `keywords` field computation from intent.ts classify()
6. Keep `shouldFallback()` interface (don't break types) but add `@deprecated` comment
7. Fix strategy numbering comments in bm25.ts

**Verification:** `npm test` + all 4 benchmarks (BM25-only). Expect: identical scores.

### Phase 2: Synonym Separation (zero risk to benchmarks)

**Files:** query-builder.ts, new benchmarks/lib/expansions.js

1. Split EXPANSIONS into two:
   - `CORE_EXPANSIONS` in query-builder.ts — general vocabulary only (~30 entries)
   - `BENCH_EXPANSIONS` in benchmarks/lib/expansions.js — benchmark-specific patches
2. query-builder.ts exports `CORE_EXPANSIONS` as default `EXPANSIONS`
3. query-builder.ts adds `setExpansions(custom)` or makes EXPANSIONS injectable
4. Adapter merges CORE + BENCH at startup
5. Core product uses only CORE_EXPANSIONS

**Verification:** Benchmarks use merged expansions → identical scores. Core product uses clean expansions.

### Phase 3: Single Reranker in Fusion (medium risk)

**Files:** bm25.ts, fusion.ts, kernel-adapter.js

1. Remove IDF reranker block from `bm25.ts` (lines 98-143)
   - BM25 returns raw `abs(relevance) * weight` scores only
2. Upgrade fusion.ts `rerank()`:
   - Add IDF weighting (currently only density)
   - Use full content from SearchResult (not just snippet)
   - Add synonym-aware matching using EXPANSIONS
   - Single set of coefficients (calibrate to match current behavior)
3. Remove content reranker from adapter
   - Adapter's search() returns raw scores, delegates reranking to a shared function
4. Import and use the core rerank function in adapter

**Verification:** Run all 4 benchmarks. Accept <=1pp drop as "removing inflation."

### Phase 4: Score Normalization (high impact)

**Files:** bm25.ts, vector.ts, fusion.ts

1. BM25Search.search() normalizes scores to 0-1 before returning:
   - `score = score / maxScore` (or min-max normalization across results)
2. VectorSearch.search() already returns 0-1 (cosine similarity) — no change needed
3. Fusion weights now work correctly:
   - `bm25: 0.45` and `vector: 0.35` become meaningful
   - Remove the `sim * 3.0` hack from adapter
4. Remove dynamic weight hacks that compensated for scale mismatch

**Verification:** Run all benchmarks BM25-only (should be ~same) and +vector (should improve significantly since vector actually contributes now).

### Phase 5: Adapter = Core (final alignment)

**Files:** kernel-adapter.js

1. Remove trigram fallback from adapter (or add to core bm25.ts)
2. Remove individual temporal keyword loop from adapter (or add to core)
3. Align vector threshold: adapter uses core's 0.20
4. Adapter's search() should be a thin wrapper around core logic
5. vectorRerank() stays as benchmark utility

**Verification:** Benchmarks = product behavior. Any score difference is real.

## Risk Mitigation

- **Git commit after each phase** — easy revert
- **Run all 4 benchmarks after each phase** — catch regressions immediately
- **Track scores in a table** — document delta per phase
- **Phase 1 and 2 are zero-risk** — do these first to build confidence
- **Phase 3 is the riskiest** — may need coefficient tuning

## Expected Outcomes

| Benchmark | Before refactor | After refactor (est.) | Notes |
|---|---|---|---|
| LME R@5 | 97.2% | 96-97% | May drop 0-1pp from reranker consolidation |
| LoCoMo | 98.0% | 97-98% | Trigram removal may cost 0-0.5pp |
| ConvoMem | 98.4% | 98-98.4% | Minimal change |
| MemBench | 96.6% | 94-96% | Most affected by reranker coefficient reduction |
| **+Vector** | barely helps | **significant lift** | Score normalization unlocks vector contribution |

The key win: **after refactor, vector search will actually work in fusion** instead of being drowned by BM25 scores. This should recover or exceed pre-refactor scores when vector is enabled.

## Files Modified Per Phase

| Phase | Files | New files |
|---|---|---|
| 1 | fusion.ts, fts5-utils.ts, intent.ts, bm25.ts | — |
| 2 | query-builder.ts | benchmarks/lib/expansions.js |
| 3 | bm25.ts, fusion.ts, kernel-adapter.js | — |
| 4 | bm25.ts, vector.ts, fusion.ts, kernel-adapter.js | — |
| 5 | kernel-adapter.js, (optionally bm25.ts) | — |
