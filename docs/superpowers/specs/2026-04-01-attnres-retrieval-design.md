# AttnRes-Inspired Retrieval Architecture — Design Specification

> Applies Attention Residuals (MoonshotAI/Kimi) concepts to context-mem's memory retrieval system.
> Core insight: replace fixed-weight aggregation with selective, content-aware attention at every retrieval layer.

**Created:** 2026-04-01
**Version:** v2.4.0 (next release)
**Scope:** Core algorithm only — no new MCP tools, no dashboard changes

---

## Background

### The AttnRes Paper

Standard Transformer residual connections sum all prior layer outputs with equal weights — information is lost through uniform aggregation. AttnRes replaces this with softmax attention over depth: each layer selectively chooses which earlier outputs matter, using a learned query vector against content-dependent keys.

Key principles applied here:
1. **Softmax attention** — competitive normalization forces sharp selection
2. **RMSNorm on keys** — prevents large outputs from dominating attention
3. **Block grouping** — attention between blocks, residual within blocks
4. **Zero init** — default behavior equals baseline (safe fallback)

### Current State

context-mem v2.3.0 retrieval:
- `rerank()` in `fusion.ts`: fixed weights `0.7 × relevance + 0.2 × recency + 0.1 × access`
- `IntentClassifier` in `intent.ts`: classifies queries as causal/temporal/lookup/general, applies type_boosts but does NOT affect reranking weights
- `SearchFusion.execute()`: searches all observations in one pool, no block-level partitioning
- Contradiction detection: 3-layer (FTS5 + word overlap + vector), resolution is "newest wins" or manual

---

## Feature 1: Adaptive Reranking

### Problem

Fixed 70/20/10 weights treat "why did auth break?" and "how does auth work?" identically. A causal query needs recency emphasis; a lookup query needs relevance emphasis.

### Design

#### Intent-Specific Weight Vectors

```typescript
const INTENT_WEIGHTS: Record<string, { relevance: number; recency: number; access: number }> = {
  causal:   { relevance: 0.40, recency: 0.50, access: 0.10 },
  temporal: { relevance: 0.25, recency: 0.60, access: 0.15 },
  lookup:   { relevance: 0.80, recency: 0.10, access: 0.10 },
  general:  { relevance: 0.55, recency: 0.30, access: 0.15 },  // baseline for result-aware adjustment
};
```

#### Result-Aware Weighting (General Intent)

For `general` intent, the system uses baseline weights but adjusts based on result characteristics — this is the AttnRes mechanism: fixed query × content-dependent keys → adaptive weights.

```
1. Compute scores with baseline general weights (0.55, 0.30, 0.15)
2. Measure result characteristics:
   - relevance_variance = variance(results.relevance_scores)
   - time_spread = (max_timestamp - min_timestamp) / 7_days_ms

3. Adjust:
   if relevance_variance < 0.01:   // scores too close, relevance can't differentiate
     recency_weight += 0.15
     relevance_weight -= 0.15

   if time_spread < 0.1:           // all results are recent, recency can't differentiate
     relevance_weight += 0.15
     recency_weight -= 0.15
```

#### API Change

```typescript
// Before
export function rerank(results: SearchResult[]): SearchResult[]

// After
export function rerank(results: SearchResult[], intentType: SearchIntent['intent_type']): SearchResult[]
```

`SearchFusion.execute()` passes `intent.intent_type` to `rerank()`.

### Files Changed

- `src/plugins/search/fusion.ts` — `rerank()` signature + INTENT_WEIGHTS + result-aware logic
- `src/tests/plugins/search/fusion.test.ts` — tests per intent type + result-aware adjustment

---

## Feature 2: Block-Level Memory Attention

### Problem

All observations are searched in one pool. A project with 10,000 observations dilutes results from the current session. No structural partitioning exists.

### Design

#### 4 Scope-Based Blocks

| Block | Source | Description |
|-------|--------|-------------|
| Session | `observations` WHERE session_id = current | Current session observations |
| Project | `knowledge` WHERE archived = false | Active project knowledge |
| Global | global store (`~/.context-mem/global/`) | Cross-project knowledge |
| Archive | `knowledge` WHERE archived = true + old observations | Archived entries |

#### Two-Phase Search

**Phase 1 — Block Selection (lightweight):**
```
For each block:
  Run BM25 search with limit=3
  block_score = max(top_3.relevance_scores)

block_attention = softmax(block_scores)

Skip blocks where block_attention < 0.05
```

**Phase 2 — Deep Search (selected blocks only):**
```
For each selected block:
  Run full search pipeline (BM25 → Trigram → Levenshtein → Vector)
  Per-block normalization: score = (score - min) / (max - min + ε)
  Weight results: final_score = normalized_score × block_attention[i]

Merge all block results, sort by final_score
Apply adaptive reranking (Feature 1)
```

#### Per-Block Normalization (RMSNorm Analogue)

Each block's scores are normalized to 0-1 range independently before cross-block comparison:

```typescript
function normalizeBlock(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;
  if (results.length === 1) return [{ ...results[0], relevance_score: 1.0 }]; // single result gets max score
  const scores = results.map(r => r.relevance_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min + 1e-8; // epsilon to avoid division by zero
  return results.map(r => ({
    ...r,
    relevance_score: (r.relevance_score - min) / range,
  }));
}
```

This prevents a block with 10,000 entries (higher raw BM25 scores) from overwhelming a block with 5 entries.

#### Performance

Lightweight BM25 (limit=3) on 4 blocks ≈ cost of one full search. Skipping irrelevant blocks makes overall search faster than current single-pool approach.

### Files Changed

- `src/plugins/search/fusion.ts` — `BlockSearchOrchestrator` class wrapping `SearchFusion`, receives `session_id` via constructor from `ContextMemServer` (which already tracks current session)
- `src/plugins/search/block-selector.ts` — new file, block definition + lightweight scoring + softmax
- `src/core/types.ts` — `SearchBlock` type, `BlockSearchConfig` interface
- `src/tests/plugins/search/block-search.test.ts` — block selection, normalization, skip logic, single-result edge case

---

## Feature 3: Depth-Aware Contradiction Resolution

### Problem

When two knowledge entries contradict, the system warns but provides no guidance on which is more authoritative. Current heuristic: newest wins. This ignores source quality, usage patterns, and cross-session validation.

### Design

#### Authority Score

Each entry in a contradiction pair gets an authority score computed via softmax over 4 factors:

```typescript
function computeAuthority(entry: KnowledgeEntry, sessionCount: number): number {
  const sourceWeight = { explicit: 1.0, inferred: 0.6, observed: 0.3 }[entry.source_type];
  const sessionBreadth = Math.log2(sessionCount + 1) / 5;  // 0-1 range, 32 sessions → 1.0
  const ageDays = (Date.now() - entry.created_at) / (24 * 60 * 60 * 1000);
  const accessDensity = ageDays > 0 ? (entry.access_count / ageDays) / 10 : 0;  // normalized
  const recency = Math.pow(0.5, ageDays / 7);  // 7-day half-life

  const raw = [sourceWeight, sessionBreadth, accessDensity, recency];
  const expScores = raw.map(x => Math.exp(x));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const attention = expScores.map(x => x / sumExp);  // softmax

  return attention[0] * sourceWeight
       + attention[1] * sessionBreadth
       + attention[2] * accessDensity
       + attention[3] * recency;
}
```

Softmax normalization ensures competitive weighting — a very high source_weight naturally suppresses the influence of other factors.

#### Length Normalization (Entry-Level RMSNorm)

Contradiction similarity scores are length-normalized to prevent long entries from appearing more contradictory due to higher keyword overlap:

```
normalized_similarity = raw_similarity / log(content_length + 1)
```

#### Extended ContradictionWarning

```typescript
interface ContradictionWarning {
  id: string;
  title: string;
  content: string;
  similarity_reason: string;
  source_type?: SourceType;
  // New fields:
  authority_existing: number;    // 0-1
  authority_new: number;         // 0-1
  suggested_action: 'keep_existing' | 'replace' | 'merge';
}
```

Suggested action logic:
- `|authority_existing - authority_new| > 0.3` → higher authority wins (`keep_existing` or `replace`)
- `|authority_existing - authority_new| <= 0.3` → both are valuable → `merge`

#### Integration Point

Write-time only. `KnowledgeBase.save()` already calls contradiction detection. After detection, `computeAuthority()` runs on both entries and populates the new fields.

### Files Changed

- `src/plugins/knowledge/knowledge-base.ts` — `computeAuthority()`, extended contradiction flow
- `src/core/types.ts` — `ContradictionWarning` extended with authority fields
- `src/tests/plugins/knowledge/knowledge-base.test.ts` — authority scoring + suggested_action tests

---

## Implementation Order

| Phase | Feature | Dependencies |
|-------|---------|-------------|
| 1 | Adaptive Reranking | None — modifies existing `rerank()` |
| 2 | Depth-Aware Contradiction Resolution | None — modifies existing contradiction flow |
| 3 | Block-Level Memory Attention | Benefits from Phase 1 (reranking applies after block merge) |

Phase 1 and 2 are independent. Phase 3 depends on Phase 1 being complete since adaptive reranking is applied after block results are merged.

---

## Testing Strategy

- Unit tests per feature (weight vectors, normalization, authority scoring)
- Integration test: full search pipeline with blocks + adaptive reranking
- Regression test: general intent with current data should produce same or better results than fixed 70/20/10
- Edge cases: empty blocks, single result, all-same-score results, zero-age entries

---

## Migration

- **Database**: No schema changes required. All changes are algorithmic.
- **Config**: No new config options. Weights are hardcoded per intent.
- **Backwards compatibility**: `general` intent with non-edge-case results produces weights close to current 70/20/10, ensuring safe rollout.
