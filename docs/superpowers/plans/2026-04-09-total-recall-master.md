# Total Recall — Master Control File

**Version:** context-mem v3.0
**Started:** 2026-04-09
**Design Spec:** [specs/2026-04-09-total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Status:** IN PROGRESS

> This file is the single source of truth for all Total Recall work.
> Every session MUST read this file first to understand current state.
> Every completed task MUST be checked off here before moving on.
> Never skip a task. Never move to next phase before current phase is 100% complete.

---

## Quick Status

| Phase | Status | Progress | Plan File |
|-------|--------|----------|-----------|
| Phase 1: Foundation | COMPLETE | 53/53 | [phase1-foundation.md](2026-04-09-total-recall-phase1.md) |
| Phase 2: Core Intelligence | COMPLETE | 67/67 | [phase2-core-intelligence.md](2026-04-09-total-recall-phase2.md) |
| Phase 3: Navigation & Import | NOT STARTED | 0/48 | [phase3-navigation-import.md](2026-04-09-total-recall-phase3.md) |
| Phase 4: Killer Features | NOT STARTED | 0/38 | [phase4-killer-features.md](2026-04-09-total-recall-phase4.md) |
| Phase 5: Marketing & Launch | NOT STARTED | 0/25 | [phase5-marketing-launch.md](2026-04-09-total-recall-phase5.md) |

**Overall Progress: 120/231 tasks**

---

## Session Protocol

### Starting a New Session

1. Read THIS file first
2. Find current phase (first non-completed phase)
3. Read that phase's plan file
4. Find first unchecked task
5. Work on it, test it, check it off
6. Update this file's Quick Status

### Rules

- **ONE TASK AT A TIME** — Complete, test, verify, then check off
- **NEVER SKIP** — Tasks are ordered by dependency
- **TEST BEFORE CHECK** — Run `npm test` after every change. All 943+ tests must pass.
- **FIX BEFORE PROCEED** — If a test fails, fix it before moving to next task
- **UPDATE THIS FILE** — After completing any task, update progress counters here
- **COMMIT OFTEN** — Each completed sub-component gets its own commit

### Phase Transition Protocol

Before marking a phase complete:
1. ALL tasks in phase plan are checked off
2. `npm test` passes with 0 failures
3. New tests for phase components all pass
4. Manual smoke test of new MCP tools
5. Update this file: phase status → COMPLETE, progress → X/X
6. Commit with message: `feat: total-recall phase N complete — [description]`

---

## Phase Overview

### Phase 1: Foundation (P0) — 53 tasks
**Components:** #7 Importance Classification, #1 Verbatim Recall, #9 Adaptive Compression
**Why first:** Schema changes + importance scoring are prerequisites for everything else.
**Schema changes:** observations table (3 new columns), new FTS index on content.
**Deliverables:** importance-classifier.ts, verbatim search mode, compression tiers, ~30 new tests.

### Phase 2: Core Intelligence (P1) — 67 tasks
**Components:** #6 Wake-Up Primer, #3 Entity Intelligence, #5 Temporal Facts, #12 Feedback Loop
**Why second:** These add the intelligence layer that navigation and killer features depend on.
**Schema changes:** knowledge table (3 new columns), entities table (2 new columns).
**Deliverables:** wake-up hook, entity-extractor.ts, temporal query tool, feedback engine, ~40 new tests.

### Phase 3: Navigation & Import (P2) — 48 tasks
**Components:** #4 Topics + Tunnels, #2 Conversation Import, #10 Dreamer Consolidation, #11 UserPromptSubmit
**Why third:** Navigation needs entities + importance. Import needs the full pipeline. Consolidation needs temporal facts.
**Schema changes:** topics table (new), observation_topics table (new).
**Deliverables:** 6 format parsers, 4 new MCP tools, 4 new Dreamer tasks, new hook, ~40 new tests.

### Phase 4: Killer Features (P3) — 38 tasks
**Components:** #13 Decision Trail, #15 Session Narrative, #14 Regression Fingerprint, #8 Pressure Predictor
**Why fourth:** All depend on entities, importance, temporal facts, and the full pipeline.
**Schema changes:** decision_trails table (new), working_fingerprints table (new).
**Deliverables:** `why` CLI command, `story` CLI command, 4 new MCP tools, ~30 new tests.

### Phase 5: Marketing & Launch — 25 tasks
**Components:** README rewrite, benchmarks, plugin marketplace, version bump
**Why last:** Features must be complete and tested before marketing.
**Deliverables:** New README, benchmark results, marketplace listing, v3.0.0 release.

---

## Component → Phase Mapping

| # | Component | Phase | Status |
|---|-----------|-------|--------|
| 7 | Importance Classification on ingest | Phase 1 | COMPLETE |
| 1 | Verbatim Recall + content FTS | Phase 1 | COMPLETE |
| 9 | Adaptive Compression Over Time | Phase 1 | COMPLETE |
| 6 | Wake-Up Primer (auto-scored) | Phase 2 | COMPLETE |
| 3 | Entity Intelligence + alias resolution | Phase 2 | COMPLETE |
| 5 | Temporal Facts + superseded_by | Phase 2 | COMPLETE |
| 12 | Memory Usefulness Feedback | Phase 2 | COMPLETE |
| 4 | Navigable Topics + tunnels | Phase 3 | NOT STARTED |
| 2 | Conversation Import Engine | Phase 3 | NOT STARTED |
| 10 | Memory Consolidation in Dreamer | Phase 3 | NOT STARTED |
| 11 | Context-Triggered Wake-Up | Phase 3 | NOT STARTED |
| 13 | Decision Trail / `why` command | Phase 4 | NOT STARTED |
| 15 | Session Narrative / `story` command | Phase 4 | NOT STARTED |
| 14 | Regression Fingerprinting | Phase 4 | NOT STARTED |
| 8 | Memory Pressure Predictor | Phase 4 | NOT STARTED |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/plugins/storage/migrations.ts` | Schema changes land here |
| `src/core/pipeline.ts` | Observation ingest pipeline — importance + entity hooks go here |
| `src/core/dreamer.ts` | Background agent — compression + consolidation tasks |
| `src/core/knowledge-graph.ts` | Entity + relationship CRUD |
| `src/core/auto-tagger.ts` | Keyword extraction — extend for importance signals |
| `src/core/session.ts` | Session management — wake-up primer integration |
| `src/core/nl-query.ts` | Natural language query — temporal + entity search |
| `src/core/time-travel.ts` | Time travel — regression fingerprinting |
| `src/core/events.ts` | Event tracking — decision trail source |
| `src/core/global-store.ts` | Cross-project — tunnels integration |
| `src/mcp-server/tools.ts` | MCP tool registration — all new tools |
| `hooks/session-start-hook.js` | Wake-up primer delivery |
| `hooks/proactive-inject.js` | Context injection — entity-aware upgrade |

---

## Version History

- 2026-04-09: Master plan created. Design spec approved. 15 components, 5 phases, 231 tasks.
- 2026-04-08: Phase 1 complete. Migration v13, importance classifier, verbatim recall, adaptive compression, dreamer integration. 76 new tests (943→1019). 8 commits.
- 2026-04-08: Phase 2 complete. Migration v14, entity extractor with 100+ aliases, temporal facts, wake-up primer, feedback engine. 47 new tests (1019→1066). 7 commits.
