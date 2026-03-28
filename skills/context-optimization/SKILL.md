---
name: context-optimization
description: "This skill should be used when context-mem is available in the project. Guides efficient use of context-mem's 29 MCP tools: observe large outputs, search before re-reading files, restore sessions, manage token budget, save knowledge with contradiction detection, promote knowledge to global cross-project store, search across all projects, execute code safely, emit events, time travel through project history, ask natural language questions, coordinate multi-agent sessions. Triggers on: large tool outputs, repeated file reads, session start, budget warnings, context window filling up, knowledge management, cross-project knowledge transfer, global search, code execution requests, time travel, show project state, ask question, natural language query, register agent, claim files, agent status, knowledge graph, graph query, entity relationships, add relationship, graph neighbors."
version: 2.1.1
---

Use context-mem to compress large tool outputs, search stored observations before re-reading files, and persist knowledge across sessions. Leverage its 14 content-aware summarizers (plus community plugins), 4-layer hybrid search (BM25 + Trigram + Levenshtein + Vector), cross-session memory, and cross-project knowledge transfer through 29 MCP tools. Dashboard receives real-time updates via WebSocket.

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
Store decisions, error fixes, API patterns. Auto-checks for contradictions via keyword overlap AND semantic vector similarity (when available). Note that knowledge entries decay in search ranking (14-day half-life) unless actively accessed. Explicit entries decay slower.

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

### `time_travel` — View/compare project state at any point in time
Parse relative dates ("3 days ago", "last week") or absolute timestamps. Compare then vs now to see what changed.

```
time_travel(target: "3 days ago")
time_travel(target: "2025-12-01", compare: true)
```

### `ask` — Natural language questions about the project
Intent classification (what/when/who/why/how) with parallel search across knowledge, observations, events, and graph.

```
ask(question: "why did we switch from REST to GraphQL?")
ask(question: "what changed in the auth module last week?")
```

## Additional Tools

- `summarize` — Compress content and return the summary without storing. Use when the result is needed inline but not for later retrieval (unlike `observe` which stores).
- `timeline` — Browse observations chronologically. Use `anchor` param to see context before/after a specific observation. Prefer over `search` when exploring what happened in sequence.
- `stats` — Token economy stats for the current session (observations stored, savings percentage, searches performed).
- `configure` — Update runtime config (e.g., `configure(key: "privacy.strip_tags", value: false)`). Changes persist for the session.
- `index_content` — Chunk and index source code for later search. Use on large files before searching them. Pairs with `search_content`.
- `search_content` — Search code previously indexed with `index_content`. Returns matching chunks with file context.
- `budget_configure` — Set session token limits and overflow strategy (`warn`, `truncate`, or `block`). Use at session start to set budget constraints.
- `promote_knowledge` — Promote a project knowledge entry to the global cross-project store. Privacy engine auto-redacts secrets before storing. Use for patterns that apply across multiple projects.
- `global_search` — Search the global cross-project knowledge store. Returns entries promoted from any project, with source project tracking.
- `agent_register` — Register current session as a named agent for multi-agent coordination. Provides identity for file claims and broadcasts.
- `agent_status` — List all active agents, their current tasks, and claimed files. Use to see what other agents are working on before starting a task.
- `claim_files` — Claim files being worked on to prevent conflicts with other agents. Detects and reports conflicts if another agent already claimed the same file.
- `agent_broadcast` — Send priority messages to all active agents via the event system. Use for important findings, blockers, or coordination signals.
- `graph_query` — Query entities and their relationships. Filter by entity type, relationship type, direction (`in`/`out`/`both`), and traversal depth (1-5).
- `add_relationship` — Create a relationship between two entities. Auto-creates entities if missing. Accepts optional weight (0-1).
- `graph_neighbors` — Find all entities connected to a given entity. Faster than `graph_query` for simple one-hop lookups.

## Multi-Agent Coordination

When multiple agents work on the same project simultaneously:

- Register as a named agent when working on a specific task (`agent_register`)
- Claim files before editing to prevent conflicts (`claim_files`)
- Check `agent_status` to see what others are doing before starting work
- Broadcast important findings to all agents (`agent_broadcast`)

## Rules

- ALWAYS `search` before `get` — never guess observation IDs
- ALWAYS `observe` outputs over 500 tokens — keep context clean
- NEVER call `get` without first finding the ID via `search` or `timeline`
- When `budget_status` shows >80%: save work, call `restore_session`
- When `save_knowledge` returns `contradictions` — review before proceeding, do NOT silently overwrite
- Use `source_type` when saving knowledge — trust: explicit > inferred > observed
- Expect knowledge entries to have relevance decay — frequently accessed entries stay relevant longer

## Activity Journal

The PostToolUse hook automatically logs every edit, command, and file read to `.context-mem/journal.md`. This journal persists across sessions and is injected at session start for continuity.

## Background Processes

The **Dreamer** background agent runs automatically (separate from the 14-day relevance-decay half-life used in search ranking):
- Marks knowledge entries as stale after 30 days without access
- Auto-archives non-explicit entries after 90 days
- Detects potential contradictions between entries in the same category
- Explicit (`source_type: 'explicit'`) entries are never auto-archived

## Dashboard 2.0

The dashboard now includes: knowledge graph visualization, timeline explorer, agent panel for monitoring multi-agent sessions, and dark theme support.

## Priority Order

1. `restore_session` + `budget_configure` — at session start
2. `search` — before reading files
3. `observe` — after large outputs
4. `save_knowledge` — for decisions and patterns
5. `update_profile` — when project context changes significantly
6. `budget_status` — periodically when context grows
