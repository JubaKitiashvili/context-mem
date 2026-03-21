---
name: context-optimization
description: "Activates when context-mem is available in the project. Guides efficient use of context-mem's MCP tools: observe large outputs, search before re-reading files, restore sessions, manage token budget. Triggers on: large tool outputs, repeated file reads, session start, budget warnings, context window filling up."
version: 1.0.0
---

context-mem is active in this project. It compresses tool outputs via content-aware summarizers and serves optimized context through MCP.

## When to Use context-mem Tools

### `observe` — After any large output (500+ tokens)
Store and compress content for later retrieval. Automatically summarizes based on content type.

```
observe(content: "<large output>", type: "log|code|error|test|commit|decision|context", source: "tool-name")
```

### `search` — Before re-reading files
Always search stored observations first. May already have the answer without reading files again.

```
search(query: "authentication error handler", type_filter: ["code", "error"], limit: 5)
```

### `get` — After finding results via search
Retrieve full observation content by ID. Never guess IDs — always get them from search or timeline first.

```
get(id: "<observation-id-from-search>")
```

### `restore_session` — At session start
Recover context from previous sessions. Call this early to avoid re-reading files.

```
restore_session(session_id: "<optional-specific-session>")
```

### `budget_status` — When context feels heavy
Check token usage. If over 80%, call restore_session to save state and reclaim context.

```
budget_status()
```

### `save_knowledge` — For reusable patterns (with contradiction detection)
Store decisions, error fixes, API patterns in the persistent knowledge base. Automatically checks for contradictions with existing entries.

```
save_knowledge(category: "decision|error|pattern|api|component", title: "...", content: "...", tags: ["..."], source_type: "explicit|inferred|observed")
```

**source_type:** `explicit` = user stated directly, `inferred` = AI derived from context, `observed` = captured automatically

### `update_profile` — Project quick profile
Update the 3-5 line project summary shown at every session start. Auto-generates from knowledge if no content provided.

```
update_profile(content?: "Tech: React Native\nFocus: insurance app")
```

## Rules

- ALWAYS `search` before `get` — never guess observation IDs
- ALWAYS `observe` outputs over 500 tokens — keep context clean
- NEVER call `get` without first finding the ID via `search` or `timeline`
- When `budget_status` shows >80%: save work, call `restore_session`
- When `save_knowledge` returns `contradictions` — review before proceeding, do NOT silently overwrite
- Use `source_type` when saving knowledge — trust: explicit > inferred > observed

## Priority Order

1. `restore_session` — at session start
2. `search` — before reading files
3. `observe` — after large outputs
4. `save_knowledge` — for decisions and patterns
5. `update_profile` — when project context changes significantly
6. `budget_status` — periodically when context grows
