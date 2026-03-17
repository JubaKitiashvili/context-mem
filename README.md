# context-mem

> Context optimization for AI coding assistants — 99% token savings, zero configuration, no LLM dependency.

[![npm version](https://img.shields.io/npm/v/context-mem)](https://www.npmjs.com/package/context-mem)
[![tests](https://img.shields.io/badge/tests-333%20passing-brightgreen)]()
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)]()

AI coding assistants waste 60–80% of their context window on raw tool outputs — full npm logs, verbose test results, uncompressed JSON. This means shorter sessions, lost context, and repeated work.

**context-mem** captures tool outputs via hooks, compresses them using 14 content-aware summarizers, stores everything in local SQLite with full-text search, and serves compressed context back through the [MCP protocol](https://modelcontextprotocol.io). No LLM calls, no cloud, no cost.

## How It Compares

| | context-mem | claude-mem | context-mode | Context7 |
|---|---|---|---|---|
| **Approach** | 14 specialized summarizers | LLM-based compression | Sandbox + intent filter | External docs injection |
| **Token Savings** | 99% (benchmarked) | ~95% (claimed) | 98% (claimed) | N/A |
| **Search** | BM25 + Trigram + Fuzzy | Basic recall | BM25 + Trigram + Fuzzy | Doc lookup |
| **LLM Calls** | None (free, deterministic) | Every observation ($$$) | None | None |
| **Knowledge Base** | 5 categories, relevance decay | No | No | No |
| **Budget Management** | Configurable limits + overflow | No | Basic throttling | No |
| **Event Tracking** | P1–P4, error-fix detection | No | Session events only | No |
| **Dashboard** | Real-time web UI | No | No | No |
| **Session Continuity** | Snapshot save/restore | Partial | Yes | No |
| **Content Types** | 14 specialized detectors | Generic LLM | Generic sandbox | Docs only |
| **Privacy** | Fully local, tag stripping | Local | Local | Cloud |
| **License** | MIT | AGPL-3.0 | Elastic v2 | Open |

## Quick Start

**Claude Code Plugin (recommended):**
```
/plugin marketplace add JubaKitiashvili/context-mem
/plugin install context-mem@context-mem
```

**npm (manual):**
```bash
npm install -g context-mem
cd your-project
context-mem init
context-mem serve
```

## Runtime Context Optimization (benchmark-verified)

| Mechanism | How it works | Savings |
|---|---|---|
| **Content summarizer** | Auto-detects 14 content types, produces statistical summaries | **97–100%** per output |
| **Index + Search** | FTS5 BM25 retrieval returns only relevant chunks, code preserved exactly | **80%** per search |
| **Smart truncation** | 4-tier fallback: JSON schema → Pattern → Head/Tail → Binary hash | **83–100%** per output |
| **Session snapshots** | Captures full session state in <2 KB | **~50%** vs log replay |
| **Budget enforcement** | Throttling at 80% prevents runaway token consumption | Prevents overflow |

**Result:** In a full coding session, **99% of tool output tokens are eliminated** — leaving 99.6% of your context window free for actual problem solving. See **[BENCHMARK.md](docs/benchmarks/results.md)** for complete results.

### Headline Numbers

| Scenario | Raw | Compressed | Savings |
|---|---|---|---|
| Full coding session (50 tools) | 365.5 KB | 3.2 KB | **99%** |
| 14 content types (555.9 KB) | 555.9 KB | 5.6 KB | **99%** |
| Index + Search (6 scenarios) | 38.9 KB | 8.0 KB | **80%** |
| BM25 search latency | — | 0.3ms avg | **3,342 ops/s** |
| Trigram search latency | — | 0.008ms avg | **120,122 ops/s** |

<sup>Verified on Apple M3 Pro, Node.js v22.22.0, 555.9 KB real-world test data across 21 scenarios.</sup>

## What Gets Compressed

14 summarizers detect content type automatically and apply the optimal compression:

| Content Type | Example | Strategy |
|---|---|---|
| Shell output | npm install, build logs | Command + exit code + error extraction |
| JSON | API responses, configs | Schema extraction (keys + types, no values) |
| Errors | Stack traces, crashes | Error type + message + top frames |
| Test results | Jest, Vitest | Pass/fail/skip counts + failure details |
| TypeScript errors | `error TS2345:` | Error count by file + top error codes |
| Build output | Webpack, Vite, Next.js | Routes + bundle sizes + warnings |
| Git log | Commits, diffs | Commit count + authors + date range |
| CSV/TSV | Data files, analytics | Row/column count + headers + aggregation |
| Markdown | Docs, READMEs | Heading tree + code blocks + links |
| HTML | Web pages | Title + nav + headings + forms |
| Network | HTTP logs, access logs | Method/status distribution |
| Code | Source files | Function/class signatures |
| Log files | App logs, access logs | Level distribution + error extraction |
| Binary | Images, compiled files | SHA256 hash + byte count |

## Features

**Search** — 3-layer hybrid: BM25 full-text → trigram fuzzy → Levenshtein typo-tolerant. Sub-millisecond latency with intent classification.

**Knowledge Base** — Save and search patterns, decisions, errors, APIs, components. Time-decay relevance scoring with automatic archival.

**Budget Management** — Session token limits with three overflow strategies: aggressive truncation, warn, hard stop.

**Event Tracking** — P1–P4 priority events with automatic error→fix detection.

**Session Snapshots** — Save/restore session state across restarts with progressive trimming.

**Dashboard** — Real-time web UI at `http://localhost:51893` — token economics, observations, search, knowledge base, events, system health.

<p align="center">
  <img src="docs/screenshots/dashboard-overview.png" width="600" alt="Dashboard — token economics and observation stats" />
</p>
<p align="center">
  <img src="docs/screenshots/dashboard-middle.png" width="600" alt="Dashboard — event stream, session snapshots, activity" />
</p>

**Privacy** — Everything local. `<private>` tag stripping, custom regex redaction. No telemetry, no cloud.

## Architecture

```
Tool Output → Hook Capture → Pipeline → Summarizer (14 types) → SQLite + FTS5
                                ↓                                      ↓
                          SHA256 Dedup                          3-Layer Search
                                ↓                                      ↓
                        4-Tier Truncation              Progressive Disclosure
                                                               ↓
                                                AI Assistant ← MCP Server
```

## MCP Tools

<details>
<summary>17 tools available via MCP protocol</summary>

| Tool | Description |
|---|---|
| `observe` | Store an observation with auto-summarization |
| `search` | Hybrid search across all observations |
| `get` | Retrieve full observation by ID |
| `timeline` | Reverse-chronological observation list |
| `stats` | Token economics for current session |
| `summarize` | Summarize content without storing |
| `configure` | Update runtime configuration |
| `execute` | Run code snippets (JS/Python) |
| `index_content` | Index content with code-aware chunking |
| `search_content` | Search indexed content chunks |
| `save_knowledge` | Save to knowledge base |
| `search_knowledge` | Search knowledge base |
| `budget_status` | Current budget usage |
| `budget_configure` | Set budget limits |
| `restore_session` | Restore session from snapshot |
| `emit_event` | Emit a context event |
| `query_events` | Query events with filters |

</details>

## CLI Commands

```bash
context-mem init        # Initialize in current project
context-mem serve       # Start MCP server (stdio)
context-mem status      # Show database stats
context-mem doctor      # Run health checks
context-mem dashboard   # Open web dashboard
```

## Configuration

<details>
<summary>.context-mem.json</summary>

```json
{
  "storage": "auto",
  "plugins": {
    "summarizers": ["shell", "json", "error", "log", "code"],
    "search": ["bm25", "trigram"],
    "runtimes": ["javascript", "python"]
  },
  "privacy": {
    "strip_tags": true,
    "redact_patterns": []
  },
  "token_economics": true,
  "lifecycle": {
    "ttl_days": 30,
    "max_db_size_mb": 500,
    "max_observations": 50000,
    "cleanup_schedule": "on_startup",
    "preserve_types": ["decision", "commit"]
  },
  "port": 51893,
  "db_path": ".context-mem/store.db"
}
```

</details>

## Documentation

| Doc | Description |
|---|---|
| [Benchmark Results](docs/benchmarks/results.md) | Full benchmark suite — 21 scenarios, 7 parts |
| [Configuration Guide](.context-mem.json.example) | All config options with defaults |

## Available On

- **npm** — `npm install -g context-mem`

## License

MIT — use it however you want.

## Author

[Juba Kitiashvili](https://github.com/JubaKitiworworashvili)

---

<p align="center">
  <b>context-mem — 99% less noise, 100% more context</b><br/>
  <a href="https://github.com/JubaKitiworworashvili/context-mem">Star this repo</a> · <a href="https://github.com/JubaKitiworworashvili/context-mem/fork">Fork it</a> · <a href="https://github.com/JubaKitiworworashvili/context-mem/issues">Report an issue</a>
</p>
