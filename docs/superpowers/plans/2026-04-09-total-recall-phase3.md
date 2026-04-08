# Total Recall — Phase 3: Navigation & Import

**Master:** [total-recall-master.md](2026-04-09-total-recall-master.md)
**Design:** [total-recall-design.md](../specs/2026-04-09-total-recall-design.md)
**Depends on:** Phase 2 COMPLETE
**Components:** #4 Topics + Tunnels, #2 Conversation Import, #10 Dreamer Consolidation, #11 Context Wake-Up
**Status:** COMPLETE

> Phase 3 adds discovery (browse, topics), data ingestion (conversation import),
> intelligence consolidation, and proactive context injection.
> DO NOT START until Phase 2 is 100% complete.

---

## Pre-Flight Checklist

- [ ] 3.0.1 — Verify Phase 2 is COMPLETE in master plan
- [ ] 3.0.2 — Run `npm test` → all pass (including Phase 1+2 tests)
- [ ] 3.0.3 — Create branch if needed: `git checkout -b feat/total-recall-phase3`

---

## Component 4: Navigable Topics + Cross-Project Tunnels

### Schema

- [ ] 3.1.1 — Add migration v13:
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
  CREATE INDEX IF NOT EXISTS idx_ot_topic ON observation_topics(topic_id);
  ```
- [ ] 3.1.2 — Write migration test
- [ ] 3.1.3 — Commit: `feat: topics and observation_topics tables`

### Topic Detection

- [ ] 3.2.1 — Create `src/core/topic-detector.ts` with:
  - `detectTopics(content: string, tags: string[], entities: ExtractedEntity[]): DetectedTopic[]`
  - Merge auto-tagger keywords + entity types + known topic patterns
  - Known topics: auth, database, api, frontend, backend, deployment, testing, security, performance, config, ci-cd, monitoring, documentation
- [ ] 3.2.2 — Wire into pipeline: after entity extraction, detect topics → store in observation_topics
- [ ] 3.2.3 — Write tests (≥6)
- [ ] 3.2.4 — Commit: `feat: topic-detector with auto-classification`

### Browse & List Tools

- [ ] 3.3.1 — Register `browse` MCP tool:
  ```
  { dimension: 'topic'|'person'|'project'|'time', value: string, verbatim?: boolean, limit?: number }
  ```
  Returns observations filtered by dimension, sorted by importance then recency.
- [ ] 3.3.2 — Register `list_topics` MCP tool: returns topics with observation counts
- [ ] 3.3.3 — Register `find_tunnels` MCP tool: finds topics that appear in 2+ projects (via global store)
- [ ] 3.3.4 — Write tests (≥8)
- [ ] 3.3.5 — Commit: `feat: browse, list_topics, find_tunnels MCP tools`

---

## Component 2: Conversation Import Engine

### Format Parsers

- [ ] 3.4.1 — Create `src/core/conversation-parsers/` directory
- [ ] 3.4.2 — Create `types.ts`: `NormalizedMessage = { role: 'human'|'assistant', content: string, timestamp?: number, speaker?: string }`
- [ ] 3.4.3 — Create `claude-code-parser.ts`: parse Claude Code JSONL transcripts
- [ ] 3.4.4 — Create `claude-ai-parser.ts`: parse Claude AI conversation JSON exports
- [ ] 3.4.5 — Create `chatgpt-parser.ts`: parse ChatGPT conversations.json (mapping → message tree traversal)
- [ ] 3.4.6 — Create `slack-parser.ts`: parse Slack channel export JSON
- [ ] 3.4.7 — Create `plaintext-parser.ts`: parse `> human` / assistant transcript format
- [ ] 3.4.8 — Create `auto-detect.ts`: detect format from file content/extension
- [ ] 3.4.9 — Write tests per parser (≥3 each = ≥15 total):
  - Each parser: valid input → correct normalized messages
  - Each parser: empty/malformed input → graceful error
  - Each parser: edge cases (empty messages, system messages, attachments)
- [ ] 3.4.10 — Commit: `feat: 5 conversation format parsers with auto-detection`

### Import Pipeline

- [ ] 3.5.1 — Create `src/core/conversation-import.ts`:
  - `importConversations(path: string, format?: string): ImportResult`
  - Auto-detect format, parse, chunk into exchanges, run through importance classifier + entity extractor
  - Store as observations with `source_type: 'imported'`, `compression_tier: 'verbatim'`
- [ ] 3.5.2 — Register `import_conversations` MCP tool
- [ ] 3.5.3 — Add `import-convos` CLI command: `context-mem import-convos <path> [--format auto]`
- [ ] 3.5.4 — Write integration tests (≥5):
  - Test full import pipeline with sample ChatGPT export
  - Test full import pipeline with sample Claude JSONL
  - Test dedup: re-importing same file doesn't create duplicates
  - Test entities extracted from imported conversations
  - Test importance scores assigned to imported observations
- [ ] 3.5.5 — Commit: `feat: conversation import engine with 5 formats`

---

## Component 10: Memory Consolidation in Dreamer

### New Dreamer Tasks

- [ ] 3.6.1 — Add `consolidateRelated()`: 
  - Find topics with >5 unlinked observations
  - Merge into consolidated knowledge entry
  - Link original observations via relationships
- [ ] 3.6.2 — Add `extractCausalChains()`:
  - Find DECISION → PROBLEM → MILESTONE sequences on same topic
  - Create 'caused-by' relationships in KG
- [ ] 3.6.3 — Add `boostCorroboration()`:
  - Same fact from 3+ sessions → boost confidence/relevance
  - Update relevance_score and access_count
- [ ] 3.6.4 — Wire all 3 into Dreamer.cycle()
- [ ] 3.6.5 — Write tests (≥8):
  - Test consolidation triggers at >5 observations
  - Test consolidated entry created with correct content
  - Test causal chain detection
  - Test causal chain relationships created
  - Test corroboration boost at 3+ sessions
  - Test corroboration doesn't double-boost
  - Test tasks run without error on empty DB
  - Test tasks respect pinned status
- [ ] 3.6.6 — Commit: `feat: dreamer consolidation, causal chains, corroboration boost`

---

## Component 11: Context-Triggered Wake-Up

### UserPromptSubmit Hook

- [ ] 3.7.1 — Create `hooks/user-prompt-hook.js`:
  - Listen on `UserPromptSubmit` event
  - Extract key terms from user message
  - Query knowledge + observations + entities via HTTP bridge
  - Inject top 3 relevant memories (max 300 tokens)
  - Rate limit: max 2 injections/minute, 5-min cooldown per topic
- [ ] 3.7.2 — Add to `init` command: register UserPromptSubmit hook in Claude Code settings
- [ ] 3.7.3 — Upgrade `proactive-inject.js` to be entity-aware:
  - When editing a file, also surface entity relationships (not just file matches)
  - Query: "what entities are connected to this file?" → inject related knowledge
- [ ] 3.7.4 — Write tests (≥4):
  - Test hook extracts terms from user message
  - Test hook queries and injects relevant memories
  - Test rate limiting works
  - Test cooldown prevents duplicate injections
- [ ] 3.7.5 — Commit: `feat: UserPromptSubmit hook for context-triggered memory injection`

---

## Phase 3 Completion

- [ ] 3.8.1 — Run full test suite: `npm test` → ALL pass, 0 failures
- [ ] 3.8.2 — Count new tests: should be ≥40 new tests
- [ ] 3.8.3 — Manual smoke test: browse by topic returns grouped results
- [ ] 3.8.4 — Manual smoke test: import a ChatGPT export, search imported content
- [ ] 3.8.5 — Manual smoke test: UserPromptSubmit hook injects context
- [ ] 3.8.6 — Update master plan: Phase 3 status → COMPLETE, progress → 28/28
- [ ] 3.8.7 — Commit: `feat: total-recall phase 3 complete — navigation, import, consolidation, wake-up`

**Phase 3 Complete: [ ] YES / [ ] NO**
