# context-mem — Claude Code Plugin

Context optimization for AI coding assistants. Zero LLM calls, zero cloud, zero cost.

## What it does

- **14 content-aware summarizers** — compresses shell output, code, errors, logs, JSON, and more
- **4-layer search** — BM25 + Trigram + Levenshtein + optional Vector (semantic)
- **Activity journal** — tracks every edit, command, and file read across sessions
- **Cross-session memory** — restores previous session context on startup
- **Token budget management** — tracks usage, warns at thresholds, auto-compresses
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

### On session start (SessionStart hook)
- Injects previous session's activity journal (edits, commands, files)
- Loads historical context from database (decisions, errors, knowledge)
- Shows dashboard link

### On session end (Stop hook)
- Saves session snapshot for future restoration
- Stops dashboard if running

### MCP Tools (available to Claude)
`observe`, `search`, `get`, `timeline`, `stats`, `save_knowledge`, `search_knowledge`, `budget_status`, `budget_configure`, `restore_session`, `emit_event`, `query_events`

## Optional: Semantic Search

Enable vector search to find "auth problem" when stored as "login token expired":

```bash
npm install @huggingface/transformers
```

Then add `"vector"` to search plugins in `.context-mem.json`.

22MB model downloads once, runs locally. No cloud, no API calls.

## vs claude-mem

| | context-mem | claude-mem |
|---|---|---|
| LLM calls | 0 | Every observation |
| Cost | $0 | ~$57/month |
| Summarizers | 14 specialized | LLM-based |
| Search | 4-layer + vector | Basic recall |
| Dashboard | Real-time UI | Basic web view |
| Privacy | Local SQLite, fail-closed | Relies on provider |
| Model lock-in | None (MCP protocol) | Claude-only |
