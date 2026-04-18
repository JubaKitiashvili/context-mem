# Changelog

All notable changes to context-mem are documented here.

## [4.0.0] — 2026-04-18 — Cognition

The LLM Wiki release. Reference implementation of Andrej Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Dual-pillar positioning (Memory + Compression). Obsidian plugin v1. Context Protocol v1 RFC. Eight IDE integration guides. Refactored tool surface.

### Added — Memory Pillar

- **Synthesis pages** — `src/core/synthesis.ts`. Entity and topic pages auto-update incrementally. LLM-gated via `ai_curation.enabled` with deterministic template fallback when no provider is configured. Debounced scheduler, min-observations guard (default 3), privacy filter, fail-open. Adds `synthesize_page` prompt template + `LLMService.synthesizePage()` helper + new error category `synthesis`.
- **Answer-as-Page** — `ask({save_as_page: true})` and `search({file_as: 'knowledge'})` persist synthesized answers into `vault/answers/*.md` with source citations AND as knowledge entries. Extends `KnowledgeCategory` with `'answer' | 'summary'`. Adds `VaultSync.saveAnswerPage` + `renderAnswerPage` template.
- **Obsidian plugin v1** — new top-level `obsidian-plugin/` directory. Sidebar pane with bridge status + quick observe + recent log tail. Commands: observe selected text, observe this file, open dashboard, refresh sidebar. Status bar indicator. Settings tab with bridge host/port and auto-detect-vault. Standalone build (`cd obsidian-plugin && npm install && npm run build`).

### Added — Compression Pillar

- **15th summarizer — Python traceback** — `src/plugins/summarizers/python-traceback-summarizer.ts`. Extracts exception type + message + topmost user-code frame, skipping `site-packages`/`venv` library frames. Priority 250 (above generic ErrorSummarizer).
- **Dashboard compression analytics** — new `/compression` page. Overall savings card, per-content-type bar chart, savings-ratio histogram. Backend: `getCompressionAnalytics(db)` in `dashboard/server/queries.js` + `/api/compression-analytics` endpoint.

### Added — Platform

- **Context Protocol v1 (Draft RFC)** — `docs/context-protocol-v1.md`. Formal 3-layer interop spec (Vault filesystem / MCP tool surface / HTTP bridge). Defines resource model, operations, identity + addressing, compliance levels (Core / Extended / Full). Released for community review.
- **8 IDE integration guides** — `docs/integrations/{cursor,windsurf,vscode,cline,roo-code,aider,continue,jetbrains-ai}.md` + `README.md` landing page. Each config verified from canonical sources (Cursor docs, Windsurf docs, Cline README, Roo Code docs, Continue.dev docs, VS Code docs, JetBrains MCP proxy). Aider uses the HTTP bridge (no MCP).
- **`GET /` and `GET /api` service info** on HTTP bridge (port 51894) — returns endpoints list + dashboard URL + version. `GET /favicon.ico` returns 204 (silences browser noise). 404 responses include a hint.

### Changed — Refactor

- **`src/mcp-server/tools.ts` split** (2576 LOC god file → 8 domain modules + barrel). New structure: `tools/{shared,core,search,knowledge,graph,agent,narrative,session,index}.ts`. `tools.ts` is now a 1-line re-export preserving external imports. No behavior change.
- **Unified `search({query, scope, mode, filters, cursor, limit})` MCP tool** supersedes 7 legacy retrieval tools. Legacy tools (`search_knowledge`, `search_content`, `recall`, `browse`, `global_search`, `ask`, and legacy-observation-scoped `search`) remain callable and return results unchanged but now include `_meta.deprecated: true` + `replacement_params` for forward guidance. Removal planned in v5.0.
- **`dashboard/server.js` split** (7890 LOC → 6 modules under `dashboard/server/`). `index.js` + `http.js` + `api.js` + `html-templates.js` + `queries.js` + 20-line entry. No framework change — Preact/Vite rewrite deferred to v4.2.
- **README repositioned** — `README.md` promoted from `docs/README-v4-draft.md` with dual-pillar framing. Old README archived at `docs/README-v3-archive.md`.

### Changed — Platform

- Version strings bumped to 4.0.0 across `package.json`, `server.json` (×2), `marketplace.json`, `src/mcp-server/server.ts`, `src/core/http-bridge.ts`, `package-lock.json`.
- Tests: 1182 → 1253 (+71 new): synthesis (9), answer-as-page (23), unified search (27), python-traceback (8), http-bridge extras (4).

### Notes

- `vault.enabled` is now default behavior when configured. Synthesis is opt-in via `vault.synthesis` (default true when vault enabled, off otherwise).
- Benchmark sweep (synonym migration post-deltas, E2E QA baseline, full 4-suite re-run) is scheduled to run alongside the v4.0.0 tag. Results published to `benchmarks/results/v4-release-2026-04-18.json` and the migration doc's delta table.
- The v1 Obsidian plugin is not yet submitted to the Obsidian community plugin store — manual install via `main.js` copy for this release.

### Credits

- Andrej Karpathy — [LLM Wiki gist (2026-04-04)](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for the paradigm framing.
- @AlexisOlson — benchmark-methodology review (issue #6), carried forward: E2E QA harness + synonym migration.
- Vannevar Bush — "As We May Think" (1945), referenced in the schema spec + Context Protocol.

### What's next

**v4.1 "Network" (Month 3):** post-release polish, community feedback from Context Protocol RFC, HNSW vector index, bulk-ingest endpoint, Obsidian plugin community-store submission.

## [3.4.0] — 2026-04-18 — LLM Wiki Preview

### Added
- **Markdown vault layer** — SQLite is authoritative; the vault is derived. `VaultSync` auto-mirrors observations, entities, topics, sessions, and knowledge into `.context-mem/vault/*.md`. Opt-in via `vault.enabled` config (default off in v3.4; default on in v4.0).
- **Auto-generated `index.md`** — counts table + Top Entities (by `updated_at`, enriched with date) + Recent Topics (with observation counts) + Recent Knowledge. Regenerated on demand; preserves user-created sibling files.
- **Auto-generated `log.md`** — append-only chronological event log, grep-parseable: `## [YYYY-MM-DD HH:MM] event | summary`. Pipeline `observe()` emits an `ingest` entry after each INSERT.
- **Entity / topic / session / knowledge pages** — one markdown page per row, linked via `[[entities/<safeName>]]` wikilinks. `safeName` neutralizes `/\:`, control chars, `..` traversal, and collapses empty input to `_unnamed`.
- **Path-traversal guard** — `withinVault()` resolves the absolute path before every write and refuses anything outside the vault root.
- **Privacy filter on vault writes** — `refreshSession` and `refreshTopic` exclude `privacy_level='private'` rows from markdown output; `pipeline.observe()` skips `logEvent` emission for private observations and masks summaries for redacted ones. Private content never reaches disk even with `vault.enabled=true`.
- **Async `logEvent`** — vault log appends use `fs.promises.appendFile` and fire-and-forget in the pipeline, so the `observe()` hot path is never blocked on filesystem I/O.
- **CLAUDE.md schema spec v1** — `docs/llm-wiki-schema.md` formalizes the convention (directory layout, page types, linking rules, ingest/query/lint operations, agent workflows, interop contract). Pattern credit: Andrej Karpathy's LLM Wiki gist (2026-04-04).
- **README v4 draft** — `docs/README-v4-draft.md` repositions context-mem as dual-pillar (Memory + Compression). Promoted to `README.md` at v4.0.
- **E2E QA benchmark** — `npm run bench:e2e-qa` retrieves top-k then runs Haiku-answer + Haiku-judge to measure end-to-end QA accuracy, not just retrieval recall. Addresses point 1 of issue #6.
- **Benchmark methodology doc** — `docs/benchmarks/methodology.md` discloses granularity, scoring rules, and enriched-ingestion practices previously buried in `<details>` blocks. Addresses points 2 + 3 of issue #6.

### Changed
- **Synonym migration** — 38 entries in `benchmarks/lib/expansions.js` audited: 28 moved to core `src/plugins/search/query-builder.ts` as new keys (family terms, workplace vocab, object/subject nouns), 3 merged into existing core keys (`education`, `workplace`, `hobby`), 7 deleted as benchmark-fitted (`cookie`, `violin`, `race`, `martial`, `supervillain`, `counseling`, `digestive`). `sport` moved without its `collectible` value. Migration audit at `docs/benchmarks/synonym-migration-2026-04.md`. Addresses point 4 of issue #6.
- MCP server version string → 3.4.0.
- Tests: 1166 → 1182 (+16 new: 10 vault unit tests, 3 vault lifecycle + template tests, 3 vault privacy + safeName dot-only regression tests).

### Notes
- v3.4.0 is a flag-plant preview release: `vault.enabled` is opt-in (default off). The synonym-migration benchmark re-run is scheduled for v4.0.0 "Cognition" alongside the full benchmark sweep. See `docs/benchmarks/synonym-migration-2026-04.md` for the pending-deltas table.

### Credits
- Andrej Karpathy — [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for the paradigm framing.
- @AlexisOlson — substantive benchmark-methodology review in [issue #6](https://github.com/JubaKitiashvili/context-mem/issues/6).

### What's next
v4.0.0 "Cognition" — full LLM Wiki release — targets 2026-05-22. Synthesis pages, Obsidian plugin, 8 IDE integrations, Context Protocol v1 RFC, compression polish.

## [3.3.0] — 2026-04-17 — Foundations

### Added
- **GitHub Actions CI** — test + typecheck + bench:quick on Node 18/20/22; weekly full benchmark sweep.
- **Structured error log** — migration v18 adds `error_log` table capturing internal subsystem failures with throttled dedup, 7-day retention, 10k-row cap. Composite `(message_hash, category)` index serves the dedup throttle lookup.
- **`ErrorLogger` core class** — synchronous <1ms log path, async INSERT via `setImmediate`, category-tagged, `static instance()` factory with WeakMap-backed registry preventing duplicate loggers per storage.
- **`diagnostics` MCP tool** — query internal error log by severity, category, time range. Summary (grouped by category+message+severity) or list mode. Tool count: 44 → 45.
- **Dashboard Diagnostics page** — new `/diagnostics` route + `/api/diagnostics` endpoint with severity/since filters. Added to nav across all pages.

### Fixed
- **Flaky `context-mem-hook` E2E test** — hook now honors both `CONTEXT_MEM_API_PORT` (canonical) and `CONTEXT_MEM_PORT` (alias) env vars. Test aligned to canonical name. Added 10-run stability sweep.

### Changed
- 12 high-value silent catch sites now log to `error_log` while retaining fail-open behavior (pipeline × 8, dreamer × 1, knowledge-graph × 1, http-bridge × 2). Existing "non-critical" comments preserved alongside log calls.
- Pipeline `warn()` calls forward the err message as context (not just a static string) for better operational insight.
- Migration v18 timestamp column CHECK constraint prevents accidental seconds-epoch writes (enforces millisecond precision).
- Tests: 1143 → 1166 (+23 new tests: 7 migration, 8 ErrorLogger, 6 diagnostics MCP, 1 integration, 1 hook stability).

### Benchmarks
- No regressions — retrieval paths unchanged from v3.2.0. LongMemEval R@5 97.8% pure local / 100% with Haiku judge, LoCoMo 98.1%, MemBench 98.0%, ConvoMem 97.7%.

## [3.2.0] — 2026-04-15 — Perfect Recall

### Added
- **LLM Judge Reranker** — optional Claude Haiku-based semantic reranker. Scores top-N candidates 0-10 based on relevance, blends with retrieval score (50/50 default). Activates when `ai_curation.enabled` is true. Achieves **100% R@5 on LongMemEval (500/500)**.
- **Temporal Resolver** — deterministic date parsing for relative time expressions ("N days ago", "last Saturday", "last week", "a couple of days ago"). Pure regex, zero LLM cost. 12 unit tests.
- **Per-Prompt Memory Injection** — `UserPromptSubmit` hook now active (was dead code). Searches knowledge + observations on every user message. Rate-limited: max 2/minute, 5-min topic cooldown.
- **BM25 Strategy 7b** — individual synonym search catches documents where the synonym appears but the original abstract term doesn't (e.g., "siblings" query finds "brother").
- **Synonym Expansion** — entertainment (show/movie → comedy, special, stand-up), activities (activity → routine, schedule), evening, plural handling (siblings).

### Fixed
- **CRITICAL: Session chain continuity** — `created_at` was stored as ISO string but parsed as integer, producing NaN. Every session treated as fresh. Now stores unixepoch seconds.
- **CRITICAL: `promote_knowledge` crash** — `require('node:path')` in ESM context threw ReferenceError at runtime. Replaced with static import.
- **CRITICAL: Migration 17 FTS trigger** — referenced non-existent `type` column in `obs_fts`. Fixed to match original FTS schema.
- **Statement cache leak** — `exec()` bypassed prepared statement cache, leaking memory in long sessions.
- **BM25 equal-score normalization** — when all results had identical BM25 scores, they normalized to 0.0 instead of 1.0.
- **Fusion weight negative** — edge case where recency/relevance adjustments could produce negative weights, inverting rankings.
- **FTS trigger on embedding UPDATE** — every embedding write triggered unnecessary FTS rebuild. Now only fires on summary/content/type changes.
- **N+1 query in search_knowledge** — 200 individual SELECTs replaced with single IN() query.
- **Dreamer full table scan** — `progressiveCompress` loaded ALL observations every 5 minutes. Now LIMIT 500 + index.
- **Dreamer boost cap** — early-exit at 3.0 vs SQL cap at 5.0. Aligned to 5.0.
- **Precompact hook SQLITE_BUSY** — added busy_timeout=3000ms for concurrent access safety.
- **Proactive inject LIKE wildcards** — file paths with `_` or `%` caused incorrect matching.
- **Session-start update check** — 6s timeout reduced to 2s to avoid blocking session start.
- **Stats field misname** — `read_tokens` renamed to `stored_tokens` (correct semantics).
- **stdin portability** — user-prompt-hook reads fd 0 instead of `/dev/stdin` for Windows compatibility.

### Changed
- Migration v17: adds `importance_score` index, `pinned+importance_score` composite index
- LLM judge prompt: balanced for both direct-match and indirect-preference queries
- Default LLM judge weights: 50% retrieval + 50% LLM

### Benchmarks
- **LongMemEval R@5: 100.0% (500/500)** with optional Haiku reranker (~$1/500 queries)
- LongMemEval R@5: 97.8% | LoCoMo: 98.1% | MemBench: 98.0% | ConvoMem: 97.7% (pure local)
- 17 bugs fixed, 0 benchmark regressions
- Tests: 1130 → 1135

## [3.1.0] — 2026-04-10 — Search Architecture Refactor

### Changed
- **Search Architecture Refactor** — 5-phase cleanup: dead code removal, synonym split (benchmark-specific vs core), single reranker consolidation in fusion layer, BM25/trigram score normalization to 0–1 range, adapter alignment with core architecture.
- **Hybrid Parallel Retrieval** — BM25 and vector search now run independently in parallel, then fuse results via intent-adaptive weights. Replaces the previous cascade approach.
- **Embedding Model Upgrade** — nomic-embed-text-v1.5 (768-dim) replaces the previous 384-dim model. Memory-efficient vector reranking: BM25 top-30 → embed → rerank.
- **Search Weight Defaults** — rebalanced to reflect hybrid architecture: bm25 0.45, trigram 0.15, levenshtein 0.05, vector 0.35 (was 0.50/0.30/0.15/0.05).
- **BM25 4-Strategy Engine** — AND-mode (weight 2.0), entity-focused (1.8), sanitized FTS5 (1.5), OR-mode with expansion (1.0). IDF-weighted content reranking.
- 14 new tests (1116 → 1130)

### Benchmarks
- LongMemEval R@5: 98.0% | LoCoMo: 98.2% | MemBench: 98.0% | ConvoMem: 97.7%
- All scores without LLM reranking — pure local retrieval

## [3.0.0] — 2026-04-09 — Total Recall

### Added
- **Total Recall** — dual-mode AI memory: real-time optimization AND long-term institutional memory across 15 components.
- **Importance Classification** — every observation scored 0.0–1.0 at ingest with 6 significance flags (DECISION, ORIGIN, PIVOT, CORE, MILESTONE, PROBLEM). Auto-pin for decisions and milestones.
- **Verbatim Recall** — new `recall` tool surfaces original content (not summaries) via dedicated content FTS5 index. `search` and `timeline` gain `verbatim` parameter.
- **Adaptive Compression** — 4-tier progressive compression (verbatim → light → medium → distilled) based on observation age. Pinned entries never compress. High-importance entries compress slower.
- **Entity Intelligence** — auto-detect technologies, people, file paths, CamelCase components, ALL_CAPS constants with 100+ technology alias resolution. Pipeline-integrated.
- **Temporal Facts** — knowledge entries have `valid_from`/`valid_to` validity windows. Supersession chains track what was true when. New `temporal_query` tool.
- **Wake-Up Primer** — 4-layer token-budgeted context injected at session start (profile, critical knowledge, recent decisions, top entities). New `wake_up` tool.
- **Memory Usefulness Feedback** — tracks search→action correlation. Entries that lead to file modifications get boosted; never-useful entries decay faster.
- **Topic Navigation** — auto-detect 13 topic categories. New `browse`, `list_topics`, `find_tunnels` tools for navigating by topic/person/time.
- **Conversation Import** — 5 format parsers (Claude Code JSONL, Claude AI JSON, ChatGPT JSON, Slack JSON, plain text) with auto-detection. New `import_conversations` tool.
- **Dreamer Consolidation** — 3 new background tasks: consolidate related observations, extract causal chains (DECISION→PROBLEM→MILESTONE), boost corroborated facts.
- **Context-Triggered Wake-Up** — UserPromptSubmit hook injects relevant memories on every user message (rate-limited, topic-cooldown).
- **Decision Trails** — reconstruct evidence chain behind any decision with `explain_decision` tool. Finds preceding events, errors, searches, and superseded alternatives.
- **Session Narratives** — generate PR descriptions, standup updates, ADRs, or onboarding guides from session data with `generate_story` tool.
- **Regression Fingerprinting** — capture working-state snapshots at success events; diff against current state when errors appear.
- **Memory Pressure Predictor** — `predict_loss` scores entries by forgetting risk (importance × recency × access × usefulness).
- 12 new MCP tools (32 → 44): `recall`, `wake_up`, `entity_detect`, `list_people`, `temporal_query`, `browse`, `list_topics`, `find_tunnels`, `import_conversations`, `explain_decision`, `generate_story`, `predict_loss`
- 4 new database migrations (v13–v16)
- 173 new tests (943 → 1116)

### Changed
- Pipeline now runs importance classification + entity extraction + topic detection on every observation
- `save_knowledge` sets `valid_from` and supersedes contradicted entries
- `search_knowledge` filters out superseded entries by default (use `include_superseded: true` to include)
- Dreamer cycle expanded with progressive compression + consolidation + causal chains + corroboration

## [2.6.0] — 2026-04-06

### Added
- **Intelligence Dashboard** — complete redesign of the web dashboard with intelligence-first layout, refined dark/light design system, system + monospace typography, glass morphism header, and responsive mobile support.
- **Intelligence Strip** — 4 hero cards showing health score, SearchFusion pipeline status, knowledge authority metrics, and LLM integration status at a glance.
- **Smart Search** — dashboard search now uses the full SearchFusion pipeline with intent classification (causal/temporal/lookup/general), adaptive reranking weights, and pipeline visualization showing how results were found.
- **Knowledge Authority Display** — every knowledge entry in the dashboard shows its computed authority score (0–1) via softmax attention over source weight, session breadth, access density, and recency.
- **Contradiction Detection UI** — finds conflicting knowledge entries, compares authority scores side-by-side, and displays suggested resolution actions (keep existing, replace, or merge).
- **LLM Status Indicator** — header chip showing active LLM provider, model, and availability status.
- **4 new API endpoints** — `/api/search-fusion` (intent-aware search with reranking), `/api/contradictions` (contradiction detection with authority), `/api/llm-status` (provider config), `/api/knowledge-authority` (entries with computed authority scores).
- **Collapsible System Status** — DB health, compression, top files, privacy, and content index grouped into a collapsible section to reduce vertical noise.

## [2.5.0] — 2026-04-06

### Added
- **Optional LLM Integration** — opt-in enhancement layer that works alongside the deterministic pipeline. Disabled by default; all LLM failures fall back to deterministic, invalid responses never reach the database.
- **Query Expansion** — LLM expands search queries with semantically related terms (e.g. "auth" → "authentication, JWT, login, session") to improve recall.
- **LLM Title & Tag Generation** — higher-quality knowledge entry titles and tags via LLM, with deterministic auto-tagger as fallback.
- **Contradiction Explanation** — LLM explains why two entries contradict each other and suggests a concrete merge strategy.
- **Smart Summarization** — LLM summarization pass before the 14 deterministic summarizers for richer compression on complex content.
- **Three LLM Providers** — Ollama (local, free), OpenRouter (free and paid models), and Claude API (auto-detected when `ANTHROPIC_API_KEY` is present, uses Haiku 4.5).
- **Auto-detect** — provider selection at startup: `ANTHROPIC_API_KEY` → Claude Haiku 4.5, Ollama running locally → Ollama, `OPENROUTER_API_KEY` → OpenRouter.
- **Setup Wizard** — `context-mem init` now asks whether to enable Free (deterministic-only) or Enhanced (optional LLM) mode and configures `ai_curation` in `.context-mem.json` accordingly.

## [2.4.0] — 2026-04-05

### Added
- **Adaptive Reranking** — intent-specific weight vectors for causal, temporal, lookup, and general query types. General-intent results apply result-aware weight adjustment to surface the most contextually relevant observations.
- **Depth-Aware Contradiction Resolution** — authority scoring via softmax attention across four signals (source_weight, session_breadth, access_density, recency). `ContradictionWarning` now includes a `suggested_action` field with an actionable recommendation.
- **Block-Level Memory Attention** — four scope-based memory blocks (session, project, global, archive). Two-phase search applies softmax block attention to allocate the result budget across blocks, with per-block score normalization for consistent ranking.

## [2.3.0] — 2026-03-28

### Added
- Auto-promote patterns: knowledge accessed in 3+ sessions auto-promotes to global store
- Cross-project merge/conflict resolution with duplicate detection and auto-merge
- Enhanced proactive context injection with prioritized scoring (P1 bugs > P2 patterns > P3 cross-project)
- Search analytics dashboard with top entries and category breakdown
- Project health score (0-100 composite metric)
- Cross-project comparison view in dashboard
- Timeline explorer with date range zoom/filter and replay
- Auto-tagger for deterministic title and tag generation from content
- Confidence scoring for knowledge entries (source + freshness + access + sessions)
- Entry-level time-travel diffs between dates
- Ollama client for optional AI-assisted knowledge curation
- `merge_suggestions` MCP tool for viewing cross-project duplicate suggestions
- Dashboard health score gauge with color indicators

### Changed
- Proactive injection now uses dynamic scoring instead of hardcoded values
- Proactive injection supports Write tool trigger and imports-based query extraction
- Dreamer agent now includes promotionScan and duplicateScan tasks
- Knowledge search now records session access for auto-promote tracking
- Global knowledge entries support source_projects array (multiple source projects)
- Tool count increased from 31 to 32

### Database
- Migration v11: session_access_log table, auto_promoted flag on knowledge
- Migration v12: contradiction_count on knowledge
- Global migration v2: source_projects column, merge_suggestions table

## [2.0.0] — 2026-03-27

### Added
- Time-Travel Debugging: view/compare project state at any date
- Natural Language Query: `ask` tool with intent classification
- Dashboard 2.0: knowledge graph visualization, timeline explorer, agent panel, dark theme

## [1.4.0] — 2026-03-27

### Added
- Multi-Agent Shared Memory: agent registry, file claiming, broadcasting
- 4 MCP tools: agent_register, agent_status, claim_files, agent_broadcast

## [1.3.0] — 2026-03-27

### Added
- Proactive Context Injection: auto-inject relevant knowledge on file read/edit
- Rate limiting: 3/min, 5-min file cooldown

## [1.2.0] — 2026-03-27

### Added
- Knowledge Graph: entity-relationship model, 10 entity types, 8 relationship types
- BFS graph traversal, auto-entity extraction
- 3 MCP tools: graph_query, add_relationship, graph_neighbors

## [1.1.0] — 2026-03-27

### Added
- WebSocket streaming: real-time dashboard updates
- Cross-Project Knowledge Transfer: global store, promote_knowledge, global_search
- Custom Summarizer Plugin API: npm convention, auto-discovery, scaffolding CLI

## [1.0.0] — 2026-03-27

### Added
- Dreamer background agent with periodic knowledge validation (5-min cycle, configurable)
- Auto-mark entries stale after 30 days without access
- Auto-archive non-explicit entries after 90 days
- Intra-category contradiction detection via word overlap in Dreamer
- Privacy threat detection with 9 built-in secret detectors (AWS keys, GitHub tokens, Slack tokens, JWTs, private keys, generic API keys, emails, IP addresses)
- Configurable disabled_detectors for opt-out of specific privacy detectors
- Request canonicalization with 30-second TTL search query cache
- Canonical form normalization: lowercase, strip punctuation, sort tokens
- Cache hits bypass throttle counting
- Auto-eviction on cache expiry and max 100 entries
- 24 new tests (Dreamer 7, privacy 11, canonicalization 5, migration 1)

### Fixed
- Cache eviction LRU cap enforcement — evictExpired now properly trims oldest entries
- Await restoreSnapshot in handleRestoreSession to prevent async breakage
- Marketplace description synced to match all other locations

### Changed
- Migration v8: new 'stale' column on knowledge entries
- Privacy engine integrated into observe pipeline (auto-redacts before storage)
- Timers use unref() to avoid blocking process exit
- Updated skill docs, plugin readme, and commands for v0.8.0+ features
- 409 tests passing

## [0.8.0] — 2026-03-27

### Added
- Semantic contradiction detection using @huggingface/transformers embeddings (>= 0.75 threshold)
- Graceful fallback to keyword overlap when vector search unavailable
- Knowledge entry relevance decay with 14-day half-life exponential decay
- Explicit source entries decay 0.8x slower than inferred/observed
- Access frequency logarithmic boost to resist decay
- Configurable search fusion weights: bm25 (0.5), trigram (0.3), levenshtein (0.15), vector (0.05)
- Dashboard observation detail endpoint /api/observation/:id
- Dashboard knowledge search endpoint /api/knowledge/search with debounce and highlighting
- FTS5 search with LIKE fallback for knowledge queries
- 9 new tests (semantic 4, decay 3, weights 2)

### Changed
- Migration v7: new last_accessed column on knowledge entries
- checkContradictions() now async with optional vector similarity layer
- Weights applied in fusion execute() method, wired through kernel config
- 385 tests passing

## [0.7.0] — 2026-03-27

### Added
- Observation reranking: 70% relevance + 20% recency (7-day half-life) + 10% access frequency (logarithmic)
- Access count column wired through all 4 search engines
- Search throttle window-reset test for progressive throttling
- 6 knowledge tool tests (update_profile, save_knowledge contradiction flow)
- 6 truncation tests verifying 60/40 split behavior
- 7 reranking tests covering recency boost, decay, access frequency

### Fixed
- 60/40 truncation: aligned char-based fallback budgets to match line-based ratio (was 50/50)

### Changed
- Migration v6: new access_count column
- 376 tests passing

## [0.6.1] — 2026-03-27

### Fixed
- 35 bug fixes across 19 files in comprehensive security audit
- Replace dashboard CORS `Access-Control-Allow-Origin: *` with localhost-only
- Add CORS headers to all error response paths (404, 405, 500)
- Add limit clamping to 6 dashboard API endpoints
- Replace execSync with spawn for URL opening (prevent command injection)
- Add auth token lock file to prevent dashboard PID race condition
- Input validation added to handleGet, handleSearch, handleSearchContent, handleSearchKnowledge, handleEmitEvent, handleQueryEvents
- MAX_CONTENT_LENGTH guard on handleSummarize and handleExecute
- Fix handleRestoreSession: make session_id optional in schema
- Fix handleConfigure: deep-clone frozen config before mutation
- Fix handleBudgetConfigure: reject Infinity values
- Sanitize error messages (strip system paths)
- Fix migration v4: datetime('now') replaced with unixepoch() for INTEGER column
- Fix budget_settings default mismatch (10M corrected to 100K)
- Windows-compatible signal handling (taskkill) and spawn fix with shell: true
- Unify FTS5 sanitization into shared fts5-utils.ts module
- Sync marketplace.json and CLI version strings to v0.6.1

## [0.6.0] — 2026-03-27

### Added
- Contradiction detection: save_knowledge auto-checks for similar entries via FTS5 search + fallback scan
- Blocked saves when conflicts found — caller must review and resubmit with force: true
- Source tracking: new source_type field (explicit/inferred/observed) with trust hierarchy
- Quick profile: 3-5 line project summary auto-generated from knowledge base
- Profile injected at session start before journal context
- New update_profile MCP tool for manual profile updates

### Changed
- Migration v5: source_type column + project_profile table
- Updated platform configs (8 files) for Honcho-inspired features
- 29 bug fixes across 6 rounds of deep scanning

## [0.5.0] — 2026-03-27

### Added
- Vector/semantic search via @huggingface/transformers (optional, 22MB model)
- Embedder with CJS/ESM interop and cwd-based module resolution
- VectorSearch plugin (priority 0, cosine similarity, 0.3 threshold)
- Pipeline async embedding (fire-and-forget via setImmediate)
- Kernel dynamic vector plugin loading with graceful degradation
- Activity journal via PostToolUse hook capturing Edit/Bash/Read/Write semantics
- Human-readable journal entries: "[HH:MM] EDIT file: old -> new"
- File-based journal (.context-mem/journal.md) with 32KB rotation
- Cross-session memory: SessionStart hook injects journal + DB context on startup
- Plugin structure: renamed manifest.json to plugin.json (Claude Code standard)
- 3 slash commands: /context-mem:status, :search, :journal
- Auto-activating context-optimization skill
- Dashboard vector search banner (4 states: available/missing-pkg/ready/active)
- 13 new tests (embedder utilities + vector plugin)

### Changed
- Snapshot budget 2KB raised to 8KB, stale threshold 1 day extended to 7 days
- New "changes" P1 snapshot category for actual Edit/Write operations
- Added .mcp.json at root with author object and keywords

## [0.4.0] — 2026-03-27

### Added
- Knowledge auto-extraction from observations: decisions, errors, commits, and frequently-accessed files (5x threshold)
- CLI commands: `context-mem export` and `context-mem import` for transferring data between machines
- HTTP bridge on port 51894 for hook-to-kernel integration
- ObserveQueue burst protection (60s dedup, batch 50)
- 9 new runtime plugins (Go, Rust, Ruby, PHP, Perl, R, Elixir, TypeScript, Sandbox)
- Search throttling (60s sliding window)
- Session snapshots with priority-based category trimming
- Budget management with 3 overflow strategies

### Fixed
- Hook stdin format corrected: tool_response (not tool_output)
- Dashboard snapshot rendering (string vs array handling)

### Changed
- Updated all platform configs and AI rules
- 343 tests passing

## [0.3.0] — 2026-03-27

### Added
- Knowledge base with 5 categories and time-decay relevance
- Budget manager with configurable overflow strategies
- Event tracker with P1-P4 priorities and error-fix detection
- Session manager with snapshot save/restore
- MCP tools for knowledge, budget, events, and sessions
- Dashboard CLI command
- Real-time dashboard with hooks system and demo data generator
- 9 new summarizers: markdown, html, typescript-error, build-output, git-log, csv, network, test-output, binary (14 total)
- 4-tier truncation cascade (JSON schema, pattern, head/tail, binary hash)
- SHA256 content deduplication in pipeline
- Levenshtein fuzzy search (3-layer: BM25, trigram, levenshtein)
- Content store with code-aware chunking
- Multi-platform AI rules and auto-init on serve
- All Projects aggregated view as default dashboard mode
- Multi-project dashboard with global instance registry

### Fixed
- FTS5 sanitization, configure allowlist, execute safety, race condition
- Token economics and prototype pollution fixes
- Lifecycle preservation and event delegation for project cards
- Aggregated stats query for All Projects view
- Dashboard process now dies when editor closes
- Correct dashboard server path in serve command
- Background serve process no longer killed by stdin close listener

### Changed
- Schema migration v3 with all new tables
- Enhanced log summarizer with nginx access log detection
- 333 tests passing

## [0.2.0] — 2026-03-27

### Added
- VS Code extension with sidebar dashboard, status bar, and MCP server management
- Multi-platform configs and installation guide for 11 platforms
- Claude Code plugin structure for marketplace install
- OpenClaw ContextEngine plugin with full lifecycle hooks
- Auto-detect editors in init and create MCP configs automatically
- Auto-start dashboard alongside MCP server
- marketplace.json for plugin registry

### Fixed
- Security and reliability hardening from code review

### Changed
- README updated with benchmarks, comparison table, and dashboard screenshots

## [0.1.0] — 2026-03-27

### Added
- MCP server with observe and summarize tools
- Search, timeline, and get MCP tools with progressive disclosure
- Stats, configure, and execute MCP tools
- 5 summarizers: code (AST-lite), log, error, JSON, shell
- Privacy engine with tag stripping, regex redaction, and fail-closed design
- better-sqlite3 storage plugin with FTS5, trigram, WAL, and migrations
- BM25 search plugin using FTS5 with relevance ranking
- Trigram search plugin for substring/partial matching
- Intent classifier with rule-based query analysis and type boosts
- Search fusion orchestrator with fallback chain, dedup, and type boosting
- Observe queue with batched writes, backpressure, and dedup
- Processing pipeline: privacy, summarize, index, store
- JavaScript, Python, and Shell runtime sandbox plugins
- Data lifecycle manager with TTL, size cap, and session cleanup
- Kernel with bootstrap, plugin registration, and signal handling
- CLI with serve, init, status, and doctor commands
- Claude Code hook script for fire-and-forget observe POST
- Claude Code platform adapter with hook and MCP configuration
- Config loader with deep merge and defaults
- PluginRegistry with lifecycle management and reverse-order shutdown
- ULID generator, token estimator, and FNV-1a hash utility
- Core type definitions: Plugin, Observation, Search, Storage interfaces
- End-to-end integration test (observe, search, get, stats)
- Public API exports and example config
