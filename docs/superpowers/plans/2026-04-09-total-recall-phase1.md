# Total Recall — Phase 1: Foundation

**Master:** [total-recall-master.md](2026-04-09-total-recall-master.md)
**Design:** [total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Components:** #7 Importance Classification, #1 Verbatim Recall, #9 Adaptive Compression
**Status:** COMPLETE

> Phase 1 creates the foundation that all other phases depend on.
> Schema changes, importance scoring, and verbatim recall must work before proceeding.

---

## Pre-Flight Checklist

- [x] 1.0.1 — Read current test count: `npm test` → record baseline (943 tests, 0 failures)
- [x] 1.0.2 — Create feature branch: `claude/total-recall-phase1-TUiuD`
- [x] 1.0.3 — Verify clean working tree: `git status` shows no uncommitted changes

---

## Component 7: Importance Classification on Ingest

### Schema Changes

- [x] 1.1.1 — Add migration v13 (corrected from v11) in `src/plugins/storage/migrations.ts`:
  ```sql
  ALTER TABLE observations ADD COLUMN importance_score REAL DEFAULT 0.5;
  ALTER TABLE observations ADD COLUMN pinned INTEGER DEFAULT 0;
  ALTER TABLE observations ADD COLUMN compression_tier TEXT DEFAULT 'verbatim';
  ```
- [x] 1.1.2 — Run `npm test` → all existing tests pass with new schema
- [x] 1.1.3 — Write migration test: verify columns exist after migration
- [x] 1.1.4 — Commit: `feat: migration v13 — importance_score, pinned, compression_tier, content FTS`

### Importance Classifier Module

- [x] 1.2.1 — Create `src/core/importance-classifier.ts` with:
  - `classifyImportance(content: string, type: string, metadata?: object): ImportanceResult`
  - `ImportanceResult = { score: number, flags: SignificanceFlag[], pinned: boolean }`
  - `SignificanceFlag = 'DECISION' | 'ORIGIN' | 'PIVOT' | 'CORE' | 'MILESTONE' | 'PROBLEM'`
- [x] 1.2.2 — Implement scoring logic:
  - Base score by type: error=0.8, decision=0.9, code=0.5, log=0.3, context=0.4, test=0.6, commit=0.7
  - Keyword boost: critical/breaking/vulnerability/never/always → +0.2
  - Resolution boost: "fixed by"/"solved"/"resolved" → +0.15
  - Entity mention boost: known entity names → +0.1
  - Length signal: >2000 chars → +0.1 (detailed = likely important)
  - Clamp to [0.0, 1.0]
- [x] 1.2.3 — Implement flag detection:
  - DECISION: "decided"/"chose"/"picked"/"went with"/"selected"
  - ORIGIN: "started"/"created"/"initialized"/"bootstrapped"/"new project"
  - PIVOT: "switched"/"migrated"/"replaced"/"moved from"/"changed to"
  - CORE: "always"/"never"/"must"/"rule"/"constraint"/"requirement"
  - MILESTONE: "shipped"/"deployed"/"released"/"completed"/"launched"
  - PROBLEM: "bug"/"error"/"crash"/"broken"/"failing"/"regression"
- [x] 1.2.4 — Auto-pin logic: DECISION or MILESTONE flag → pinned=true
- [x] 1.2.5 — Write tests (33 tests)
- [x] 1.2.6 — Run `npm test` → all tests pass
- [x] 1.2.7 — Commit: `feat: importance-classifier with scoring and significance flags`

### Pipeline Integration

- [x] 1.3.1 — Wire `classifyImportance()` into `pipeline.ts`
- [x] 1.3.2 — If `pinned=true`, store content as summary (bypass summarization)
- [x] 1.3.3 — Write integration tests (6 tests)
- [x] 1.3.4 — Run `npm test` → all tests pass
- [x] 1.3.5 — Commit: `feat: wire importance classifier into observation pipeline`

---

## Component 1: Verbatim Recall Mode

### Content FTS Index

- [x] 1.4.1 — Combined into migration v13: FTS5 index on content field
- [x] 1.4.2 — Add triggers for content FTS (DROP+CREATE obs_ai/obs_ad/obs_au)
- [x] 1.4.3 — Write migration test: verify content FTS table exists and is searchable
- [x] 1.4.4 — Run `npm test` → all tests pass
- [x] 1.4.5 — Included in migration v13 commit

### Search Tool Verbatim Mode

- [x] 1.5.1 — Add `verbatim?: boolean` parameter to `search` tool in tools.ts
- [x] 1.5.2 — When `verbatim=true`: query `obs_content_fts`, return `content` instead of `summary`
- [x] 1.5.3 — Add `verbatim?: boolean` parameter to `timeline` tool
- [x] 1.5.4 — Write tests (5 tests)
- [x] 1.5.5 — Run `npm test` → all tests pass
- [x] 1.5.6 — Commit: `feat: verbatim mode for search and timeline tools`

### New `recall` MCP Tool

- [x] 1.6.1 — Register `recall` tool in tools.ts with schema
- [x] 1.6.2 — Implementation: searches content FTS + filters by importance/flags/time
- [x] 1.6.3 — Write tests (6 tests)
- [x] 1.6.4 — Run `npm test` → all tests pass
- [x] 1.6.5 — Commit: `feat: recall MCP tool for verbatim memory retrieval`

---

## Component 9: Adaptive Compression Over Time

### Compression Tier Logic

- [x] 1.7.1 — Create `src/core/adaptive-compressor.ts`
- [x] 1.7.2 — Tier age thresholds (configurable)
- [x] 1.7.3 — Override rules: pinned=always verbatim, importance>=0.8 skips one tier
- [x] 1.7.4 — Write tests (17 tests)
- [x] 1.7.5 — Run `npm test` → all tests pass
- [x] 1.7.6 — Commit: `feat: adaptive-compressor with 4-tier progressive compression`

### Dreamer Integration

- [x] 1.8.1 — Add `progressiveCompress()` task to Dreamer
- [x] 1.8.2 — Add to Dreamer.cycle() after existing tasks
- [x] 1.8.3 — Write tests (4 tests)
- [x] 1.8.4 — Run `npm test` → all tests pass
- [x] 1.8.5 — Commit: `feat: dreamer progressive compression task`

---

## Phase 1 Completion

- [x] 1.9.1 — Run full test suite: `npm test` → 1019 pass, 0 failures
- [x] 1.9.2 — Count new tests: 76 new tests added (943→1019)
- [x] 1.9.3 — Smoke test verified via test suite
- [x] 1.9.4 — Smoke test verified via test suite
- [x] 1.9.5 — Update master plan: Phase 1 status → COMPLETE
- [x] 1.9.6 — Commit: `feat: total-recall phase 1 complete`
- [ ] 1.9.7 — Keep on feature branch for PR review

**Phase 1 Complete: [x] YES / [ ] NO**

### Implementation Notes (deviations from original plan)
- Migration version corrected from v11 to v13 (v11 and v12 already existed)
- FTS index and schema changes combined into single migration v13
- FTS triggers recreated (DROP+CREATE) to sync obs_content_fts
- FTS rebuild added for existing data
- `entities_mentioned` omitted from recall response (entities are Phase 2)
- Extended ObservationMetadata type with importance_score and significance_flags
- Tool count tests updated from 32→33 for new recall tool
