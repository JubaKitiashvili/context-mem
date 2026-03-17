# context-mem — Context Optimization

context-mem is active in this project. It automatically captures tool outputs, compresses them via 14 content-aware summarizers, and serves optimized context back through MCP.

## What it does
- Captures Bash, Read, Write, Edit, Grep, Glob outputs via hooks
- Compresses content (99% token savings) using specialized summarizers
- Provides search, knowledge base, budget tracking, and session continuity
- Runs a real-time dashboard at http://localhost:51893

## Available MCP tools
- `observe` / `search` / `get` / `timeline` / `stats` — core context operations
- `save_knowledge` / `search_knowledge` — persistent knowledge base
- `budget_status` / `budget_configure` — token budget management
- `emit_event` / `query_events` — event tracking
- `restore_session` — session continuity
