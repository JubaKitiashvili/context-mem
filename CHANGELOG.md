# Changelog

All notable changes to context-mem are documented here.

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
