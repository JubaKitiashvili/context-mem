<!-- Banner placeholder: dual-pillar visual — memory wiki page + compression savings chart -->

<p align="center">
  <img src="https://raw.githubusercontent.com/JubaKitiashvili/context-mem/main/docs/banner.svg" alt="Context Mem — memory + context infrastructure for AI agents" width="100%"/>
</p>

<div align="center">

# Context Mem

**Memory + context infrastructure for AI agents.**
Remembers everything. Compresses everything. Fully local.

[![npm version](https://img.shields.io/npm/v/context-mem)](https://www.npmjs.com/package/context-mem)
[![LongMemEval](https://img.shields.io/badge/LongMemEval-100%25%20(500%2F500)-gold)]()
[![Token savings](https://img.shields.io/badge/token%20savings-99%25-brightgreen)]()
[![tools](https://img.shields.io/badge/MCP%20tools-45+-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

## The Problem

Two problems with today's AI tooling that no one has solved together in a single package.

**Your AI forgets.** Every new session starts from zero. The architecture decisions you settled on last Thursday, the bug you spent four hours tracing to a misconfigured environment variable, the preferences you stated three times — none of it carries forward. You spend the first ten minutes of every session re-explaining context that already existed. Multiply this by every developer on your team, every project, every day.

**Your context explodes.** Long coding sessions blow past the context window. A typical session with 50 tool outputs accumulates 365 KB of raw text — stack traces, test output, file reads, shell commands. Every token costs money or slows the model. Naive truncation drops the exact evidence the model needs. Keeping everything makes responses slower and inference cost climb fast.

These two problems compound each other. The solution to forgetting (keep everything) is the opposite of the solution to context explosion (discard everything). The result is a false tradeoff most tools force on you: either your AI forgets everything, or your costs balloon. context-mem solves both simultaneously by building an indexed, compressed, retrievable memory store rather than dumping raw history into the context window.

---

## The Solution — one tool, two pillars

### Pillar 1: Memory (LLM Wiki)

Every tool call is automatically ingested, summarized, and written into a navigable markdown vault — a living wiki your AI maintains about your project. Entities get their own pages with backlinks. Topics get synthesis pages. Sessions become browseable source documents. Decisions accumulate into a reconstructible trail.

The vault lives at `.context-mem/vault/` and syncs continuously from the underlying SQLite store. Read it in Obsidian, grep it from the terminal, or query it through 45+ MCP tools using hybrid BM25 + vector + optional LLM judge search. The raw SQLite store is the authoritative record; the markdown vault is the derived, human-readable layer.

This is a reference implementation of Andrej Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — three layers (raw sources / wiki / schema), with automatic ingest from tool calls that no other system provides.

### Pillar 2: Compression (14 summarizers)

Every observation passes through a content-aware summarizer before storage. A stack trace is not treated the same way as a JSON config file. Shell output from a build is compressed differently from TypeScript compiler errors. The system applies the right compression for the content type.

The result: a full coding session with 50 tool outputs goes from 365 KB to 3.2 KB — **99.1% token savings**, verified. Compression is adaptive: recent high-importance observations stay verbatim; older low-importance ones compress progressively. Pinned entries never compress regardless of age.

---

## One Command

```bash
npm i context-mem && npx context-mem init
```

`init` auto-detects your editor and writes the right config files:

| Editor | Config written |
|---|---|
| **Claude Code** | `.mcp.json` + 8 hooks + CLAUDE.md |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/context-mem.mdc` |
| **Windsurf** | `.windsurf/mcp.json` + `.windsurf/rules/context-mem.md` |
| **VS Code / Copilot** | `.vscode/mcp.json` + `.github/copilot-instructions.md` |
| **Cline** | `.cline/mcp_settings.json` + `.clinerules/context-mem.md` |
| **Roo Code** | `.roo-code/mcp_settings.json` + `.roo/rules/context-mem.md` |
| **Aider** | `.aider.conf.yml` (MCP block) |
| **Continue** | `.continue/config.json` (MCP block) |
| **JetBrains AI** | `.idea/mcp.json` |

No API keys. No cloud account. No data leaves your machine.

---

## Dual-pillar in 60 seconds

[ placeholder: GIF or video — Claude Code session with split view showing Obsidian graph updating in real time alongside the context-mem dashboard token savings chart ]

---

## Architecture (reference implementation of Karpathy's LLM Wiki pattern)

```
                    ┌─────────────────────────────────────────┐
                    │            Raw Sources (immutable)       │
                    │  tool calls · observations · file reads  │
                    └──────────────────┬──────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │           Observation Pipeline           │
                    │                                          │
                    │  PrivacyEngine (9 detectors)             │
                    │    → 14 content-aware summarizers        │
                    │    → entity extraction (100+ aliases)    │
                    │    → topic detection                     │
                    │    → importance scoring (0.0–1.0)        │
                    │    → adaptive compression tier           │
                    └────────────────┬────────────────────────┘
                                     │
                   ┌─────────────────┴───────────────────┐
                   │                                     │
                   ▼                                     ▼
    ┌──────────────────────────┐       ┌─────────────────────────────┐
    │    SQLite (primary)      │       │   Markdown Vault (derived)  │
    │                          │       │                             │
    │  observations            │──────▶│  .context-mem/vault/        │
    │  entities + graph        │  sync │    index.md                 │
    │  knowledge               │       │    log.md                   │
    │  events                  │       │    sources/<session>.md     │
    │  FTS5 index              │       │    entities/<name>.md       │
    │  vector embeddings       │       │    topics/<name>.md         │
    └──────────────────────────┘       │    knowledge/<id>.md        │
                   │                   └─────────────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────────────────────────────┐
    │              Hybrid Retrieval                                │
    │                                                              │
    │  BM25 (8 strategies + synonym expansion)                     │
    │  + Vector (nomic-embed-text-v1.5, 768-dim)                   │
    │  + Trigram + Levenshtein                                     │
    │  → Fusion (intent-adaptive weights, IDF reranker)            │
    │  → Optional LLM judge (Haiku, 50/50 blend, 100% R@5)        │
    └──────────────────────────────────────────────────────────────┘
```

**Three layers (per Karpathy):**

- **Raw sources** — your tool call outputs, file reads, shell commands, observations. Written once, never modified. The permanent record.
- **The wiki** — LLM-maintained markdown vault (`.context-mem/vault/`). Auto-synced from SQLite. Human-readable, Obsidian-compatible, grep-friendly. Entity pages, topic pages, session pages, knowledge pages, index, event log.
- **Schema** — [`docs/llm-wiki-schema.md`](llm-wiki-schema.md) governs page structure, linking conventions, agent workflow recipes, and interop contract. Public spec — other tools can emit conforming wikis.

The distinction from most memory systems: context-mem is **not** replacing SQLite with markdown. SQLite is authoritative — it is where observations are stored, searched, and indexed. The vault is the browseable, linkable, diffable surface on top of it — the layer a human or LLM can navigate without a database client. If you delete the vault directory, you lose nothing that matters. If you edit a vault page manually, those edits are preserved and not overwritten on the next sync.

This is the Karpathy three-layer model applied to a running AI development environment: immutable inputs, a maintained synthesis layer, and a public schema that governs the synthesis. The vault can be used independently of the MCP tools — it is just a directory of markdown files. Open it in any editor. Put it in git. Diff it across commits. Use it as long-form context by copy-pasting pages into a new conversation. The MCP tools are the automated path; the markdown vault is the portable, durable, human-readable path.

---

## Retrieval benchmarks (honest methodology)

All scores are **session-level retrieval recall**: did any correct evidence session appear in the top-k results? This is different from end-to-end QA accuracy (retrieve + generate + judge), which is harder and lower for every system. Both measurements are published here.

### Pure local (zero API calls, fully free)

| Benchmark | Retrieval Recall | E2E QA Accuracy | Questions | Sessions |
|---|---|---|---|---|
| **LongMemEval** | **97.8% R@5** | _published post-v3.4_ | 500 | ~53/conv |
| **LoCoMo** | **98.1% R@10** | _published post-v3.4_ | 1,977 | 19-35/conv |
| **MemBench** | **98.0% R@5** | — | 500 | — |
| **ConvoMem** | **97.7% R@10** | — | 250 | — |

### With optional LLM reranking (~$1 per 500 queries)

| Benchmark | Retrieval Recall |
|---|---|
| **LongMemEval** | **100.0% R@5** (500/500) |

The LLM judge (Claude Haiku) scores the top-N BM25+vector candidates 0–10 and blends 50/50 with the retrieval score. Activates when `ai_curation.enabled = true`. Adds ~$0.002 per query at Haiku pricing.

**Methodology notes:**

- A "hit" is scored if any correct evidence session appears in top-k. Not end-to-end QA.
- LoCoMo benchmark appends dataset-provided metadata (session_summary, observation, event_summary) to session documents — the production system applies equivalent enrichment via summarizers and entity extraction.
- Synonym expansions: core query-builder includes general-vocabulary synonyms (movie → film, sibling → brother). Results without any synonym expansion are ~1-2% lower.
- All benchmark code is open and runnable: `npm run bench`. See [`benchmarks/`](../benchmarks/).

_Full methodology: [`docs/benchmarks/methodology.md`](benchmarks/methodology.md) (published with v3.4)._

---

## Compression benchmarks (verified)

| Scenario | Raw | Compressed | Savings |
|---|---|---|---|
| Typical coding session (50 tool outputs) | 365 KB | 3.2 KB | **99.1%** |

**Per-summarizer breakdown:**

| Summarizer | Compression ratio |
|---|---|
| Log output | 97% |
| Errors | 95% |
| Shell / CLI | ~95% |
| Code | 92% |
| JSON | 89% |
| TS compiler errors | ~88% |
| Tests | ~85% |
| Build output | ~94% |
| Git logs | ~90% |
| HTML | ~92% |
| Markdown | ~75% |
| CSV | ~80% |
| Network responses | ~88% |
| Binary (hex dumps) | ~98% |

Compression is lossless at the semantic level for high-importance observations (DECISION, MILESTONE, PROBLEM flags) — those stay verbatim regardless of age. Compression applies to routine tool output.

---

## Core features

### Memory

- **LLM Wiki substrate** — markdown vault at `.context-mem/vault/`, auto-synced from SQLite. Entity pages, topic pages, session source pages, knowledge pages, index.md, log.md. Obsidian-compatible, grep-friendly.
- **14 content-aware summarizers** — JSON, shell, code, logs, errors, TS errors, tests, builds, git logs, HTML, markdown, CSV, binary, network. Each tuned for its content type.
- **Adaptive 4-tier compression** — verbatim (0–7 days) → light (7–30 days) → medium (30–90 days) → distilled (90 days+). Pinned entries stay verbatim forever.
- **Knowledge graph** — typed entity-relationship model: files, modules, patterns, decisions, bugs, people, libraries, services, APIs, configs. Traversable via `graph_query`, `graph_neighbors`, `add_relationship`.
- **Temporal facts** — `valid_from`/`valid_to` on all knowledge entries. Supersession chains. `temporal_query` answers "what was true about X at time T?"
- **Decision trail reconstruction** — `explain_decision` walks the evidence chain backward: file reads → errors → searches → the decision. Full provenance.
- **Entity intelligence** — auto-detect technologies, people, file paths, CamelCase identifiers, ALL_CAPS constants. 100+ canonical aliases (React.js → React, Node → Node.js, etc.).
- **Session narratives** — 4 ready-made templates: PR description, standup update, ADR, onboarding guide. `context-mem story --format pr`.
- **Wake-up primer** — token-budgeted context injection at session start. 4 layers: project profile (15%), critical knowledge (40%), recent decisions (30%), top entities (15%).
- **Per-prompt injection** — UserPromptSubmit hook auto-injects relevant memories on every message. Rate-limited, topic-deduplicated. Zero manual commands.

### Compression

- **14 content-aware summarizers** — not one-size-fits-all. A stack trace gets different treatment than a JSON response.
- **Pinned verbatim preservation** — decisions, milestones, and manually-pinned observations never compress.
- **Priority-tiered truncation cascade** — if the context budget is exceeded, lower-importance items are compressed first. High-importance items survive.
- **Configurable token budget** — three overflow strategies: compress oldest, compress lowest-importance, or hard truncate.
- **365 KB → 3.2 KB** — verified on a typical 50-tool-output coding session.

### Both

- **Hybrid search** — BM25 (8 strategies + synonym expansion) + vector (nomic-embed-text-v1.5, 768-dim) + trigram + Levenshtein run in parallel, fused via intent-adaptive weights with IDF-weighted content reranking. Optional LLM judge reranker.
- **Temporal resolver** — deterministic parsing for relative date queries ("3 days ago", "last Saturday", "last week"). Zero LLM cost. Returns absolute date range with confidence level.
- **45+ MCP tools** — observe, search, recall, ask, timeline, knowledge graph, entity detection, temporal query, session handoff, multi-agent coordination, token budget, dashboard, diagnostics, and more.
- **Fully local, zero cloud** — SQLite on your machine. No telemetry. No API keys required for core functionality.
- **9-detector privacy engine** — strips `<private>` tags, applies custom regex redactions, detects API keys, tokens, passwords, PII patterns. Nothing sensitive leaves your machine.
- **Sub-millisecond operations** — importance classification at 556K ops/s, entity extraction at 179K ops/s, BM25 search at 3.3K ops/s, all local.

---

## How it compares

The memory space has multiple incumbents. The context-compression space has a few more. No other tool addresses both axes together.

| | **context-mem v4** | Mem0 | Graphiti | Zep | Letta |
|---|---|---|---|---|---|
| **LLM Wiki / markdown vault** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Auto-ingest from tool calls** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Retrieval recall (local)** | 97.8–98.1% R@k | not published | not published | not published | not published |
| **Token compression** | 99.1% | ❌ | ❌ | ❌ | partial |
| **Typed knowledge graph** | ✅ | ✅ | ✅ | partial | partial |
| **Temporal graph queries** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Hybrid BM25 + vector + LLM rerank** | ✅ | partial | ❌ | partial | ❌ |
| **Fully local (no cloud required)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Decision trail reconstruction** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Obsidian-compatible output** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **MCP tools** | 45+ | some | some | some | some |
| **License** | MIT | Apache/cloud | Apache | Apache | Apache |

**Notes on this table:** Retrieval recall figures for Mem0, Graphiti, Zep, and Letta are not published against the same benchmarks (LongMemEval, LoCoMo, MemBench, ConvoMem) at session-level retrieval recall using a methodology comparable to ours. If published numbers exist in their docs, they are for different datasets, different granularity (chunk-level vs. session-level), or with undisclosed infrastructure. Do not compare them directly. E2E QA numbers for context-mem will be published with v3.4. All other comparisons are based on public documentation as of April 2026.

The "token compression" row deserves a note: Mem0, Graphiti, and Zep are primarily retrieval systems — they do not claim to solve the context-window cost problem. Letta has partial compression via summarization. context-mem's 99.1% figure is measured on a real coding session (50 tool outputs, 365 KB → 3.2 KB). The measurement is reproducible: you can run it yourself against your own project by comparing `context-mem stats --raw` vs `context-mem stats --compressed`.

---

## Real-world examples

```
You: "Why did we choose Postgres over MySQL?"
→ recall returns the exact verbatim quote from March 15 (importance 0.95)
  with the full evidence chain: error → file_read → search → decision

You: "What did Sarah work on last sprint?"
→ browse by person shows 14 observations mentioning Sarah,
  grouped by topic (auth, database, deployment)

You: "What are we about to forget?"
→ predict_loss shows 8 entries at risk: low importance, 45+ days old,
  never accessed. Pin the critical ones before they decay.

You: "Generate a PR description for this branch"
→ context-mem story --format pr assembles changes, decisions,
  resolved issues, and test plan from the current session

You: "What was our database schema in January?"
→ temporal_query returns what was true about the schema at that point
  in time, including since-superseded knowledge
```

---

## Get started

### 1. Install

```bash
npm i context-mem && npx context-mem init
```

`init` creates the right MCP config for your editor. No IDE restart required for Claude Code. For Cursor, Windsurf, and VS Code, restart the IDE after init.

### 2. Configure MCP (manual option)

If you prefer to configure manually, add to your MCP config:

```json
{
  "mcpServers": {
    "context-mem": {
      "command": "npx",
      "args": ["context-mem", "serve"],
      "env": {}
    }
  }
}
```

For Claude Code specifically, `init` also writes 8 hooks into `.claude/settings.json` that auto-inject relevant memories on every prompt submission — no manual `observe` calls needed during normal development.

### 3. Enable the LLM Wiki vault (v3.4+ opt-in)

Add to your `context-mem` config (`.context-mem/config.json`):

```json
{
  "vault": {
    "enabled": true,
    "vaultDir": ".context-mem/vault"
  }
}
```

The vault directory will auto-populate on the next observation ingest. Open `.context-mem/vault/` in Obsidian to browse the graph view of your project's knowledge.

The vault is opt-in in v3.4 and will be default-on in v4.0.

### 4. Dashboard

```bash
context-mem dashboard
```

Opens a local web UI on `http://localhost:3141` with 6 pages: Intelligence Overview, Knowledge Graph, Topics, Timeline, Entities, and Diagnostics.

### 5. Benchmarks (run them yourself)

```bash
npm run bench          # quick mode (all 4 benchmarks, sample sizes)
npm run bench:full     # full benchmarks
npm run bench:e2e-qa   # E2E QA: retrieve → Haiku answer → Haiku judge
```

All benchmark code is open. No hidden adapters that inflate numbers. See [`benchmarks/`](../benchmarks/) and [`docs/benchmarks/methodology.md`](benchmarks/methodology.md).

---

## MCP tools reference (45+)

context-mem exposes its entire surface area as MCP tools — no proprietary SDK, no wrapper library, no lock-in. Any MCP-capable host (Claude Code, Cursor, Windsurf, VS Code, Cline, Roo Code, Aider, Continue, JetBrains AI, CrewAI, LangChain, AutoGen) can use these tools directly. There are no "premium" tools behind a paywall and no features that require a cloud subscription. Every capability listed in this README is available via the open MCP interface.

**Core memory tools:**

| Tool | Purpose |
|---|---|
| `observe` | Store observation with auto-summarization, importance scoring, entity extraction, topic detection |
| `recall` | Retrieve verbatim content by filter (importance, type, flag, time) |
| `search` | Hybrid search (BM25 + vector + optional LLM judge) |
| `ask` | Natural language Q&A over the full memory store |
| `timeline` | Reverse-chronological observations with importance badges and flags |
| `stats` | Token economics for current session (raw vs. compressed) |

**Knowledge graph tools:**

| Tool | Purpose |
|---|---|
| `save_knowledge` | Save a knowledge entry with contradiction detection + temporal validity windows |
| `search_knowledge` | Search (superseded entries filtered by default) |
| `promote_knowledge` | Promote to global cross-project store |
| `global_search` | Search across all projects simultaneously |
| `resolve_contradiction` | Resolve knowledge conflicts (supersede / merge / keep / archive) |
| `merge_suggestions` | View cross-project duplicate suggestions |
| `graph_query` | Traverse entity relationships |
| `add_relationship` | Link entities with typed relationships |
| `graph_neighbors` | Find connected entities (configurable depth) |

**Temporal and intelligence tools:**

| Tool | Purpose |
|---|---|
| `temporal_query` | Query what was true at a specific point in time |
| `time_travel` | Compare project state at two arbitrary timestamps |
| `explain_decision` | Walk evidence chain backward to reconstruct why a decision was made |
| `predict_loss` | Identify observations at risk of compression/deletion |
| `generate_story` | Generate PR description, standup update, ADR, or onboarding guide |
| `entity_detect` | Detect entities in arbitrary text |
| `find_tunnels` | Find cross-project topic connections |

**Session and agent tools:**

| Tool | Purpose |
|---|---|
| `wake_up` | Token-budgeted context primer for session start |
| `restore_session` | Restore session from checkpoint |
| `handoff_session` | Cross-session continuity package |
| `agent_register` | Register an agent with role and capabilities |
| `agent_status` | Check all active agents and their claimed resources |
| `claim_files` | Claim files to prevent parallel-agent conflicts |
| `agent_broadcast` | Broadcast a finding to all agents in the project |

**System tools:**

| Tool | Purpose |
|---|---|
| `configure` | Update runtime configuration |
| `budget_status` / `budget_configure` | Token budget management |
| `summarize` | Summarize content without storing (one-shot) |
| `execute` | Run code (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir) |
| `index_content` | Index with code-aware chunking |
| `search_content` | Search indexed chunks |
| `list_people` / `list_topics` | Browse entities and topics |
| `import_conversations` | Import conversation history |
| `browse` | Retrieve observations by person, entity, or topic |
| `diagnostics` | Error log, pipeline stats, storage health |

---

## Diagnostic API

If you need to inspect what the system is doing:

```bash
# MCP tool
mcp__context-mem__diagnostics

# HTTP (when dashboard is running)
curl http://localhost:3141/api/diagnostics
```

Returns error log, pipeline stats, active session, storage health, search index state.

---

## Multi-agent support

context-mem supports parallel AI agents working on the same project without collisions:

```typescript
// Agent A registers and claims a file
mcp__context-mem__agent_register({ agent_id: "agent-a", role: "backend" })
mcp__context-mem__claim_files({ files: ["src/api.ts"] })

// Agent B sees Agent A's claim and avoids the conflict
mcp__context-mem__agent_status({})
// → { "agent-a": { files: ["src/api.ts"], status: "active" } }

// Broadcast a finding to all agents
mcp__context-mem__agent_broadcast({ message: "auth module has a race condition on token refresh" })
```

Shared memory prevents duplicate work. Claimed files prevent merge conflicts. Broadcast keeps all agents synchronized on discoveries.

---

## Architecture reference: search pipeline

The retrieval stack runs 8 BM25 strategies in parallel, each with different weight and precision/recall tradeoff:

| Strategy | Weight | Purpose |
|---|---|---|
| AND-mode | 2.0 | High precision, all terms required |
| Phrase matching | 1.9 | Consecutive keyword pairs |
| Entity-focused | 1.8 | Proper nouns, dates, identifiers |
| Sanitized FTS5 | 1.5 | Default tokenization |
| Relaxed AND | 1.2 | Entity + top keywords |
| OR-mode + synonyms | 1.0 | Broad recall with semantic expansion |
| Individual keywords | 0.5 | Long-tail catch |
| Individual synonyms | 0.2 | Semantic gap bridge (sibling → brother) |

Plus temporal resolution (weight 1.6): relative date queries ("last Saturday") are resolved to absolute date ranges deterministically before search — zero LLM cost.

Vector search (nomic-embed-text-v1.5, 768-dim) runs in parallel with BM25 on the top-30 candidates, not in cascade. Results are fused via intent-adaptive weights (BM25: 0.45, trigram: 0.15, Levenshtein: 0.05, vector: 0.35) with IDF-weighted content reranking. Optional LLM judge blends 50/50 with retrieval score on the final top-N.

---

## LLM Wiki schema

The vault follows a documented schema at [`docs/llm-wiki-schema.md`](llm-wiki-schema.md). It specifies:

- Directory layout (`sources/`, `entities/`, `topics/`, `knowledge/`)
- Page types and frontmatter conventions
- Linking syntax (`[[entity-name]]` resolves to `entities/entity-name.md`)
- Operations: ingest / query / lint
- Agent workflow recipes for CLAUDE.md / AGENTS.md
- Interop contract — other tools can emit conforming wikis that context-mem can import

This is a public spec. Community RFCs at [github.com/JubaKitiashvili/context-mem/discussions](https://github.com/JubaKitiashvili/context-mem/discussions).

---

## Performance characteristics

All core operations are synchronous and sub-millisecond. No LLM required for any default operation.

| Operation | Throughput | Latency |
|---|---|---|
| Importance classification | 556K ops/s | 0.002ms |
| Entity extraction | 179K ops/s | 0.006ms |
| Topic detection | 162K ops/s | 0.006ms |
| Compression tier calculation | 3M ops/s | <0.001ms |
| Verbatim FTS5 search | 50K ops/s | 0.020ms |
| BM25 hybrid search | 3.3K ops/s | 0.3ms |
| Wake-up primer assembly | 9K ops/s | 0.111ms |
| Narrative generation | 6K ops/s | 0.164ms |

Vector embedding (nomic-embed-text-v1.5) adds ~5–15ms per query when vector search is enabled — still faster than any network call. The optional LLM judge adds one Haiku API call (~100ms) and is only invoked when `ai_curation.enabled = true`.

---

## Changelog highlights

- **v4.0.0** — Full LLM Wiki release. Synthesis pages, Obsidian plugin, 8 IDE integrations, Context Protocol RFC, compression polish. Target 2026-05-22.
- **v3.4.0** — LLM Wiki Preview. Markdown vault layer, schema spec v1, E2E QA benchmark, issue #6 closed (benchmark methodology disclosure).
- **v3.3.0** — Foundations. CI, error log, diagnostics. Silent patch.
- **v3.2.0** — Hybrid parallel search. BM25 + vector in parallel, intent-adaptive fusion.
- **v2.5.0** — Dashboard. Real-time web UI, knowledge graph visualization.

---

## License: MIT

Built by [Juba Kitiashvili](https://github.com/JubaKitiashvili).

Credit: Andrej Karpathy for the [LLM Wiki framing](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (2026-04-04). Vannevar Bush for [Memex](https://www.theatlantic.com/magazine/archive/1945/07/as-we-may-think/303881/) (1945).
