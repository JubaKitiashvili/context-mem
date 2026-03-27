---
name: context-optimization
description: "This skill should be used when context-mem is available in the project. Guides efficient use of context-mem's 18 MCP tools: observe large outputs, search before re-reading files, restore sessions, manage token budget, save knowledge with contradiction detection, execute code safely, emit events. Triggers on: large tool outputs, repeated file reads, session start, budget warnings, context window filling up, knowledge management, code execution requests."
version: 2.0.0
---

Use context-mem to compress large tool outputs, search stored observations before re-reading files, and persist knowledge across sessions. Provides 14 content-aware summarizers, 4-layer hybrid search (BM25 + Trigram + Levenshtein + Vector), and cross-session memory through MCP.

## Core Tools

### `observe` — After any large output (500+ tokens)
Store and compress content for later retrieval. Auto-summarizes based on content type. Built-in privacy engine auto-redacts secrets (AWS keys, GitHub tokens, JWTs, etc.) before storage.

```
observe(content: "<large output>", type: "log|code|error|test|commit|decision|context", source: "tool-name")
```

### `search` — Before re-reading files
Search stored observations first. Results are reranked by 70% relevance + 20% recency + 10% access frequency. Canonically identical queries return cached results (30s TTL).

```
search(query: "authentication error handler", type_filter: ["code", "error"], limit: 5)
```

### `get` — After finding results via search
Retrieve full observation content by ID. Never guess IDs — always get them from search or timeline first.

```
get(id: "<observation-id-from-search>")
```

### `restore_session` — At session start
Recover context from previous sessions. Session ID is optional — defaults to current session.

```
restore_session(session_id?: "<optional-specific-session>")
```

### `save_knowledge` — For reusable patterns (with contradiction detection)
Store decisions, error fixes, API patterns. Auto-checks for contradictions via keyword overlap AND semantic vector similarity (when available). Knowledge entries decay over time (14-day half-life) unless actively accessed. Explicit entries decay slower.

```
save_knowledge(category: "decision|error|pattern|api|component", title: "...", content: "...", tags: ["..."], source_type: "explicit|inferred|observed")
```

### `search_knowledge` — Search the knowledge base
Search knowledge entries by query with optional category filter.

```
search_knowledge(query: "auth pattern", category?: "pattern", limit?: 10)
```

### `update_profile` — Project quick profile
Update the 3-5 line project summary shown at every session start. Auto-generates from knowledge if no content provided.

```
update_profile(content?: "Tech: React Native\nFocus: insurance app")
```

### `budget_status` — When context feels heavy
Check token usage. If over 80%, save work and call restore_session.

```
budget_status()
```

### `execute` — Run code snippets
Execute code in 11 languages (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir). Sandboxed with env sanitization.

```
execute(code: "console.log('hello')", language: "javascript")
```

### `emit_event` / `query_events` — Event tracking
Log and query priority events (P1-P4) for session analysis.

```
emit_event(event_type: "error", data: { file: "auth.ts", message: "token expired" })
query_events(event_type?: "error", priority?: 1, limit?: 50)
```

## Additional Tools

- `summarize` — Compress content and return the summary without storing. Use when the result is needed inline but not for later retrieval (unlike `observe` which stores).
- `timeline` — Browse observations chronologically. Use `anchor` param to see context before/after a specific observation. Prefer over `search` when exploring what happened in sequence.
- `stats` — Token economy stats for the current session (observations stored, savings percentage, searches performed).
- `configure` — Update runtime config (e.g., `configure(key: "privacy.strip_tags", value: false)`). Changes persist for the session.
- `index_content` — Chunk and index source code for later search. Use on large files before searching them. Pairs with `search_content`.
- `search_content` — Search code previously indexed with `index_content`. Returns matching chunks with file context.
- `budget_configure` — Set session token limits and overflow strategy (`warn`, `truncate`, or `block`). Use at session start to set budget constraints.

## Rules

- ALWAYS `search` before `get` — never guess observation IDs
- ALWAYS `observe` outputs over 500 tokens — keep context clean
- NEVER call `get` without first finding the ID via `search` or `timeline`
- When `budget_status` shows >80%: save work, call `restore_session`
- When `save_knowledge` returns `contradictions` — review before proceeding, do NOT silently overwrite
- Use `source_type` when saving knowledge — trust: explicit > inferred > observed
- Knowledge entries have relevance decay — frequently accessed entries stay relevant longer

## Background Processes

The **Dreamer** background agent runs automatically (separate from the 14-day relevance decay in search results):
- Marks knowledge entries as stale after 30 days without access
- Auto-archives non-explicit entries after 90 days
- Detects potential contradictions between entries in the same category
- Explicit (`source_type: 'explicit'`) entries are never auto-archived

## Priority Order

1. `restore_session` — at session start
2. `search` — before reading files
3. `observe` — after large outputs
4. `save_knowledge` — for decisions and patterns
5. `update_profile` — when project context changes significantly
6. `budget_status` — periodically when context grows
