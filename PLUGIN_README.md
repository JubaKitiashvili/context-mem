# context-mem — Claude Code Plugin

Context optimization for AI coding assistants. Zero LLM calls, zero cloud, zero cost.

## What it does

- **14 content-aware summarizers** — compresses shell output, code, errors, logs, JSON, and more
- **4-layer search** — BM25 + Trigram + Levenshtein + optional Vector (semantic)
- **Observation reranking** — results weighted by 70% relevance + 20% recency + 10% access frequency
- **Activity journal** — tracks every edit, command, and file read across sessions
- **Knowledge base** — contradiction detection (keyword + semantic), source tracking, relevance decay
- **Dreamer background agent** — auto-validates, marks stale, archives old knowledge entries
- **Privacy engine** — auto-redacts AWS keys, GitHub tokens, JWTs, private keys, and more
- **Cross-session memory** — restores previous session context on startup
- **Token budget management** — tracks usage, warns at thresholds, auto-compresses
- **Code execution** — 11 languages with sandboxed env (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir)
- **Configurable search weights** — tune BM25/Trigram/Levenshtein/Vector ratios
- **Request canonicalization** — deduplicates similar search queries with 30s cache
- **Real-time dashboard** — http://localhost:51893

## Installation

```bash
/plugin install JubaKitiashvili/context-mem
```

Or for development:
```bash
claude --plugin-dir /path/to/context-mem
```

## Commands

| Command | Description |
|---------|-------------|
| `/context-mem:status` | Show stats, token savings, search capabilities |
| `/context-mem:search <query>` | Search stored observations |
| `/context-mem:journal` | Show activity journal from current and past sessions |

## How it works

### On every tool use (PostToolUse hooks)
1. **Activity Journal** — appends human-readable entry to `.context-mem/journal.md`
2. **Observation Capture** — sends tool output to MCP server for summarization and storage
3. **Privacy Engine** — auto-redacts secrets before storage

### On session start (SessionStart hook)
- Injects previous session's activity journal (edits, commands, files)
- Loads historical context from database (decisions, errors, knowledge)
- Shows project quick profile
- Shows dashboard link

### On session end (Stop hook)
- Saves session snapshot for future restoration
- Stops dashboard if running

### Background (Dreamer agent)
- Validates old knowledge entries periodically
- Marks entries stale after 30 days without access
- Archives non-explicit entries after 90 days
- Detects intra-category contradictions

### MCP Tools (18 available to Claude)
`observe`, `summarize`, `search`, `get`, `timeline`, `stats`, `configure`, `execute`, `index_content`, `search_content`, `save_knowledge`, `search_knowledge`, `update_profile`, `budget_status`, `budget_configure`, `restore_session`, `emit_event`, `query_events`

## Configuration

Edit `.context-mem.json` to customize:

```json
{
  "search_weights": { "bm25": 0.5, "trigram": 0.3, "levenshtein": 0.15, "vector": 0.05 },
  "privacy": {
    "strip_tags": true,
    "disabled_detectors": ["email", "ip_address"]
  }
}
```

## Optional: Semantic Search

Enable vector search to find "auth problem" when stored as "login token expired":

```bash
npm install @huggingface/transformers
```

Then add `"vector"` to search plugins in `.context-mem.json`.

22MB model downloads once, runs locally. No cloud, no API calls.
