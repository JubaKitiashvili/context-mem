<p align="center">
  <img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/banner.svg" alt="Context Mem — persistent memory for AI agents" width="100%"/>
</p>

<div align="center">

# Context Mem

**Persistent memory for AI agents. Fully local. Zero cost.**

[![npm version](https://img.shields.io/npm/v/context-mem)](https://www.npmjs.com/package/context-mem)
[![tests](https://img.shields.io/badge/tests-1130%20passing-brightgreen)]()
[![tools](https://img.shields.io/badge/MCP%20tools-44-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)]()

</div>

---

Context Mem is a dual-mode AI memory system: **real-time context optimization** (99% token savings) AND **long-term institutional memory**. It captures tool outputs via hooks, compresses them with 14 content-aware summarizers, stores everything in local SQLite with full-text search, and serves it back through [MCP](https://modelcontextprotocol.io).

Fully deterministic and free by default. Optional LLM enhancement (Ollama, OpenRouter, Claude API) when you want it.

---

## Quick Start

```bash
npm i context-mem && npx context-mem init
```

One command. `init` auto-detects your editor and creates everything:

| Editor | What gets created |
|--------|-------------------|
| **Claude Code** | `.mcp.json` + hooks (8 hooks incl. context-triggered injection) + CLAUDE.md |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/context-mem.mdc` |
| **Windsurf** | `.windsurf/mcp.json` + `.windsurf/rules/context-mem.md` |
| **VS Code / Copilot** | `.vscode/mcp.json` + `.github/copilot-instructions.md` |
| **Cline** | `.cline/mcp_settings.json` + `.clinerules/context-mem.md` |
| **Roo Code** | `.roo-code/mcp_settings.json` + `.roo/rules/context-mem.md` |

---

## How It Works

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/architecture.svg" alt="Observation Pipeline" width="100%"/>

Every tool output flows through the pipeline: **privacy screening** (9 secret detectors) → **parallel extraction** (entities, importance, topics) → **14 content summarizers** → **triple storage** (verbatim archive, SQLite summaries, knowledge graph) → **adaptive compression** over time.

Full coding session (50 tool outputs): **365 KB → 3.2 KB** (99% savings).

---

## Retrieval Benchmarks

Tested on 4 academic benchmarks. All scores are **without LLM reranking** — pure local retrieval.

| Benchmark | Context Mem | MemPalace | Notes |
|---|---|---|---|
| **LongMemEval R@5** | **98.0%** | 96.6% | 500 questions, session retrieval |
| **LongMemEval R@10** | **99.4%** | 98.2% | |
| **LoCoMo** (top-10) | **98.2%** | 60.3% | 1,977 multi-hop QA pairs |
| **ConvoMem** | **97.7%** | 92.9% | 250 items, 5 categories |
| **MemBench** | **98.0%** | 80.3% | 500 person-attribute queries |

> MemPalace claims 100% on LME/LoCoMo, but [those scores require paid LLM API calls and top-50 retrieval](https://github.com/milla-jovovich/mempalace/issues/29) that bypasses the retrieval system entirely. Their honest no-LLM scores are shown above.

---

## Search Architecture

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/search-architecture.svg" alt="Hybrid Parallel Search" width="100%"/>

BM25 and vector search run **independently in parallel**, then fuse via intent-adaptive weights with IDF-weighted content reranking. Fully local, zero API calls.

---

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

---

## Core Features

| Capability | Description |
|---|---|
| **Importance Scoring** | Every observation scored 0.0–1.0 with 6 significance flags: DECISION, ORIGIN, PIVOT, CORE, MILESTONE, PROBLEM. Auto-pin for decisions and milestones. |
| **Verbatim Recall** | Surface original content (not summaries) via `recall` tool. Dedicated FTS5 index. Importance, type, time, and flag filters. |
| **Adaptive Compression** | 4-tier progressive: verbatim (0-7d) → light (7-30d) → medium (30-90d) → distilled (90d+). Pinned entries stay verbatim forever. |
| **Entity Intelligence** | Auto-detect technologies, people, file paths, CamelCase, ALL_CAPS. 100+ aliases (React.js → React). Knowledge graph storage. |
| **Temporal Facts** | `valid_from`/`valid_to` on knowledge. Supersession chains. `temporal_query`: "what was true about X at time T?" |
| **Wake-Up Primer** | Token-budgeted context at session start. 4 layers: profile (15%), critical knowledge (40%), decisions (30%), entities (15%). |
| **Decision Trails** | Evidence chain reconstruction. `explain_decision` walks events backward: file reads → errors → searches → decision. |
| **Session Narratives** | 4 templates: PR description, standup update, ADR, onboarding guide. CLI: `context-mem story --format pr`. |
| **Topic Navigation** | 13 auto-detected categories. `browse` by topic/person/time. `find_tunnels` for cross-project bridges. |
| **Conversation Import** | 5 parsers: Claude Code JSONL, Claude AI JSON, ChatGPT JSON, Slack JSON, plain text. Auto-detection. |
| **14 Summarizers** | Content-aware: shell, JSON, errors, test results, TS errors, build output, git, CSV, markdown, HTML, network, code, logs, binary. |
| **Hybrid Search** | BM25 (4 strategies) + vector (nomic-embed 768-dim) parallel fusion. Trigram + Levenshtein fallback. Sub-millisecond. |
| **Knowledge Graph** | Entity-relationship model: files, modules, patterns, decisions, bugs, people, libraries, services, APIs, configs. |
| **Dreamer Agent** | Background: stale marking (30d), archival (90d), contradiction detection, auto-promote, consolidation, causal chains. |
| **Multi-Agent** | Register, claim files, check status, broadcast. Shared memory prevents duplicate work and merge conflicts. |
| **Privacy Engine** | Fully local. `<private>` tag stripping, custom regex, 9 secret detectors. No telemetry, no cloud. |
| **Optional LLM** | Query expansion, smart titles, contradiction explanation, LLM summarization. Ollama, OpenRouter, Claude API. Fail-safe to deterministic. |

---

## Intelligence Dashboard

Real-time web UI with 6 pages — `context-mem dashboard` to launch:

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/screenshots/dashboard-hero.png" alt="Dashboard — Intelligence Overview" width="100%"/>

<details>
<summary>More dashboard pages</summary>

**Knowledge Graph** — force-directed entity visualization with type filtering and depth control:

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/screenshots/dashboard-graph-page.png" alt="Dashboard — Knowledge Graph" width="100%"/>

**Topics** — topic cloud with observation counts and cross-project tunnels:

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/screenshots/dashboard-topics.png" alt="Dashboard — Topics" width="100%"/>

**Timeline** — chronological observations with importance badges, flags, and verbatim mode:

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/screenshots/dashboard-timeline.png" alt="Dashboard — Timeline" width="100%"/>

</details>

| Page | What it shows |
|---|---|
| **Home** | 7 intelligence cards, compression tiers, pressure alerts, wake-up preview |
| **Topics** | Topic cloud + cross-project tunnels |
| **Graph** | Force-directed entity visualization |
| **Timeline** | Importance badges + significance flags |
| **Trail** | Decision evidence chain explorer |
| **Narrative** | PR / standup / ADR / onboarding generator |

---

## How It Compares

| | Context Mem v3.1 | MemPalace | claude-mem |
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

---

## Performance

All operations are sub-millisecond, zero LLM dependency:

| Operation | Speed | Latency |
|-----------|-------|---------|
| Importance Classification | 556K ops/s | 0.002ms |
| Entity Extraction | 179K ops/s | 0.006ms |
| Topic Detection | 162K ops/s | 0.006ms |
| Compression Tier Calc | 3M ops/s | <0.001ms |
| Verbatim FTS Search | 50K ops/s | 0.020ms |
| BM25 Search | 3.3K ops/s | 0.3ms |
| Wake-Up Primer Assembly | 9K ops/s | 0.111ms |
| Narrative Generation | 6K ops/s | 0.164ms |

---

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

---

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

---

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

---

## Platform Support

| Platform | Auto-Setup |
|---|---|
| Claude Code, Cursor, Windsurf, VS Code/Copilot, Cline, Roo Code | `context-mem init` |
| Gemini CLI, Antigravity, Goose, OpenClaw, CrewAI, LangChain | See [configs/](configs/) |

---

## Documentation

| Doc | Description |
|---|---|
| [Benchmark Results](docs/benchmarks/results.md) | Compression + search benchmarks |
| [Total Recall Benchmarks](docs/benchmarks/run-total-recall-benchmarks.js) | v3.0 feature performance |
| [Contributing](CONTRIBUTING.md) | How to contribute |

## License

MIT — [Juba Kitiashvili](https://github.com/JubaKitiashvili)

---

<div align="center">

### Get Started

```bash
npm i context-mem && npx context-mem init
```

**[Read the Docs](docs/)** · **[View Benchmarks](docs/benchmarks/results.md)** · **[Report a Bug](https://github.com/JubaKitiashvili/context-mem/issues)** · **[Contributing](CONTRIBUTING.md)**

---

**Context Mem v3.1 "Total Recall"** — your AI never forgets.

[![Star on GitHub](https://img.shields.io/github/stars/JubaKitiashvili/context-mem?style=social)](https://github.com/JubaKitiashvili/context-mem)
[![npm](https://img.shields.io/npm/dm/context-mem)](https://www.npmjs.com/package/context-mem)
[![Follow](https://img.shields.io/github/followers/JubaKitiashvili?style=social)](https://github.com/JubaKitiashvili)

</div>
