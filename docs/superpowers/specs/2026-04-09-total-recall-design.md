# Total Recall — Design Specification

**Version:** context-mem v3.0
**Date:** 2026-04-09
**Status:** APPROVED

## Problem Statement

AI coding assistants forget everything between sessions. Current context-mem (v2.6) optimizes real-time context windows (99% token savings, 14 summarizers) but sacrifices long-term fidelity — compressed summaries lose exact quotes, decisions, and attribution. Competitor MemPalace stores verbatim text for long-term recall but wastes tokens (0% compression) and lacks our search sophistication, budget management, and content intelligence.

**Goal:** Combine both strengths — real-time optimization AND long-term institutional memory — plus original features neither system has.

## Architecture Overview

### Dual-Mode Memory

```
                    ┌──────────────────────────────────┐
                    │         Incoming Content          │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │     Importance Classification     │ ← NEW (Component 7)
                    │  decision/milestone/pivot/routine │
                    │  + significance flags (ORIGIN,    │
                    │    CORE, PIVOT, GENESIS)          │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │      Entity Extraction            │ ← NEW (Component 3)
                    │  people, technologies, projects   │
                    │  + alias resolution               │
                    └──────────────┬───────────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
         ┌────────▼──────┐ ┌──────▼──────┐ ┌───────▼──────┐
         │   Verbatim    │ │  Compressed │ │  Knowledge   │
         │   Archive     │ │  Summary    │ │  Graph       │
         │  (content)    │ │  (summary)  │ │  (entities + │
         │  FTS indexed  │ │  existing   │ │  relationships)
         └───────────────┘ └─────────────┘ └──────────────┘
                  │                │                │
                  └────────────────┼────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │     Adaptive Compression          │ ← NEW (Component 9)
                    │  Day 0-7:  VERBATIM (0%)         │
                    │  Day 7-30: LIGHT (~70%)           │
                    │  Day 30-90: MEDIUM (~95%)         │
                    │  Day 90+:  DISTILLED (~99%)       │
                    │  (pinned entries never compress)   │
                    └──────────────────────────────────┘
```

## Components

### Phase 1: Foundation (P0)

#### Component 7: Importance Classification on Ingest

**What:** Classify every observation at store-time with importance_score (0.0-1.0) and significance flags.

**Classification signals (zero-LLM):**
- Observation type weight: error=0.8, decision=0.9, code=0.5, log=0.3
- Keyword signals: "never"/"always"/"critical"/"breaking"/"vulnerability" → +0.2
- Entity overlap: mentions known entities → +0.1
- Content length: very long detailed content → +0.1
- Resolution presence: "fixed by"/"solved"/"resolved" → +0.15

**Significance flags** (stored as JSON array in metadata):
- `DECISION` — a choice was made between alternatives
- `ORIGIN` — this started something new (project, feature, approach)
- `PIVOT` — direction changed from a previous decision
- `CORE` — fundamental rule/belief/constraint
- `MILESTONE` — something was completed/shipped
- `PROBLEM` — a bug, issue, or blocker was identified

**Schema change:**
```sql
ALTER TABLE observations ADD COLUMN importance_score REAL DEFAULT 0.5;
ALTER TABLE observations ADD COLUMN pinned INTEGER DEFAULT 0;
ALTER TABLE observations ADD COLUMN compression_tier TEXT DEFAULT 'verbatim';
```

**Integration point:** pipeline.ts, between step 2 (dedup) and step 3 (LLM summarizer). New file: `src/core/importance-classifier.ts`.

#### Component 1: Verbatim Recall Mode

**What:** Surface original `content` field (already stored!) when verbatim recall is requested.

**Changes:**
- `search` tool: add `verbatim: boolean` parameter. When true, return `content` instead of `summary`.
- `recall` new tool: dedicated verbatim search with richer response (content + attribution + date + entities).
- Add FTS5 index on `content` field for full-text search of original text.
- `timeline` tool: add `verbatim: boolean` parameter.

**Schema change:**
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS obs_content_fts USING fts5(
  content,
  content=observations,
  content_rowid=rowid,
  tokenize='porter unicode61'
);
```

#### Component 9: Adaptive Compression Over Time

**What:** Dreamer progressively compresses old observations through tiers.

**Tiers:**
| Tier | Age | Compression | What's kept |
|------|-----|------------|-------------|
| `verbatim` | 0-7 days | 0% | Original content intact |
| `light` | 7-30 days | ~70% | Key sentences, decisions, quotes |
| `medium` | 30-90 days | ~95% | Current summarizer output |
| `distilled` | 90+ days | ~99% | Facts only, no narrative |

**Rules:**
- `pinned=1` entries NEVER compress (stay verbatim forever)
- `importance_score >= 0.8` entries skip one tier (compress slower)
- `DECISION` and `MILESTONE` flagged entries auto-pin

**Dreamer task:** `progressiveCompress()` — runs each cycle, checks `compression_tier` vs `indexed_at` age, applies appropriate compression, updates tier.

### Phase 2: Core Intelligence (P1)

#### Component 6: Wake-Up Primer

**What:** Auto-generated, importance-scored, token-budgeted context injected at session start.

**Structure:**
- **L0 Profile** (~100 tokens): Project profile (already exists via `update_profile`)
- **L1 Critical** (~300 tokens): Top 10 knowledge entries by `importance_score * recency_weight * access_count_weight`
- **L2 Recent** (~200 tokens): Last session's key decisions and open TODOs from snapshot
- **L3 Entities** (~100 tokens): Top 5 most-active entities with recent relationship summary

**Total budget:** ~700 tokens, configurable in `.context-mem.json`.

**Implementation:** Upgrade `session-start-hook.js` to call a new `wake_up` MCP tool that assembles the ranked payload.

#### Component 3: Entity Intelligence + Alias Resolution

**What:** Auto-detect entities from observation text at store-time.

**Entity types:** person, technology, project, component, api, pattern, file
**Detection methods:**
- CamelCase tokens → component/class
- ALL_CAPS → constant/config
- path/segments → file
- Known technology list → technology (React, Postgres, Redis, etc.)
- Capitalized names in conversational context → person
- Optional LLM enhancement for disambiguation

**Alias resolution:**
- Canonical entity table with aliases: `{canonical: "React", aliases: ["React.js", "ReactJS", "react"]}`
- On ingest: normalize entity names to canonical form
- `entities` table gets new `canonical_id` column for alias grouping

**Auto-extraction pipeline:** After importance classification, extract entities → check alias table → create/update entities → create relationships to the observation.

#### Component 5: Temporal Facts

**What:** Knowledge entries have explicit validity windows.

**Schema change:**
```sql
ALTER TABLE knowledge ADD COLUMN valid_from INTEGER;
ALTER TABLE knowledge ADD COLUMN valid_to INTEGER;
ALTER TABLE knowledge ADD COLUMN superseded_by TEXT;
```

**Behavior:**
- `save_knowledge` accepts optional `valid_from` (defaults to now)
- When new knowledge contradicts existing (detected by contradiction engine): set `valid_to` on old entry, set `superseded_by` pointing to new entry
- `temporal_query` new tool: "what was true about X at time T?" — filters by `valid_from <= T AND (valid_to IS NULL OR valid_to > T)`
- `search_knowledge` respects temporal window by default (only returns currently-valid entries)

#### Component 12: Memory Usefulness Feedback

**What:** Track whether recalled memories led to action.

**Schema change:**
```sql
ALTER TABLE observations ADD COLUMN last_useful_at INTEGER;
ALTER TABLE knowledge ADD COLUMN last_useful_at INTEGER;
```

**Mechanism:**
- After `search` event, track the result IDs
- Walk subsequent events in session: if `file_modify` touches a file mentioned in results → mark as useful
- Session-end hook: batch-update `last_useful_at` and boost `relevance_score` for useful entries
- Dreamer: entries never marked useful after 5+ retrievals → decay faster

### Phase 3: Navigation & Import (P2)

#### Component 4: Navigable Topics + Cross-Project Tunnels

**What:** Auto-generated topic taxonomy + browse-by-topic/person/project.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  observation_count INTEGER DEFAULT 0,
  last_seen INTEGER,
  FOREIGN KEY (parent_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS observation_topics (
  observation_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (observation_id, topic_id)
);
```

**Topic detection:** Keyword clustering from auto-tagger output. Group observations by dominant keywords → create topic entries.

**Cross-project tunnels:** When same topic name exists in global store from 2+ projects → it's a tunnel. New tool `find_tunnels` returns bridging topics.

**New MCP tools:** `browse` (filter by topic/person/project/time), `list_topics`, `list_people`, `find_tunnels`.

#### Component 2: Conversation Import Engine

**What:** Parse external conversation exports → observations.

**Supported formats:**
1. Claude Code JSONL (`.jsonl` — message objects)
2. Claude AI JSON (conversation export with `uuid`, `chat_messages`)
3. ChatGPT JSON (conversations array with `mapping` → message tree)
4. Slack JSON (channel export with `messages` array, `user` field)
5. Cursor session logs
6. Plain text transcripts (`> human` / `assistant` format)

**Pipeline:** Parse → normalize to `{role, content, timestamp}[]` → chunk into exchanges → run through importance classifier → store as observations with `source_type: 'imported'`.

**New MCP tool:** `import_conversations` (path, format hint)
**New CLI command:** `context-mem import-convos <path> [--format auto|chatgpt|claude|slack]`

#### Component 10: Memory Consolidation in Dreamer

**What:** 4 new Dreamer tasks.

| Task | What | Trigger |
|------|------|---------|
| `consolidateRelated()` | 5+ observations on same topic → 1 consolidated knowledge entry | topic has >5 unlinked observations |
| `extractCausalChains()` | Link decision → consequence → fix | `DECISION` + subsequent `PROBLEM` + `MILESTONE` sequence |
| `distillEpisodic()` | Old verbatim → compressed tier | Part of adaptive compression |
| `boostCorroboration()` | Same fact from 3+ sources → confidence boost | Cross-session pattern detection |

#### Component 11: Context-Triggered Wake-Up

**What:** `UserPromptSubmit` hook intercepts every user message, runs NL query, injects relevant memory.

**Flow:**
1. User types message
2. Hook extracts key terms
3. Queries knowledge + recent observations + entity graph
4. Injects top 3 relevant memories (max 300 tokens) as context
5. Rate limited: max 2 injections/minute, 5-minute cooldown per topic

**New hook:** `user-prompt-hook.js` on `UserPromptSubmit` event.

### Phase 4: Killer Features (P3)

#### Component 13: Decision Trail / `why` Command

**What:** Reconstruct the evidence chain behind any code change.

**Query:** `context-mem why <file-or-topic> [was_changed|was_created|was_deleted]`
**MCP tool:** `explain_decision` — returns structured trail.

**Trail structure:**
```json
{
  "decision": "Switch to httpOnly + SameSite=Strict cookies",
  "date": "2026-03-15",
  "evidence_chain": [
    {"type": "error", "content": "JWT refresh rotation failing", "session": 12},
    {"type": "file_read", "file": "src/auth/token.ts", "session": 12},
    {"type": "knowledge", "entry": "Cookie domain must match exactly", "id": "k_47"},
    {"type": "decision", "content": "Switch from JWT to httpOnly cookies", "session": 12}
  ],
  "alternatives_considered": ["Refresh token rotation fix", "Shorter JWT expiry"],
  "related_entities": ["JWT", "cookies", "auth", "security"]
}
```

**Implementation:** `DecisionTrailBuilder` walks the event + observation + entity graph backward from a decision event.

#### Component 15: Session Narrative / `story` Command

**What:** Generate human-readable narrative from session data.

**CLI:** `context-mem story [--session ID] [--range DATE..DATE] [--topic TOPIC] [--format pr|standup|adr|onboarding]`
**MCP tool:** `generate_story`

**Output formats:**
- `pr` — Pull request description (summary + changes + test plan)
- `standup` — Daily standup update (what done, what next, blockers)
- `adr` — Architecture Decision Record (context, decision, consequences)
- `onboarding` — New team member guide (project narrative, key decisions, important patterns)

**Two paths:**
- LLM enabled: send structured data to LLM for polished prose
- LLM disabled: deterministic template-based rendering (zero cost)

#### Component 14: Regression Fingerprinting

**What:** Capture "working state fingerprints" at success events; diff against current state when errors appear.

**Fingerprint:** Snapshot of active knowledge IDs, recent file states, absent error patterns, entity state.
**Trigger:** `task_complete` with priority 1 → save fingerprint.
**On error:** Auto-diff against last fingerprint → inject delta as proactive context.

#### Component 8: Memory Pressure Predictor

**What:** Score entries by loss risk under context pressure.

**MCP tool:** `predict_loss` — returns entries most at risk of being forgotten (low importance, low access, approaching archive threshold).
**Use case:** User can pin/protect important entries before they decay.

## New MCP Tools Summary (32 → ~44)

| Tool | Component | Description |
|------|-----------|-------------|
| `recall` | 1 | Verbatim recall with attribution |
| `import_conversations` | 2 | Parse external chat exports |
| `entity_detect` | 3 | Extract entities from text |
| `list_people` | 3 | List detected people entities |
| `browse` | 4 | Navigate by topic/person/project |
| `list_topics` | 4 | Auto-detected topic list |
| `find_tunnels` | 4 | Cross-project concept bridges |
| `temporal_query` | 5 | "What was true at time T?" |
| `wake_up` | 6 | Generate scored session primer |
| `predict_loss` | 8 | Memory pressure prediction |
| `explain_decision` | 13 | Decision trail reconstruction |
| `generate_story` | 15 | Session narrative export |

## Schema Changes Summary

**observations table:**
- `+importance_score REAL DEFAULT 0.5`
- `+pinned INTEGER DEFAULT 0`
- `+compression_tier TEXT DEFAULT 'verbatim'`
- `+last_useful_at INTEGER`

**knowledge table:**
- `+valid_from INTEGER`
- `+valid_to INTEGER`
- `+superseded_by TEXT`
- `+last_useful_at INTEGER`

**entities table:**
- `+canonical_id TEXT` (alias grouping)
- `+aliases TEXT` (JSON array)

**New tables:**
- `topics` (id, name, parent_id, observation_count, last_seen)
- `observation_topics` (observation_id, topic_id, confidence)
- `working_fingerprints` (id, session_id, snapshot JSON, created_at)
- `decision_trails` (id, decision_event_id, trail JSON, created_at)

**New FTS index:**
- `obs_content_fts` on observations.content

## Testing Strategy

Every component must have:
1. Unit tests for core logic (classifier, parser, scorer)
2. Integration tests for MCP tool end-to-end
3. Migration tests (upgrade from v2.6 schema)
4. Regression tests (existing 943 tests must pass)

## Success Criteria

- All 943 existing tests still pass
- Each component has ≥10 new tests
- Verbatim recall returns exact original text
- Conversation import handles all 6 formats
- Wake-up primer stays within token budget
- Adaptive compression reduces storage by 60% for 90+ day data
- `why` command reconstructs decision trail for real sessions
- `story` command generates readable markdown
