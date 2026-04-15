<p align="center">
  <img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/banner.svg" alt="Context Mem — persistent memory for AI agents" width="100%"/>
</p>

<div align="center">

# Context Mem

**Your AI coding assistant forgets everything between sessions. This fixes that.**

[![npm version](https://img.shields.io/npm/v/context-mem)](https://www.npmjs.com/package/context-mem)
[![LongMemEval](https://img.shields.io/badge/LongMemEval-100%25%20(500%2F500)-gold)]()
[![tests](https://img.shields.io/badge/tests-1143%20passing-brightgreen)]()
[![tools](https://img.shields.io/badge/MCP%20tools-44-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

## The Problem

Every time you start a new AI session, your assistant has zero memory of what you built yesterday. The architecture decisions, the bugs you fixed, the preferences you stated — all gone. You spend the first 10 minutes re-explaining context.

## The Fix

context-mem runs in the background, captures everything automatically, and retrieves exactly the right context when you need it:

- **Longer sessions** without losing context (99% token savings)
- **Instant continuity** — new sessions pick up where you left off
- **Automatic** — no manual saving, no commands to remember
- **Fully local** — your code never leaves your machine
- **Free** — no API keys, no subscription, no cloud

```bash
npm i context-mem && npx context-mem init
```

One command. Works with Claude Code, Cursor, Windsurf, VS Code, Cline, and Roo Code.

---

## How accurate is the retrieval?

Tested on 4 academic benchmarks — over 3,200 questions total:

### Pure Local (zero API calls, fully free)

| Benchmark | Context Mem | MemPalace | Mem0 | Zep |
|---|---|---|---|---|
| **LongMemEval** (500 Q) | **97.8%** | 96.6% | ~85% | ~85% |
| **LoCoMo** (1,977 Q) | **98.1%** | 60.3% | — | — |
| **MemBench** (500 Q) | **98.0%** | 80.3% | — | — |
| **ConvoMem** (250 Q) | **97.7%** | 92.9% | — | — |

### With Optional LLM Enhancement (Haiku, ~$1 per 500 queries)

| Benchmark | Context Mem | MemPalace |
|---|---|---|
| **LongMemEval R@5** | **100.0% (500/500)** | 100.0%* |

*Both systems achieve 100% with Haiku reranking. The difference is in pure-local scores — and in every other benchmark.

> The LoCoMo gap tells the real story: **98.1% vs 60.3%** on multi-hop reasoning. Simple queries are easy. Complex ones separate the systems.

---

## How It Works

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/architecture.svg" alt="Observation Pipeline" width="100%"/>

Every tool output flows through the pipeline: **privacy screening** (9 secret detectors) → **parallel extraction** (entities, importance, topics) → **14 content summarizers** → **triple storage** (verbatim archive, SQLite summaries, knowledge graph) → **adaptive compression** over time.

Full coding session (50 tool outputs): **365 KB → 3.2 KB** (99% savings).

---

## What it is (and isn't)

**context-mem is:**
- A retrieval-first memory system (not a chatbot wrapper)
- A context compression engine (14 content-aware summarizers)
- Infrastructure for AI agents (44 MCP tools)

**context-mem is not:**
- Chat history storage (it extracts meaning, not raw logs)
- An LLM wrapper (works without any API keys)
- A cloud service (fully local SQLite)

---

## Quick Start

```bash
npm i context-mem && npx context-mem init
```

`init` auto-detects your editor:

| Editor | What gets created |
|--------|-------------------|
| **Claude Code** | `.mcp.json` + hooks (8 hooks incl. context-triggered injection) + CLAUDE.md |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/context-mem.mdc` |
| **Windsurf** | `.windsurf/mcp.json` + `.windsurf/rules/context-mem.md` |
| **VS Code / Copilot** | `.vscode/mcp.json` + `.github/copilot-instructions.md` |
| **Cline** | `.cline/mcp_settings.json` + `.clinerules/context-mem.md` |
| **Roo Code** | `.roo-code/mcp_settings.json` + `.roo/rules/context-mem.md` |

---

## Real-World Examples

```
You: "Why did we choose Postgres?"
  → recall returns the exact verbatim quote from March 15, importance 0.95,
    with the full evidence chain: error → file_read → search → decision

You: "What did Sarah work on last sprint?"
  → browse by person shows 14 observations mentioning Sarah,
    grouped by topic (auth, database, deployment)

You: "Generate a PR description"
  → context-mem story --format pr assembles changes, decisions, resolved
    issues, and test plan from the current session

You: "What are we about to forget?"
  → predict_loss shows 8 entries at risk: low importance, 45+ days old,
    never accessed. Pin the critical ones before they decay.
```

---

## Search Architecture

<img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/search-architecture.svg" alt="Hybrid Parallel Search" width="100%"/>

BM25 (8 strategies + synonym expansion) and vector search run **independently in parallel**, then fuse via intent-adaptive weights with IDF-weighted content reranking. Optional LLM judge reranker pushes accuracy to 100%. Fully local by default.

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
| **Hybrid Search** | BM25 (8 strategies + synonym expansion) + vector (nomic-embed 768-dim) parallel fusion. Optional LLM judge reranker. Sub-millisecond. |
| **Temporal Resolver** | Deterministic date parsing for relative time queries ("3 days ago", "last Saturday"). Zero LLM cost. |
| **Per-Prompt Injection** | UserPromptSubmit hook auto-injects relevant memories on every user message. Rate-limited, topic-deduplicated. |
| **Knowledge Graph** | Entity-relationship model: files, modules, patterns, decisions, bugs, people, libraries, services, APIs, configs. |
| **Multi-Agent** | Register, claim files, check status, broadcast. Shared memory prevents duplicate work and merge conflicts. |
| **Privacy Engine** | Fully local. `<private>` tag stripping, custom regex, 9 secret detectors. No telemetry, no cloud. |

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

---

## How It Compares

| | Context Mem v3.2 | MemPalace | claude-mem |
|---|---|---|---|
| **Retrieval Accuracy** | 98%+ (4 benchmarks), 100% LME | 96.6% raw, 100% LME with LLM | Not benchmarked |
| **Token Savings** | 99% (benchmarked) | 0% (stores everything) | ~95% (claimed) |
| **Search** | BM25 (8 strategies) + Vector + LLM Judge | ChromaDB | Basic recall |
| **Entity Intelligence** | Auto-detect + 100 aliases + graph | No | No |
| **Importance Scoring** | 0.0-1.0 with 6 significance flags | No | No |
| **Decision Trails** | Evidence chain reconstruction | No | No |
| **Session Narratives** | PR/Standup/ADR/Onboarding | No | No |
| **Cross-Project Memory** | Global store + topic tunnels | No | No |
| **LLM Dependency** | Optional (free by default) | 100% LME requires paid API | Required (~$57/mo) |
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
| [Benchmark Results](docs/benchmarks/results.md) | Compression + retrieval benchmarks |
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

**Context Mem v3.2** — 98%+ accuracy on every benchmark. Your AI never forgets.

[![Star on GitHub](https://img.shields.io/github/stars/JubaKitiashvili/context-mem?style=social)](https://github.com/JubaKitiashvili/context-mem)
[![npm](https://img.shields.io/npm/dm/context-mem)](https://www.npmjs.com/package/context-mem)
[![Follow](https://img.shields.io/github/followers/JubaKitiashvili?style=social)](https://github.com/JubaKitiashvili)

</div>
