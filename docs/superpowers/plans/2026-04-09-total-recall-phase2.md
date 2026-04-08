# Total Recall — Phase 2: Core Intelligence

**Master:** [total-recall-master.md](2026-04-09-total-recall-master.md)
**Design:** [total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Depends on:** Phase 1 COMPLETE
**Components:** #6 Wake-Up Primer, #3 Entity Intelligence, #5 Temporal Facts, #12 Feedback Loop
**Status:** COMPLETE

> Phase 2 adds the intelligence layer: entities, temporal reasoning, and smart session initialization.
> DO NOT START until Phase 1 is 100% complete and all tests pass.

---

## Pre-Flight Checklist

- [ ] 2.0.1 — Verify Phase 1 is COMPLETE in master plan
- [ ] 2.0.2 — Run `npm test` → all pass (including Phase 1 tests)
- [ ] 2.0.3 — Create branch if needed: `git checkout -b feat/total-recall-phase2`

---

## Component 3: Entity Intelligence + Alias Resolution

### Schema Changes

- [ ] 2.1.1 — Add migration v12 in `src/plugins/storage/migrations.ts`:
  ```sql
  ALTER TABLE entities ADD COLUMN canonical_id TEXT;
  ALTER TABLE entities ADD COLUMN aliases TEXT DEFAULT '[]';
  CREATE INDEX IF NOT EXISTS idx_entities_canonical ON entities(canonical_id);
  ```
- [ ] 2.1.2 — Write migration test
- [ ] 2.1.3 — Run `npm test` → all pass
- [ ] 2.1.4 — Commit: `feat: add canonical_id and aliases to entities table`

### Entity Extractor Module

- [ ] 2.2.1 — Create `src/core/entity-extractor.ts` with:
  - `extractEntities(content: string, knownEntities?: Entity[]): ExtractedEntity[]`
  - `ExtractedEntity = { name: string, type: EntityType, confidence: number, aliases: string[] }`
- [ ] 2.2.2 — Detection heuristics:
  - CamelCase tokens → component (confidence 0.8)
  - ALL_CAPS_WITH_UNDERSCORES → config/constant (confidence 0.7)
  - path/like/segments → file (confidence 0.9)
  - Known technology list (top 200: React, Postgres, Redis, Docker, etc.) → technology (confidence 0.95)
  - Capitalized multi-word in conversational context → person (confidence 0.6)
  - `#123` or `issue-123` patterns → issue (confidence 0.9)
  - `v1.2.3` patterns → version (confidence 0.9)
- [ ] 2.2.3 — Alias resolution:
  - Maintain alias map: `{"React": ["React.js", "ReactJS", "react"], "PostgreSQL": ["Postgres", "pg", "psql"]}`
  - Ship with 100+ common technology aliases
  - User-extensible via config
  - On extract: check if name matches any alias → return canonical name
- [ ] 2.2.4 — Optional LLM enhancement: if LLM enabled, disambiguate uncertain entities (e.g., "Grace" — person or library?)
- [ ] 2.2.5 — Write tests (≥12):
  - Test CamelCase detection
  - Test ALL_CAPS detection
  - Test file path detection
  - Test known technology matching
  - Test person name detection
  - Test alias resolution (React.js → React)
  - Test unknown entity returns low confidence
  - Test empty content returns empty array
  - Test mixed content with multiple entity types
  - Test case-insensitive alias matching
  - Test issue/version pattern detection
  - Test deduplication (same entity mentioned 5 times → 1 result)
- [ ] 2.2.6 — Run `npm test` → all pass
- [ ] 2.2.7 — Commit: `feat: entity-extractor with alias resolution and technology detection`

### Pipeline Integration

- [ ] 2.3.1 — Wire `extractEntities()` into pipeline.ts after importance classification
- [ ] 2.3.2 — For each extracted entity: create/update entity in KG via `knowledge-graph.ts`
- [ ] 2.3.3 — Create relationships: observation → entity (type: 'mentions')
- [ ] 2.3.4 — Store extracted entity names in observation metadata for fast lookup
- [ ] 2.3.5 — Write integration tests (≥5)
- [ ] 2.3.6 — Run `npm test` → all pass
- [ ] 2.3.7 — Commit: `feat: wire entity extraction into observation pipeline`

### New MCP Tools

- [ ] 2.4.1 — Register `entity_detect` tool: manual entity extraction from text
- [ ] 2.4.2 — Register `list_people` tool: list all person entities with relationship counts
- [ ] 2.4.3 — Write tests (≥4)
- [ ] 2.4.4 — Run `npm test` → all pass
- [ ] 2.4.5 — Commit: `feat: entity_detect and list_people MCP tools`

---

## Component 5: Temporal Facts

### Schema Changes

- [ ] 2.5.1 — Add to migration v12:
  ```sql
  ALTER TABLE knowledge ADD COLUMN valid_from INTEGER;
  ALTER TABLE knowledge ADD COLUMN valid_to INTEGER;
  ALTER TABLE knowledge ADD COLUMN superseded_by TEXT;
  ALTER TABLE knowledge ADD COLUMN last_useful_at INTEGER;
  ```
- [ ] 2.5.2 — Write migration test
- [ ] 2.5.3 — Run `npm test` → all pass
- [ ] 2.5.4 — Commit: `feat: add temporal columns to knowledge table`

### Temporal Query Logic

- [ ] 2.6.1 — Update `save_knowledge` tool: accept optional `valid_from` (default: now)
- [ ] 2.6.2 — Update contradiction detection: when contradiction found, set `valid_to` on old entry, set `superseded_by` → new entry ID
- [ ] 2.6.3 — Update `search_knowledge` tool: filter by `valid_to IS NULL` by default (only active facts)
- [ ] 2.6.4 — Create `temporal_query` MCP tool: query knowledge valid at specific timestamp
- [ ] 2.6.5 — Write tests (≥8):
  - Test save_knowledge sets valid_from
  - Test contradiction sets valid_to on old entry
  - Test superseded_by chain links correctly
  - Test search_knowledge returns only active facts
  - Test temporal_query at past timestamp returns old fact
  - Test temporal_query at current time returns current fact
  - Test overlapping validity windows
  - Test multiple supersession chain (A → B → C)
- [ ] 2.6.6 — Run `npm test` → all pass
- [ ] 2.6.7 — Commit: `feat: temporal facts with valid_from/valid_to and supersession chains`

---

## Component 6: Wake-Up Primer

### Wake-Up Assembly

- [ ] 2.7.1 — Create `src/core/wake-up.ts` with:
  - `assembleWakeUp(storage, config): WakeUpPayload`
  - `WakeUpPayload = { l0_profile: string, l1_critical: string, l2_recent: string, l3_entities: string, total_tokens: number }`
- [ ] 2.7.2 — L0 Profile: read project profile (existing `update_profile` data)
- [ ] 2.7.3 — L1 Critical: query top 10 knowledge entries by:
  `importance_score * (1 + log(access_count+1)) * recency_weight(last_accessed)`
  - recency_weight: today=1.0, 7d=0.8, 30d=0.5, 90d=0.3
- [ ] 2.7.4 — L2 Recent: last session snapshot key decisions + open TODOs
- [ ] 2.7.5 — L3 Entities: top 5 entities by recent relationship count
- [ ] 2.7.6 — Token budget: total ≤700 tokens (configurable), proportional allocation: L0=15%, L1=40%, L2=30%, L3=15%
- [ ] 2.7.7 — Write tests (≥8):
  - Test L0 reads profile
  - Test L1 ranks by combined score
  - Test L1 respects token budget
  - Test L2 includes last session decisions
  - Test L3 shows top entities
  - Test total payload within budget
  - Test empty DB returns minimal payload
  - Test high-importance entries appear in L1
- [ ] 2.7.8 — Run `npm test` → all pass
- [ ] 2.7.9 — Commit: `feat: wake-up primer with 4-layer scored context assembly`

### MCP Tool + Hook Integration

- [ ] 2.8.1 — Register `wake_up` MCP tool that calls `assembleWakeUp()`
- [ ] 2.8.2 — Update `hooks/session-start-hook.js` to call `wake_up` tool and inject result
- [ ] 2.8.3 — Write tests (≥3)
- [ ] 2.8.4 — Run `npm test` → all pass
- [ ] 2.8.5 — Commit: `feat: wake_up MCP tool and session-start hook integration`

---

## Component 12: Memory Usefulness Feedback

### Feedback Engine

- [ ] 2.9.1 — Add `last_useful_at INTEGER` column to observations table (in migration v12)
- [ ] 2.9.2 — Create `src/core/feedback-engine.ts` with:
  - `trackSearchResults(searchResultIds: string[]): void` — remember what was returned
  - `checkUsefulness(event: Event): void` — if file_modify event matches a tracked result → mark useful
  - `flushFeedback(): void` — batch-update last_useful_at and relevance_score
- [ ] 2.9.3 — Wire into pipeline: after search results returned, call `trackSearchResults`
- [ ] 2.9.4 — Wire into event tracker: on file_modify, call `checkUsefulness`
- [ ] 2.9.5 — Wire into session end (handoff_session): call `flushFeedback`
- [ ] 2.9.6 — Dreamer enhancement: entries retrieved 5+ times but never useful → faster decay
- [ ] 2.9.7 — Write tests (≥6):
  - Test search results are tracked
  - Test file_modify marks relevant result as useful
  - Test unrelated file_modify doesn't mark as useful
  - Test flush updates last_useful_at
  - Test flush boosts relevance_score
  - Test dreamer decays never-useful entries
- [ ] 2.9.8 — Run `npm test` → all pass
- [ ] 2.9.9 — Commit: `feat: memory usefulness feedback engine with action correlation`

---

## Phase 2 Completion

- [ ] 2.10.1 — Run full test suite: `npm test` → ALL pass, 0 failures
- [ ] 2.10.2 — Count new tests: should be ≥40 new tests
- [ ] 2.10.3 — Manual smoke test: wake_up tool returns scored context
- [ ] 2.10.4 — Manual smoke test: entity_detect extracts entities from text
- [ ] 2.10.5 — Manual smoke test: temporal_query returns facts at specific time
- [ ] 2.10.6 — Update master plan: Phase 2 status → COMPLETE, progress → 28/28
- [ ] 2.10.7 — Commit: `feat: total-recall phase 2 complete — core intelligence (entities, temporal, wake-up, feedback)`

**Phase 2 Complete: [ ] YES / [ ] NO**
