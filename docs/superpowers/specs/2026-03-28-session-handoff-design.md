# Session Handoff & Context Continuity System

**Date:** 2026-03-28
**Version:** context-mem v2.1.0
**Status:** Design approved
**Related:** [GitHub Issue — Context Window Usage Exposure](https://github.com/anthropics/claude-code/issues/...)

## Problem Statement

Two core problems degrade AI coding assistant effectiveness:

1. **"Who am I?" problem** — New sessions have zero context about previous work. `restore_session` partially addresses this but requires manual invocation and is limited to 8KB snapshots.

2. **"I'm fading" problem** — Mid-session context exhaustion causes silent quality degradation. Auto-compaction discards context that may still be relevant, and there's no recovery mechanism.

## Design Goals

- Sessions form chains — each session knows its predecessor and can restore continuity
- Token usage is estimated with tool-specific accuracy (not just observation bytes)
- PreCompact events trigger automatic state preservation
- Post-compaction context recovery injects critical state back automatically
- New sessions auto-restore from recent predecessors (configurable threshold)
- `/context-mem-handoff` generates human-readable continuation prompts
- All commands use `context-mem-` prefix for discoverability

## Non-Goals

- Real context window token count from the harness (requires Anthropic API changes)
- Dashboard visualization (future work, after core stabilizes)
- Cross-machine session sync

---

## Architecture

### 1. Session Chain Model

New `session_chains` table linking sessions into ordered chains:

```sql
CREATE TABLE session_chains (
  chain_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  parent_session TEXT,
  project_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handoff_reason TEXT NOT NULL DEFAULT 'auto',
  summary TEXT,
  token_estimate INTEGER DEFAULT 0,
  PRIMARY KEY (chain_id, session_id),
  FOREIGN KEY (parent_session) REFERENCES session_chains(session_id)
);

CREATE INDEX idx_chains_session ON session_chains(session_id);
CREATE INDEX idx_chains_parent ON session_chains(parent_session);
CREATE INDEX idx_chains_created ON session_chains(created_at);
CREATE INDEX idx_chains_project ON session_chains(project_path);
```

**`handoff_reason` values:**
- `auto` — SessionStart detected recent predecessor
- `manual` — User invoked `/context-mem-handoff`
- `compaction` — PreCompact hook triggered
- `session_end` — Session ended normally (Stop hook)

**`summary`** — 1-2 sentence description of what was accomplished in the session. Generated from snapshot data: completed tasks, modified files, key decisions.

### 2. Token Estimation Engine

Enhanced `BudgetManager` with tool-specific weights replacing the current flat observation-byte counting.

**Token estimation formula per tool call:**

| Tool | Formula | Rationale |
|------|---------|-----------|
| Read | `input_bytes / 4` | File content loaded into context |
| Edit | `(old_string + new_string) / 4` | Both strings in context |
| Write | `content_bytes / 4` | Full file content |
| Bash | `(command + output) / 4` | Command + stdout/stderr |
| Grep | `results_bytes / 4` | Search results |
| Glob | `results_bytes / 4` | File list |
| Agent | `prompt_bytes / 4` | Subagent prompt (response is separate context) |
| WebSearch | `results_bytes / 4` | Search results |
| WebFetch | `content_bytes / 4` | Page content |
| User message | `message_bytes / 4` | User input |
| Assistant response | `response_bytes / 4` | Claude output |

**Overhead constants:**
- System prompt: ~4,000 tokens (estimated once at session start)
- Tool definitions: ~2,000 tokens
- Per-message structure: ~500 tokens (role tags, formatting)
- MCP tool overhead: ~100 tokens per call

**Accuracy target:** Within 20% of actual usage. This is sufficient for threshold-based warnings (80%/90%) and handoff timing.

**Configuration in `.context-mem.json`:**
```json
{
  "token_estimation": {
    "model_context_limit": 1000000,
    "bytes_per_token": 4,
    "system_prompt_tokens": 4000,
    "tool_definitions_tokens": 2000,
    "per_message_overhead": 500
  }
}
```

### 3. PreCompact Hook

**File:** `hooks/context-mem-precompact.js`
**Event:** `PreCompact`

Triggered by Claude Code immediately before auto-compaction. This is the last opportunity to capture full session state.

**Hook behavior:**
1. Create full snapshot with 16KB limit (up from 8KB)
2. Tag critical context items:
   - Active plan (if exists)
   - Pending/in-progress tasks
   - Last 3 decisions
   - Currently active files (most recently read/edited)
3. Write `session_chains` entry with `handoff_reason = "compaction"`
4. Store compaction timestamp in session metadata for post-compaction detection

**Output:** Empty stdout (no injection at PreCompact — injection happens on next PostToolUse).

### 4. Post-Compaction Recovery

**File:** `hooks/proactive-inject.js` (enhanced)

After compaction, the next PostToolUse call detects the compaction event and injects critical context.

**Detection logic:**
```
last_compaction_time = query session metadata for compaction timestamp
if last_compaction_time exists AND no recovery has been injected yet:
  → load critical context from snapshot
  → inject via stdout
  → set recovery_injected = true
  → cooldown: 10 minutes before any further proactive injection
```

**Injection format:**
```
[Context Recovery — post-compaction]
Active plan: <plan title and current step>
Pending tasks: <task list>
Key decisions: <last 3 decisions with rationale>
Working files: <file paths with recent changes>
```

**Size limit:** Max 2KB for recovery injection to avoid overwhelming the refreshed context.

### 5. Auto-Restore on SessionStart

**File:** `hooks/session-start-hook.js` (enhanced)

**Logic:**
1. Query `session_chains` for most recent session in this project
2. Calculate time since last session ended
3. Apply threshold logic:

| Time since last session | Behavior |
|------------------------|----------|
| < 2 hours | Full auto-restore: snapshot + chain summary + "Continuing from previous session" |
| 2-24 hours | Light restore: chain summary + project profile |
| > 24 hours | Clean start: project profile only, chain history available via `/context-mem-history` |

**Configurable in `.context-mem.json`:**
```json
{
  "session_continuity": {
    "auto_restore_threshold_hours": 2,
    "light_restore_threshold_hours": 24,
    "enabled": true
  }
}
```

**Injection on auto-restore:**
```
[Session Continuity — continuing from <parent_session_id>]
Previous session (45m ago): <summary>
Active plan: <if exists>
Pending tasks: <if any>
Key files: <recently modified>
```

### 6. Slash Commands

All commands use `context-mem-` prefix for discoverability in autocomplete.

#### `/context-mem-handoff`

Generates a human-readable continuation prompt and copies to clipboard.

**Output format:**
```markdown
## Session Handoff — 2026-03-28 02:15

### What was done:
- Knowledge graph integration (v1.2.0)
- Multi-agent coordination system (v1.4.0)

### Current work:
- Session handoff system design
- File: docs/superpowers/specs/2026-03-28-session-handoff-design.md

### Next steps:
- Implementation plan
- PreCompact hook

### Key decisions:
- Approach B: Session Intelligence Layer
- Commands prefixed with context-mem-

### Active files:
- src/core/session.ts
- src/core/budget.ts
- hooks/proactive-inject.js
```

**Behavior:**
1. Generate snapshot (16KB)
2. Format as readable markdown
3. Copy to clipboard (with user confirmation)
4. Save to `session_chains` with `handoff_reason = "manual"`
5. Output: "Handoff prompt copied to clipboard. Paste into new session to continue."

#### `/context-mem-status`

Shows current session state and token estimation.

**Output:**
```
Estimated tokens: ~340K / 1M (34%)
Session duration: 1h 23m
Observations: 47 stored
Compactions: 1 (recovered)
Chain: session_3 <- session_2 <- session_1
```

#### `/context-mem-history`

Shows session chain history for this project.

**Output:**
```
Session 3 (current) — 1h 23m, ~340K tokens
  > Session handoff design, PreCompact hook
Session 2 — 45m, ~280K tokens
  > Multi-agent system, v1.4.0 release
Session 1 — 2h 10m, ~890K tokens
  > Knowledge graph, proactive injection, v1.2.0-1.3.0
```

### 7. MCP Tool: `handoff_session`

Programmatic handoff for agents and automated workflows.

```typescript
{
  name: "handoff_session",
  description: "Generate session handoff — saves state and returns continuation prompt for new session",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why the handoff is happening"
      },
      target: {
        type: "string",
        enum: ["clipboard", "file", "return"],
        default: "return",
        description: "Where to send the continuation prompt"
      }
    }
  }
}
```

**Returns:**
```json
{
  "continuation_prompt": "## Session Handoff — ...",
  "chain_id": "chain_abc123",
  "snapshot_id": "snap_xyz789",
  "token_estimate": {
    "used": 340000,
    "limit": 1000000,
    "percentage": 34
  }
}
```

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `hooks/context-mem-precompact.js` | PreCompact hook — snapshot before compaction |
| Commands: `context-mem-handoff`, `context-mem-status`, `context-mem-history` | Slash commands (in plugin commands/) |

### Modified Files
| File | Change |
|------|--------|
| `src/plugins/storage/migrations.ts` | Migration v10: `session_chains` table, snapshot size increase |
| `src/core/session.ts` | 16KB snapshot limit, chain logic, continuation prompt generator |
| `src/core/budget.ts` | Tool-specific token weights, compaction detection flag |
| `src/core/types.ts` | `SessionChain`, `HandoffResult`, `TokenEstimate` interfaces |
| `src/core/kernel.ts` | SessionChain initialization, `handoff_session` tool handler |
| `src/mcp-server/tools.ts` | `handoff_session` tool definition |
| `hooks/proactive-inject.js` | Post-compaction recovery injection |
| `hooks/session-start-hook.js` | Auto-restore from chain predecessor |
| `hooks/hooks.json` | PreCompact event registration |

### Unchanged
- Pipeline, Dreamer, KnowledgeGraph, SearchFusion — not affected
- All existing MCP tools — unchanged
- Privacy engine — continuation prompts pass through sanitization

---

## Testing Strategy

### Unit Tests
- SessionChain CRUD operations
- Token estimation accuracy (per-tool weight calculations)
- Continuation prompt generation format
- Snapshot 16KB limit enforcement
- Chain query (parent traversal, history)

### Integration Tests
- PreCompact hook → snapshot saved → recovery injected on next tool call
- SessionStart auto-restore with different time thresholds
- `/context-mem-handoff` end-to-end flow
- `handoff_session` MCP tool response format
- Migration v10 up/down

### Edge Cases
- First session ever (no chain predecessor)
- Multiple rapid compactions in one session
- Corrupted/missing snapshot on restore
- Session chain with 50+ entries (pagination)
- Concurrent sessions on same project (multi-agent)

---

## Configuration

All settings in `.context-mem.json`:

```json
{
  "session_continuity": {
    "enabled": true,
    "auto_restore_threshold_hours": 2,
    "light_restore_threshold_hours": 24,
    "snapshot_max_bytes": 16384,
    "recovery_injection_max_bytes": 2048,
    "recovery_cooldown_minutes": 10
  },
  "token_estimation": {
    "model_context_limit": 1000000,
    "bytes_per_token": 4,
    "system_prompt_tokens": 4000,
    "tool_definitions_tokens": 2000,
    "per_message_overhead": 500
  }
}
```

---

## Version

This feature ships as **context-mem v2.1.0** — "Session Continuity".
