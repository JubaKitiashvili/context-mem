# context-mem Integration

context-mem is active in this project. It compresses tool outputs via 14 content-aware summarizers (99% token savings) and serves optimized context through MCP.

## Automatic Behaviors

- On session start, call `restore_session` to recover prior context
- After large outputs (file reads, terminal output, search results), call `observe` with the content to compress and store it
- Before re-reading files, call `search` first — the answer may already be in context-mem
- When learning project patterns, call `save_knowledge` to persist decisions, error fixes, API patterns
- Periodically call `budget_status` to check token usage

## Available MCP Tools

- `observe` — store and compress content (auto-summarized)
- `search` / `get` / `timeline` — retrieve stored context
- `stats` — view compression statistics
- `save_knowledge` / `search_knowledge` — persistent knowledge base
- `budget_status` / `budget_configure` — token budget management
- `emit_event` / `query_events` — event tracking
- `restore_session` — session continuity
