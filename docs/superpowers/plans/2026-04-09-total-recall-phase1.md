# Total Recall — Phase 1: Foundation

**Master:** [total-recall-master.md](2026-04-09-total-recall-master.md)
**Design:** [total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Components:** #7 Importance Classification, #1 Verbatim Recall, #9 Adaptive Compression
**Status:** NOT STARTED

> Phase 1 creates the foundation that all other phases depend on.
> Schema changes, importance scoring, and verbatim recall must work before proceeding.

---

## Pre-Flight Checklist

- [ ] 1.0.1 — Read current test count: `npm test` → record baseline (expected: 943)
- [ ] 1.0.2 — Create feature branch: `git checkout -b feat/total-recall-phase1`
- [ ] 1.0.3 — Verify clean working tree: `git status` shows no uncommitted changes

---

## Component 7: Importance Classification on Ingest

### Schema Changes

- [ ] 1.1.1 — Add migration v11 in `src/plugins/storage/migrations.ts`:
  ```sql
  ALTER TABLE observations ADD COLUMN importance_score REAL DEFAULT 0.5;
  ALTER TABLE observations ADD COLUMN pinned INTEGER DEFAULT 0;
  ALTER TABLE observations ADD COLUMN compression_tier TEXT DEFAULT 'verbatim';
  ```
- [ ] 1.1.2 — Run `npm test` → all existing tests pass with new schema
- [ ] 1.1.3 — Write migration test: verify columns exist after migration
- [ ] 1.1.4 — Commit: `feat: add importance_score, pinned, compression_tier columns to observations`

### Importance Classifier Module

- [ ] 1.2.1 — Create `src/core/importance-classifier.ts` with:
  - `classifyImportance(content: string, type: string, metadata?: object): ImportanceResult`
  - `ImportanceResult = { score: number, flags: SignificanceFlag[], pinned: boolean }`
  - `SignificanceFlag = 'DECISION' | 'ORIGIN' | 'PIVOT' | 'CORE' | 'MILESTONE' | 'PROBLEM'`
- [ ] 1.2.2 — Implement scoring logic:
  - Base score by type: error=0.8, decision=0.9, code=0.5, log=0.3, context=0.4, test=0.6, commit=0.7
  - Keyword boost: critical/breaking/vulnerability/never/always → +0.2
  - Resolution boost: "fixed by"/"solved"/"resolved" → +0.15
  - Entity mention boost: known entity names → +0.1
  - Length signal: >2000 chars → +0.1 (detailed = likely important)
  - Clamp to [0.0, 1.0]
- [ ] 1.2.3 — Implement flag detection:
  - DECISION: "decided"/"chose"/"picked"/"went with"/"selected"
  - ORIGIN: "started"/"created"/"initialized"/"bootstrapped"/"new project"
  - PIVOT: "switched"/"migrated"/"replaced"/"moved from"/"changed to"
  - CORE: "always"/"never"/"must"/"rule"/"constraint"/"requirement"
  - MILESTONE: "shipped"/"deployed"/"released"/"completed"/"launched"
  - PROBLEM: "bug"/"error"/"crash"/"broken"/"failing"/"regression"
- [ ] 1.2.4 — Auto-pin logic: DECISION or MILESTONE flag → pinned=true
- [ ] 1.2.5 — Write tests (≥12):
  - Test each observation type gets correct base score
  - Test keyword boost accumulates correctly
  - Test score clamping at 1.0
  - Test each significance flag detection
  - Test auto-pin for DECISION and MILESTONE
  - Test empty/null content returns default score
  - Test combined signals (type + keywords + length)
- [ ] 1.2.6 — Run `npm test` → all tests pass
- [ ] 1.2.7 — Commit: `feat: importance-classifier with scoring and significance flags`

### Pipeline Integration

- [ ] 1.3.1 — Wire `classifyImportance()` into `pipeline.ts`:
  - After step 2 (dedup), before step 3 (LLM summarizer)
  - Store `importance_score` in observation metadata AND in the new column
  - Store `flags` in observation metadata as JSON array
  - Store `pinned` in the new column
  - Set `compression_tier = 'verbatim'` for all new observations
- [ ] 1.3.2 — If `pinned=true`, skip steps 3-5 (summarization/truncation) — store content as-is in summary too
- [ ] 1.3.3 — Write integration tests (≥5):
  - Test high-importance observation gets correct score stored
  - Test pinned observation bypasses summarization
  - Test flags stored in metadata
  - Test compression_tier defaults to 'verbatim'
  - Test existing observe behavior unchanged for normal content
- [ ] 1.3.4 — Run `npm test` → all 943+ tests pass
- [ ] 1.3.5 — Commit: `feat: wire importance classifier into observation pipeline`

---

## Component 1: Verbatim Recall Mode

### Content FTS Index

- [ ] 1.4.1 — Add to migration v11: FTS5 index on content field
  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS obs_content_fts USING fts5(
    content,
    content=observations,
    content_rowid=rowid,
    tokenize='porter unicode61'
  );
  ```
- [ ] 1.4.2 — Add triggers for content FTS (INSERT/UPDATE/DELETE sync)
- [ ] 1.4.3 — Write migration test: verify content FTS table exists and is searchable
- [ ] 1.4.4 — Run `npm test` → all tests pass
- [ ] 1.4.5 — Commit: `feat: add FTS5 index on observations.content for verbatim search`

### Search Tool Verbatim Mode

- [ ] 1.5.1 — Add `verbatim?: boolean` parameter to `search` tool in tools.ts
- [ ] 1.5.2 — When `verbatim=true`: query `obs_content_fts` instead of `obs_fts`, return `content` instead of `summary`
- [ ] 1.5.3 — Add `verbatim?: boolean` parameter to `timeline` tool
- [ ] 1.5.4 — Write tests (≥5):
  - Test search with verbatim=false returns summary (existing behavior)
  - Test search with verbatim=true returns original content
  - Test content FTS finds terms in original content but not in summary
  - Test timeline with verbatim returns content
  - Test verbatim search with no results returns empty
- [ ] 1.5.5 — Run `npm test` → all tests pass
- [ ] 1.5.6 — Commit: `feat: verbatim mode for search and timeline tools`

### New `recall` MCP Tool

- [ ] 1.6.1 — Register `recall` tool in tools.ts with schema:
  ```
  { query: string, filters?: { type?, time_range?, importance_min?, flags? }, limit?: number }
  ```
- [ ] 1.6.2 — Implementation: searches content FTS + filters by importance/flags/time → returns rich response:
  ```
  { id, content (verbatim), date, importance_score, flags, entities_mentioned, source_type }
  ```
- [ ] 1.6.3 — Write tests (≥5):
  - Test recall returns verbatim content
  - Test importance_min filter works
  - Test flags filter works
  - Test time_range filter works
  - Test recall with combined filters
- [ ] 1.6.4 — Run `npm test` → all tests pass
- [ ] 1.6.5 — Commit: `feat: recall MCP tool for verbatim memory retrieval`

---

## Component 9: Adaptive Compression Over Time

### Compression Tier Logic

- [ ] 1.7.1 — Create `src/core/adaptive-compressor.ts` with:
  - `getTargetTier(indexed_at: number, importance_score: number, pinned: boolean): CompressionTier`
  - `compressToTier(content: string, summary: string, targetTier: CompressionTier): string`
  - `CompressionTier = 'verbatim' | 'light' | 'medium' | 'distilled'`
- [ ] 1.7.2 — Tier age thresholds (configurable):
  - verbatim: 0-7 days
  - light: 7-30 days (keep key sentences — first sentence of each paragraph + any sentence with DECISION/MILESTONE keywords)
  - medium: 30-90 days (existing summarizer output)
  - distilled: 90+ days (facts extraction — one-line per key fact)
- [ ] 1.7.3 — Override rules:
  - pinned=1 → always 'verbatim', never compress
  - importance_score >= 0.8 → skip one tier (e.g., 30-day old stays 'light' not 'medium')
- [ ] 1.7.4 — Write tests (≥8):
  - Test each tier threshold
  - Test pinned never compresses
  - Test high-importance skips tier
  - Test light compression keeps key sentences
  - Test medium uses summarizer
  - Test distilled extracts facts only
  - Test tier calculation with various ages
  - Test configurable thresholds
- [ ] 1.7.5 — Run `npm test` → all tests pass
- [ ] 1.7.6 — Commit: `feat: adaptive-compressor with 4-tier progressive compression`

### Dreamer Integration

- [ ] 1.8.1 — Add `progressiveCompress()` task to Dreamer:
  - Query observations where `compression_tier != getTargetTier()`
  - For each: compress content to target tier, update `summary`, update `compression_tier`
  - Log compression events
- [ ] 1.8.2 — Add to Dreamer.cycle() after existing tasks
- [ ] 1.8.3 — Write tests (≥4):
  - Test 8-day old observation moves from verbatim to light
  - Test 31-day old moves from light to medium
  - Test 91-day old moves from medium to distilled
  - Test pinned observation is skipped
- [ ] 1.8.4 — Run `npm test` → all tests pass
- [ ] 1.8.5 — Commit: `feat: dreamer progressive compression task`

---

## Phase 1 Completion

- [ ] 1.9.1 — Run full test suite: `npm test` → ALL pass, 0 failures
- [ ] 1.9.2 — Count new tests: should be ≥30 new tests added
- [ ] 1.9.3 — Manual smoke test: start MCP server, call `recall` tool, verify verbatim content
- [ ] 1.9.4 — Manual smoke test: call `search` with verbatim=true
- [ ] 1.9.5 — Update master plan: Phase 1 status → COMPLETE, progress → 24/24
- [ ] 1.9.6 — Commit: `feat: total-recall phase 1 complete — foundation (importance, verbatim, compression)`
- [ ] 1.9.7 — Merge to main or keep on feature branch (decide per session)

**Phase 1 Complete: [ ] YES / [ ] NO**
