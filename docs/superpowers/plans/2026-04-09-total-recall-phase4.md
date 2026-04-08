# Total Recall — Phase 4: Killer Features

**Master:** [total-recall-master.md](2026-04-09-total-recall-master.md)
**Design:** [total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Depends on:** Phase 3 COMPLETE
**Components:** #13 Decision Trail, #15 Session Narrative, #14 Regression Fingerprint, #8 Pressure Predictor
**Status:** COMPLETE

> Phase 4 builds the viral, differentiating features.
> DO NOT START until Phase 3 is 100% complete.

---

## Pre-Flight Checklist

- [ ] 4.0.1 — Verify Phase 3 is COMPLETE in master plan
- [ ] 4.0.2 — Run `npm test` → all pass (including Phase 1+2+3 tests)
- [ ] 4.0.3 — Create branch if needed: `git checkout -b feat/total-recall-phase4`

---

## Component 13: Decision Trail / `why` Command

### Schema

- [ ] 4.1.1 — Add migration v14:
  ```sql
  CREATE TABLE IF NOT EXISTS decision_trails (
    id TEXT PRIMARY KEY,
    decision_summary TEXT NOT NULL,
    file_path TEXT,
    topic TEXT,
    trail TEXT NOT NULL,  -- JSON array of evidence chain
    session_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dt_file ON decision_trails(file_path);
  CREATE INDEX IF NOT EXISTS idx_dt_topic ON decision_trails(topic);
  ```
- [ ] 4.1.2 — Commit: `feat: decision_trails table`

### Decision Trail Builder

- [ ] 4.2.1 — Create `src/core/decision-trail.ts` with:
  - `buildTrail(query: string): DecisionTrail | null`
  - `DecisionTrail = { decision, date, evidence_chain, alternatives_considered, related_entities, confidence }`
  - Evidence types: `file_read | error | search | knowledge | decision | fix`
- [ ] 4.2.2 — Trail reconstruction algorithm:
  1. Find decision events/knowledge matching query (file path or topic keywords)
  2. Walk backward in session events: what file_reads, errors, searches preceded the decision?
  3. Walk entity graph: what entities are connected to the decision?
  4. Check for alternative decisions that were superseded (temporal facts)
  5. Assemble into chronological evidence chain
- [ ] 4.2.3 — Register `explain_decision` MCP tool
- [ ] 4.2.4 — Add CLI command: `context-mem why <file-or-topic> [was_changed|was_created]`
- [ ] 4.2.5 — Write tests (≥8):
  - Test trail finds related events for a decision
  - Test chronological ordering of evidence
  - Test entity extraction from trail
  - Test superseded alternatives detected
  - Test query by file path
  - Test query by topic
  - Test no decision found returns null
  - Test multiple decisions on same file returns most recent
- [ ] 4.2.6 — Commit: `feat: decision trail builder with evidence chain reconstruction`

---

## Component 15: Session Narrative / `story` Command

### Narrative Generator

- [ ] 4.3.1 — Create `src/core/narrative-generator.ts` with:
  - `generateNarrative(opts: NarrativeOpts): string`
  - `NarrativeOpts = { sessionId?, timeRange?, topic?, format: 'pr'|'standup'|'adr'|'onboarding' }`
- [ ] 4.3.2 — Data assembly: gather events + observations + knowledge + decisions + entities for scope
- [ ] 4.3.3 — Template-based rendering (deterministic, zero-LLM):
  - `pr`: "## Summary\n{changes}\n## Decisions\n{decisions}\n## Test Plan\n{tests}"
  - `standup`: "**Done:** {completed}\n**Next:** {todos}\n**Blockers:** {blockers}"
  - `adr`: "# {title}\n## Context\n{context}\n## Decision\n{decision}\n## Consequences\n{consequences}"
  - `onboarding`: "# {project}\n## Architecture\n{patterns}\n## Key Decisions\n{decisions}\n## Team\n{people}"
- [ ] 4.3.4 — LLM-enhanced path: if ai_curation enabled, send structured data to LLM for polished prose
- [ ] 4.3.5 — Register `generate_story` MCP tool
- [ ] 4.3.6 — Add CLI command: `context-mem story [--session ID] [--range DATE..DATE] [--topic TOPIC] [--format pr]`
- [ ] 4.3.7 — Write tests (≥8):
  - Test PR format with sample session data
  - Test standup format
  - Test ADR format
  - Test onboarding format
  - Test time range filtering
  - Test topic filtering
  - Test empty session returns minimal output
  - Test deterministic output is consistent
- [ ] 4.3.8 — Commit: `feat: session narrative generator with 4 output formats`

---

## Component 14: Regression Fingerprinting

### Schema

- [ ] 4.4.1 — Add to migration v14:
  ```sql
  CREATE TABLE IF NOT EXISTS working_fingerprints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,  -- JSON snapshot
    trigger_event TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wf_session ON working_fingerprints(session_id);
  ```
- [ ] 4.4.2 — Commit: `feat: working_fingerprints table`

### Fingerprint Engine

- [ ] 4.5.1 — Create `src/core/regression-fingerprint.ts` with:
  - `captureFingerprint(sessionId: string, trigger: string): Fingerprint`
  - `diffFingerprints(current: Fingerprint, baseline: Fingerprint): RegressionDiff`
  - `Fingerprint = { knowledge_ids, recent_files, error_patterns_absent, entity_state, timestamp }`
  - `RegressionDiff = { added_errors, changed_knowledge, modified_files, new_entities, likely_causes }`
- [ ] 4.5.2 — Auto-capture: on `task_complete` with priority 1 → save fingerprint
- [ ] 4.5.3 — Auto-diff: on new `error` event → find last fingerprint → compute diff → inject via proactive-inject
- [ ] 4.5.4 — Write tests (≥6):
  - Test fingerprint captures correct state
  - Test diff detects added errors
  - Test diff detects changed knowledge
  - Test diff detects new files
  - Test auto-capture on task_complete
  - Test auto-diff on error event
- [ ] 4.5.5 — Commit: `feat: regression fingerprinting with auto-capture and diff`

---

## Component 8: Memory Pressure Predictor

### Predictor

- [ ] 4.6.1 — Create `src/core/pressure-predictor.ts` with:
  - `predictLoss(limit?: number): PressureEntry[]`
  - `PressureEntry = { id, title, type, risk_score, reasons, age_days, access_count, importance_score }`
  - Risk score = inverse of (importance * recency * access_frequency * usefulness)
- [ ] 4.6.2 — Register `predict_loss` MCP tool: returns top N entries at highest risk of loss
- [ ] 4.6.3 — Users can respond by pinning entries: `observe` with `pinned: true` or via knowledge update
- [ ] 4.6.4 — Write tests (≥4):
  - Test low-importance old entries rank highest risk
  - Test pinned entries never appear in predictions
  - Test high-access entries rank lower risk
  - Test recently useful entries rank lower risk
- [ ] 4.6.5 — Commit: `feat: memory pressure predictor with risk scoring`

---

## Phase 4 Completion

- [ ] 4.7.1 — Run full test suite: `npm test` → ALL pass, 0 failures
- [ ] 4.7.2 — Count new tests: should be ≥30 new tests
- [ ] 4.7.3 — Manual smoke test: `context-mem why src/core/pipeline.ts was_changed`
- [ ] 4.7.4 — Manual smoke test: `context-mem story --format pr`
- [ ] 4.7.5 — Manual smoke test: `predict_loss` tool returns ranked entries
- [ ] 4.7.6 — Update master plan: Phase 4 status → COMPLETE, progress → 24/24
- [ ] 4.7.7 — Commit: `feat: total-recall phase 4 complete — decision trail, story, regression, pressure`

**Phase 4 Complete: [ ] YES / [ ] NO**
