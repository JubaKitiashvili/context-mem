# Context Mem

> Your AI forgets everything. Every decision, every debug session, every architecture choice — gone when the session ends. **context-mem remembers.**

[![npm version](https://img.shields.io/npm/v/context-mem)](https://www.npmjs.com/package/context-mem)
[![tests](https://img.shields.io/badge/tests-1130%20passing-brightgreen)]()
[![tools](https://img.shields.io/badge/MCP%20tools-44-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)]()

**context-mem** is a dual-mode AI memory system: real-time context optimization (99% token savings) AND long-term institutional memory. It captures tool outputs via hooks, compresses them with 14 content-aware summarizers, stores everything in local SQLite with full-text search, and serves it back through [MCP](https://modelcontextprotocol.io). Fully deterministic and free by default. Optional LLM enhancement (Ollama, OpenRouter, Claude API) when you want it.

**v3.1 "Total Recall"** adds importance scoring, verbatim recall, entity intelligence, adaptive compression, decision trails, session narratives, and 12 more features that make AI assistants genuinely remember. v3.1 brings a refactored search architecture with hybrid parallel retrieval (BM25 + nomic-embed-text-v1.5 768-dim vectors).

## Real-World Examples

```
You: "Why did we choose Postgres?"
  → recall returns the exact verbatim quote from March 15, importance 0.95,
    with the full evidence chain: error → file_read → search → decision

You: "What did Sarah work on last sprint?"
  → browse by person shows 14 observations mentioning Sarah,
    grouped by topic (auth, database, deployment)

You: "This worked last week"
  → regression fingerprint shows 3 knowledge entries changed since
    last working state, 2 new error patterns appeared

You: "Generate a PR description"
  → context-mem story --format pr assembles changes, decisions, resolved
    issues, and test plan from the current session

You: "What are we about to forget?"
  → predict_loss shows 8 entries at risk: low importance, 45+ days old,
    never accessed. Pin the critical ones before they decay.
```

## Retrieval Benchmarks

Tested on 4 academic benchmarks. All scores are **without LLM reranking** — pure local retrieval.

| Benchmark | context-mem | MemPalace | Notes |
|---|---|---|---|
| **LongMemEval R@5** | **98.0%** | 96.6% | 500 questions, session retrieval |
| **LongMemEval R@10** | **99.4%** | 98.2% | |
| **LoCoMo** (top-10) | **98.2%** | 60.3% | 1,977 multi-hop QA pairs |
| **ConvoMem** | **97.7%** | 92.9% | 250 items, 5 categories |
| **MemBench** | **98.0%** | 80.3% | 500 person-attribute queries |

MemPalace claims 100% on LME/LoCoMo, but [those scores require paid LLM API calls and top-50 retrieval](https://github.com/milla-jovovich/mempalace/issues/29) that bypasses the retrieval system entirely. Their honest no-LLM scores are shown above.

**Search architecture:** 8 BM25 strategies + nomic-embed-text-v1.5 vector (768-dim) + IDF-weighted reranking + hybrid parallel fusion. Fully local, zero API calls.

## How It Compares

| | context-mem v3.1 | MemPalace | claude-mem |
|---|---|---|---|
| **Retrieval Accuracy** | 98%+ (4 benchmarks) | 96.6% raw, 100% with LLM | Not benchmarked |
| **Token Savings** | 99% (benchmarked) | 0% (stores everything) | ~95% (claimed) |
| **Search** | BM25 + Vector + IDF reranking | ChromaDB | Basic recall |
| **Entity Intelligence** | Auto-detect + 100 aliases + graph | No | No |
| **Importance Scoring** | 0.0-1.0 with 6 significance flags | No | No |
| **Decision Trails** | Evidence chain reconstruction | No | No |
| **Session Narratives** | PR/Standup/ADR/Onboarding | No | No |
| **Conversation Import** | ChatGPT, Claude, Slack, plaintext | No | No |
| **Cross-Project Memory** | Global store + topic tunnels | No | No |
| **LLM Dependency** | Optional (free by default) | None (100% needs API) | Required (~$57/mo) |
| **Privacy** | Fully local, 9 secret detectors | Local | Local |
| **License** | MIT | Proprietary | AGPL-3.0 |

## Quick Start

```bash
cd your-project
npm i context-mem && npx context-mem init
```

One command. `init` auto-detects your editor and creates everything:

| Editor | What gets created | Restart needed? |
|--------|-------------------|-----------------|
| **Claude Code** | `.mcp.json` + hooks (8 hooks incl. context-triggered injection) + CLAUDE.md | No |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/context-mem.mdc` | No |
| **Windsurf** | `.windsurf/mcp.json` + `.windsurf/rules/context-mem.md` | No |
| **VS Code / Copilot** | `.vscode/mcp.json` + `.github/copilot-instructions.md` | No |
| **Cline** | `.cline/mcp_settings.json` + `.clinerules/context-mem.md` | No |
| **Roo Code** | `.roo-code/mcp_settings.json` + `.roo/rules/context-mem.md` | No |

## Architecture

```
                        Incoming Content
                              │
                    ┌─────────▼──────────┐
                    │  Privacy Engine     │ (9 secret detectors, tag stripping)
                    │  SHA256 Dedup       │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼───────┐ ┌────▼─────┐ ┌───────▼──────┐
    │ Entity Extractor│ │Importance│ │   Topic      │
    │ (100+ aliases)  │ │Classifier│ │  Detector    │
    └─────────┬───────┘ │(6 flags) │ │(13 categories)
              │         └────┬─────┘ └───────┬──────┘
              └───────────────┼───────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
    ┌─────────▼───────┐ ┌────▼─────┐ ┌───────▼──────┐
    │   Verbatim      │ │Summarizer│ │  Knowledge   │
    │   Archive       │ │(14 types)│ │  Graph       │
    │  (FTS5 indexed) │ │          │ │  (entities)  │
    └─────────────────┘ └──────────┘ └──────────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Adaptive Compressor │
                    │  verbatim → light   │
                    │  → medium → distill │
                    │ (age-based, pinned  │
                    │  entries protected) │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   MCP Server       │ ← 44 tools
                    │   + Dashboard      │ ← 6 pages, real-time
                    │   + CLI            │ ← why, story, import
                    └────────────────────┘
```

## Performance

All Total Recall operations are sub-millisecond, zero LLM dependency:

| Operation | Speed | Latency |
|-----------|-------|---------|
| Importance Classification | 556K ops/s | 0.002ms |
| Entity Extraction | 179K ops/s | 0.006ms |
| Topic Detection | 162K ops/s | 0.006ms |
| Compression Tier Calc | 3M ops/s | <0.001ms |
| Verbatim FTS Search | 50K ops/s | 0.020ms |
| Wake-Up Primer Assembly | 9K ops/s | 0.111ms |
| Conversation Parsing | 390K+ ops/s | 0.003ms |
| Narrative Generation | 6K ops/s | 0.164ms |
| BM25 Search | 3.3K ops/s | 0.3ms |

Full coding session (50 tool outputs): **365 KB → 3.2 KB** (99% savings). See [benchmarks](docs/benchmarks/).

## Features

### Total Recall (v3.0)

**Importance Classification** — Every observation scored 0.0-1.0 at ingest with 6 significance flags: DECISION, ORIGIN, PIVOT, CORE, MILESTONE, PROBLEM. Decisions and milestones are auto-pinned and never compressed.

**Verbatim Recall** — Surface original content via `recall` tool with importance, type, time, and flag filters. Dedicated FTS5 index on raw content. `search` and `timeline` tools gain `verbatim` mode.

**Adaptive Compression** — 4-tier progressive compression based on observation age: verbatim (0-7d) → light (7-30d) → medium (30-90d) → distilled (90d+). Pinned entries stay verbatim forever. High-importance entries compress one tier slower.

**Entity Intelligence** — Auto-detect technologies, people, file paths, CamelCase components, ALL_CAPS constants, issue refs, version numbers. 100+ technology aliases (React.js → React, Postgres → PostgreSQL). Entities stored in knowledge graph.

**Temporal Facts** — Knowledge entries have `valid_from`/`valid_to` validity windows. When new knowledge contradicts old, the old entry is superseded with a chain link. `temporal_query` tool: "what was true about X at time T?"

**Wake-Up Primer** — Auto-generated, token-budgeted context injected at session start. 4 layers: L0 Project Profile (15%), L1 Critical Knowledge (40%), L2 Recent Decisions (30%), L3 Top Entities (15%).

**Topic Navigation** — 13 auto-detected topic categories (auth, database, api, frontend, etc.). `browse` by topic/person/time, `list_topics` with counts, `find_tunnels` for cross-project concept bridges.

**Conversation Import** — Parse external conversation exports into searchable memory. 5 formats with auto-detection: Claude Code JSONL, Claude AI JSON, ChatGPT JSON, Slack JSON, plain text.

**Decision Trails** — Reconstruct the evidence chain behind any decision. `explain_decision` walks events backward: file reads → errors → searches → decision. CLI: `context-mem why <topic>`.

**Session Narratives** — Generate human-readable narratives. 4 templates: PR description, standup update, ADR (Architecture Decision Record), onboarding guide. CLI: `context-mem story --format pr`.

**Regression Fingerprinting** — Capture "working state" snapshots at success events. When errors appear, auto-diff against last fingerprint to identify what changed.

**Memory Pressure Predictor** — `predict_loss` scores entries by forgetting risk. Low importance + old + never accessed = high risk. Pin critical entries to protect them.

**Memory Usefulness Feedback** — Tracks whether recalled memories lead to action. Search results that lead to file modifications are marked "useful" and get relevance boosts.

### Core Features

**14 Content Summarizers** — Auto-detect content type and apply optimal compression: shell output, JSON, errors, test results, TypeScript errors, build output, git logs, CSV, markdown, HTML, network, code, logs, binary.

**Hybrid Parallel Search** — BM25 (4 strategies: AND-mode, entity-focused, sanitized FTS5, OR-mode with expansion) + nomic-embed-text-v1.5 vector (768-dim) run independently in parallel, then fuse via intent-adaptive weights with IDF-weighted content reranking. Trigram fuzzy + Levenshtein typo-tolerant as fallback layers. Sub-millisecond with intent classification.

**Knowledge Base** — 5 categories (pattern, decision, error, api, component). 14-day half-life decay, semantic contradiction detection, authority scoring via softmax attention, auto-extraction from observations.

**Knowledge Graph** — Entity-relationship model mapping connections between files, modules, patterns, decisions, bugs, people, libraries, services, APIs, and configs.

**Dreamer Background Agent** — Runs automatically: marks stale (30d), archives (90d), detects contradictions, auto-promotes to global store, progressive compression, consolidates related observations, extracts causal chains, boosts corroborated facts.

**Intelligence Dashboard** — Real-time web UI with 6 pages: Home (7 intelligence cards, compression tiers, pressure alerts, wake-up preview), Topics (cloud + tunnels), Graph (force-directed entity visualization), Timeline (importance badges + flags), Trail (decision evidence chain), Narrative (PR/standup/ADR generator).

**Multi-Agent Coordination** — Agents register, claim files, check status, broadcast messages. Shared memory prevents duplicate work and merge conflicts.

**Session Continuity** — Snapshot save/restore across sessions. Chain-based handoff with continuation prompts. Context-triggered memory injection on every user message.

**Privacy Engine** — Everything local. `<private>` tag stripping, custom regex redaction, 9 built-in secret detectors. No telemetry, no cloud.

**Optional LLM Enhancement** — Query expansion, smart titles/tags, contradiction explanations, LLM summarization. Three providers: Ollama (free), OpenRouter, Claude API. All failures fall back to deterministic.

## MCP Tools (44)

<details>
<summary>Click to see all 44 tools</summary>

| Tool | Description |
|---|---|
| **Core** | |
| `observe` | Store observation with auto-summarization + importance scoring |
| `search` | Hybrid search with optional verbatim mode |
| `get` | Retrieve full observation by ID |
| `timeline` | Reverse-chronological list with importance badges |
| `stats` | Token economics for current session |
| `summarize` | Summarize content without storing |
| `configure` | Update runtime configuration |
| `execute` | Run code (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir) |
| **Content** | |
| `index_content` | Index with code-aware chunking |
| `search_content` | Search indexed chunks |
| **Knowledge** | |
| `save_knowledge` | Save with contradiction detection + temporal validity |
| `search_knowledge` | Search (filters superseded by default) |
| `promote_knowledge` | Promote to global cross-project store |
| `global_search` | Search across all projects |
| `resolve_contradiction` | Resolve conflicts (supersede/merge/keep/archive) |
| `merge_suggestions` | View cross-project duplicate suggestions |
| **Graph** | |
| `graph_query` | Traverse entity relationships |
| `add_relationship` | Link entities |
| `graph_neighbors` | Find connected entities |
| **Session** | |
| `update_profile` | Project profile |
| `budget_status` / `budget_configure` | Token budget management |
| `restore_session` | Restore from snapshot |
| `handoff_session` | Cross-session continuity |
| **Events** | |
| `emit_event` / `query_events` | P1-P4 event tracking |
| **Agents** | |
| `agent_register` / `agent_status` / `claim_files` / `agent_broadcast` | Multi-agent coordination |
| **Intelligence** | |
| `time_travel` | Compare project state at any point in time |
| `ask` | Natural language question answering |
| **Total Recall** | |
| `recall` | Verbatim memory retrieval with importance/flag/time filters |
| `wake_up` | Generate scored session primer (4-layer context) |
| `entity_detect` | Extract entities from text |
| `list_people` | Person entities with relationship counts |
| `temporal_query` | Knowledge valid at specific timestamp |
| `browse` | Navigate by topic, person, or time |
| `list_topics` | Topic list with observation counts |
| `find_tunnels` | Cross-project topic bridges |
| `import_conversations` | Import ChatGPT/Claude/Slack/text conversations |
| `explain_decision` | Decision trail evidence chain |
| `generate_story` | Narrative (PR/standup/ADR/onboarding) |
| `predict_loss` | Memory pressure prediction |

</details>

## CLI Commands

```bash
context-mem init                    # Initialize in current project
context-mem serve                   # Start MCP server (stdio)
context-mem status                  # Show database stats
context-mem doctor                  # Run health checks
context-mem dashboard               # Open web dashboard (6 pages)
context-mem why <query>             # Decision trail — why was X decided?
context-mem story --format pr       # Generate narrative (pr/standup/adr/onboarding)
context-mem import-convos <path>    # Import conversations (auto-detect format)
context-mem export                  # Export as JSON
context-mem import                  # Import from JSON
context-mem plugin add|remove|list  # Manage summarizer plugins
```

## Configuration

<details>
<summary>.context-mem.json</summary>

```json
{
  "storage": "auto",
  "plugins": {
    "summarizers": ["shell", "json", "error", "log", "code"],
    "search": ["bm25", "trigram", "vector"],
    "runtimes": ["javascript", "python"]
  },
  "search_weights": { "bm25": 0.45, "trigram": 0.15, "levenshtein": 0.05, "vector": 0.35 },
  "privacy": { "strip_tags": true, "redact_patterns": [] },
  "lifecycle": { "ttl_days": 30, "max_db_size_mb": 500, "max_observations": 50000 },
  "ai_curation": { "enabled": false, "provider": "auto" }
}
```

</details>

## Platform Support

| Platform | Auto-Setup |
|---|---|
| Claude Code, Cursor, Windsurf, VS Code/Copilot, Cline, Roo Code | `context-mem init` |
| Gemini CLI, Antigravity, Goose, OpenClaw, CrewAI, LangChain | See [configs/](configs/) |

## Documentation

| Doc | Description |
|---|---|
| [Benchmark Results](docs/benchmarks/results.md) | Compression + search benchmarks |
| [Total Recall Benchmarks](docs/benchmarks/run-total-recall-benchmarks.js) | v3.0 feature performance |
| [Contributing](CONTRIBUTING.md) | How to contribute |

## License

MIT

## Author

[Juba Kitiashvili](https://github.com/JubaKitiashvili)

---

<p align="center">
  <b>context-mem v3.1 "Total Recall" — your AI never forgets</b><br/>
  <a href="https://github.com/JubaKitiashvili/context-mem">Star</a> · <a href="https://github.com/JubaKitiashvili/context-mem/fork">Fork</a> · <a href="https://github.com/JubaKitiashvili/context-mem/issues">Issues</a>
</p>
