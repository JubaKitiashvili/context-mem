# context-mem v0.4.0 — Competitive Parity Implementation Plan

> Migrating the best features from claude-mem and context-mode into context-mem.
> Excludes: paid LLM calls, vector/Chroma DB (heavy dependency), multi-provider (N/A for us).

**Created:** 2026-03-20
**Status:** Not started
**Version target:** 0.4.0

---

## Overview

This plan adds 8 features extracted from competitive analysis of claude-mem (v6.5.0) and context-mode (v1.0.33). Each task is self-contained with exact file paths, line numbers, interfaces, and verification steps. Tasks are ordered by dependency — later tasks may depend on earlier ones, noted explicitly.

**Current state:** v0.3.0 — 14 summarizers, 3-layer search (BM25+Trigram+Levenshtein), content store, knowledge base, budget management, event tracking, session snapshots, 17 MCP tools, 12 platform configs.

---

## Task 1: 60/40 Truncation Split

**Priority:** Trivial (30 min)
**Depends on:** Nothing
**Status:** [ ] Not started

### What

Change head/tail truncation ratio from 50/50 to 60/40. Error messages, stack traces, and exit codes appear at the end of output — the tail is more critical for debugging than the head.

### Where

**File:** `src/core/truncation.ts` (153 lines)

**Current constants (lines 6-9):**
```typescript
const HEAD = 500;
const TAIL = 500;
const AGGRESSIVE_HEAD = 200;
const AGGRESSIVE_TAIL = 200;
```

### Changes

Replace with ratio-based calculation:
```typescript
const HEAD_RATIO = 0.6;
const TAIL_RATIO = 0.4;
const TOTAL_LINES = 1000;
const HEAD = Math.floor(TOTAL_LINES * HEAD_RATIO);   // 600
const TAIL = TOTAL_LINES - HEAD;                       // 400
const AGGRESSIVE_TOTAL = 400;
const AGGRESSIVE_HEAD = Math.floor(AGGRESSIVE_TOTAL * HEAD_RATIO);  // 240
const AGGRESSIVE_TAIL = AGGRESSIVE_TOTAL - AGGRESSIVE_HEAD;          // 160
```

Also update the char-based fallback (currently HEAD*8=4000, TAIL*8=4000):
```typescript
const MAX_HEAD_CHARS = HEAD * 8;   // 4800
const MAX_TAIL_CHARS = TAIL * 8;   // 3200
```

### Test

**File:** `tests/core/truncation.test.ts`

Add test: "60/40 split preserves tail errors":
```typescript
// Generate 2000 lines: 1500 setup lines + 500 error lines at end
// After truncation: head should be 600 lines, tail should be 400 lines
// Verify error lines are in the tail section
```

### Verification

```bash
npm run build && npm test
# Verify truncation.test.ts passes with 60/40 split
```

---

## Task 2: Progressive Search Throttling

**Priority:** Small (2 hours)
**Depends on:** Nothing
**Status:** [ ] Not started

### What

Prevent LLMs from making 15-20 sequential search calls that flood the context window. Implement a sliding window counter that limits search frequency and forces batch usage.

### Where

**File:** `src/plugins/search/fusion.ts` (47 lines)

### Changes

Add throttling state and logic to `SearchFusion`:

```typescript
// New constants
const SEARCH_WINDOW_MS = 60_000;       // 60-second sliding window
const SEARCH_MAX_FULL = 3;             // calls 1-3: full results
const SEARCH_MAX_LIMITED = 8;          // calls 4-8: 1 result + warning
const SEARCH_BLOCK_AFTER = 8;          // call 9+: blocked

// New instance state
private searchCallCount = 0;
private searchWindowStart = Date.now();
```

Modify `execute()`:
```typescript
async execute(query: string, opts: SearchOpts): Promise<SearchResult[]> {
  // Reset window if expired
  const now = Date.now();
  if (now - this.searchWindowStart > SEARCH_WINDOW_MS) {
    this.searchCallCount = 0;
    this.searchWindowStart = now;
  }
  this.searchCallCount++;

  // Tier 3: Block after 8 calls
  if (this.searchCallCount > SEARCH_BLOCK_AFTER) {
    return [{
      id: '__throttled__',
      title: 'Search throttled',
      snippet: `BLOCKED: ${this.searchCallCount} searches in ${Math.round((now - this.searchWindowStart) / 1000)}s. Stop making individual search calls. Use batch queries or wait ${Math.ceil((SEARCH_WINDOW_MS - (now - this.searchWindowStart)) / 1000)}s.`,
      relevance_score: 0,
      type: 'context' as ObservationType,
      timestamp: now,
    }];
  }

  // Existing search logic...
  const results = /* existing execute logic */;

  // Tier 2: Limit results after SEARCH_MAX_FULL
  if (this.searchCallCount > SEARCH_MAX_FULL) {
    const limited = results.slice(0, 1);
    limited.push({
      id: '__throttle_warning__',
      title: 'Search rate limited',
      snippet: `Search call ${this.searchCallCount}/${SEARCH_BLOCK_AFTER} in this window. Results limited to 1. Batch your queries.`,
      relevance_score: 0,
      type: 'context' as ObservationType,
      timestamp: now,
    });
    return limited;
  }

  return results;
}
```

Add reset method for testing:
```typescript
resetThrottle(): void {
  this.searchCallCount = 0;
  this.searchWindowStart = Date.now();
}
```

### Test

**File:** `tests/plugins/search/throttling.test.ts` (new)

Tests:
1. "first 3 searches return full results"
2. "searches 4-8 return 1 result + warning"
3. "search 9+ returns blocked message"
4. "window resets after 60 seconds"
5. "resetThrottle() clears counter"

### Verification

```bash
npm run build && npm test
```

---

## Task 3: Causality Enhancement — correlation_id + Anchor Timeline

**Priority:** Small (3 hours)
**Depends on:** Nothing
**Status:** [ ] Not started

### What

Add `correlation_id` to observations for linking related items within a session. Enhance timeline tool to support anchor-based before/after context (like claude-mem's timeline tool). Add `files_modified` tracking to observation metadata.

### Part A: Schema + Types

**File:** `src/core/types.ts`

Add to `ObservationMetadata` interface (after `session_id`):
```typescript
correlation_id?: string;
files_modified?: string[];
```

**File:** `src/plugins/storage/migrations.ts`

Add migration v4:
```sql
ALTER TABLE observations ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_obs_correlation ON observations(correlation_id);
```

Update `LATEST_SCHEMA_VERSION = 4`.

### Part B: Pipeline Integration

**File:** `src/core/pipeline.ts`

In `observe()`, accept optional `correlation_id` and `files_modified` params. Pass through to metadata:

```typescript
async observe(
  content: string,
  type: ObservationType,
  source: string,
  filePath?: string,
  opts?: { correlation_id?: string; files_modified?: string[] }
): Promise<Observation>
```

Store `correlation_id` in the observation row. Include `files_modified` in metadata JSON.

### Part C: Anchor Timeline

**File:** `src/mcp-server/tools.ts`

Add `anchor` and `depth_before`/`depth_after` params to timeline tool schema (around line 175):

```typescript
// New timeline params:
anchor: { type: 'string', description: 'Observation ID to center the timeline on' },
depth_before: { type: 'number', description: 'Number of observations before anchor (default 10)' },
depth_after: { type: 'number', description: 'Number of observations after anchor (default 5)' },
```

In `handleTimeline()` (line 398), add anchor mode:
```typescript
if (params.anchor) {
  // 1. Get anchor observation timestamp
  // 2. SELECT observations WHERE timestamp < anchor.timestamp ORDER BY timestamp DESC LIMIT depth_before
  // 3. SELECT observations WHERE timestamp > anchor.timestamp ORDER BY timestamp ASC LIMIT depth_after
  // 4. Mark anchor with "<- ANCHOR" in output
  // Return combined, sorted chronologically
}
```

### Part D: Observe Tool Update

In `handleObserve()` (line 310), accept and pass through:
```typescript
correlation_id: params.correlation_id as string | undefined,
files_modified: params.files_modified as string[] | undefined,
```

Add to observe tool schema:
```typescript
correlation_id: { type: 'string', description: 'Links related observations (e.g., same debugging session)' },
files_modified: { type: 'array', items: { type: 'string' }, description: 'File paths modified in this observation' },
```

### Test

**File:** `tests/core/causality.test.ts` (new)

1. "observations with same correlation_id are linked"
2. "anchor timeline returns before/after context"
3. "anchor marks the correct observation"
4. "files_modified stored in metadata"

### Verification

```bash
npm run build && npm test
# Manual: observe 10 items, then timeline with anchor=item5, verify 4 before + 5 after
```

---

## Task 4: Subprocess Isolation + Environment Sanitization

**Priority:** Small (4 hours)
**Depends on:** Nothing
**Status:** [ ] Not started

### What

Refactor runtime execution to use proper process isolation: environment variable sanitization (denylist of 60+ dangerous vars), process group management, output capping, and timeout enforcement. This also enables credential passthrough (gh, aws, gcloud, docker work automatically).

### Where

**New file:** `src/plugins/runtimes/sandbox.ts`

### Changes

Create shared sandbox module:

```typescript
export const ENV_DENYLIST = new Set([
  // Node.js injection
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_HISTORY',
  // Python injection
  'PYTHONSTARTUP', 'PYTHONPATH', 'PYTHONHOME',
  // Ruby/Perl injection
  'RUBYOPT', 'RUBYLIB', 'PERL5OPT', 'PERL5LIB',
  // Dynamic linker injection
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
  // Compiler/toolchain
  'RUSTC_WRAPPER', 'GOFLAGS', 'GOPATH',
  'CFLAGS', 'CXXFLAGS', 'LDFLAGS',
  // Shell injection
  'BASH_ENV', 'ENV', 'CDPATH', 'PROMPT_COMMAND',
  'PS1', 'PS2', 'PS4',
  // Editor/pager (can execute code)
  'EDITOR', 'VISUAL', 'PAGER', 'BROWSER',
  // Misc injection vectors
  'IFS', 'SHELLOPTS', 'BASHOPTS', 'GLOBIGNORE',
  'MAIL', 'MAILPATH', 'MAILCHECK',
]);

export const SENSITIVE_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i;

export const MAX_OUTPUT_BYTES = 100 * 1024 * 1024; // 100MB hard cap
export const DEFAULT_TIMEOUT_MS = 30_000;           // 30 seconds
export const MAX_OUTPUT_CHARS = 10_000;             // Truncation limit for response

export function buildSafeEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, val] of Object.entries(process.env)) {
    if (!val) continue;
    if (ENV_DENYLIST.has(key)) continue;
    if (SENSITIVE_ENV_RE.test(key)) continue;
    env[key] = val;
  }

  // Force safe defaults
  env.LANG = 'en_US.UTF-8';
  env.NO_COLOR = '1';

  // Merge extra env (caller overrides)
  if (extraEnv) Object.assign(env, extraEnv);

  return env;
}

export interface SpawnSafeOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  truncated: boolean;
  killed: boolean;
}

export function spawnSafe(opts: SpawnSafeOpts): Promise<SpawnResult> {
  // Implementation:
  // 1. spawn() with { detached: true, env: buildSafeEnv(opts.env) }
  // 2. Collect stdout/stderr with byte counter
  // 3. Kill process tree if output > MAX_OUTPUT_BYTES
  // 4. Kill process tree on timeout
  // 5. Cleanup: process.kill(-pid, 'SIGKILL') for tree kill
  // 6. Truncate output to MAX_OUTPUT_CHARS for response
}
```

**Modify:** `src/plugins/runtimes/javascript.ts`
- Replace `execFile` call with `spawnSafe()` from sandbox
- Remove manual env handling
- Remove manual truncation (sandbox handles it)

**Modify:** `src/plugins/runtimes/python.ts`
- Same refactor as JavaScript

**Modify:** `src/plugins/runtimes/shell.ts`
- Same refactor as JavaScript

### Test

**File:** `tests/plugins/runtimes/sandbox.test.ts` (new)

1. "buildSafeEnv removes NODE_OPTIONS"
2. "buildSafeEnv removes DYLD_INSERT_LIBRARIES"
3. "buildSafeEnv preserves PATH and HOME"
4. "buildSafeEnv removes SENSITIVE_ENV_RE matches"
5. "spawnSafe kills on timeout"
6. "spawnSafe truncates large output"
7. "credentials (AWS_REGION, GITHUB_TOKEN) NOT in denylist pass through"

### Verification

```bash
npm run build && npm test
# Manual: execute tool with NODE_OPTIONS set — verify it's stripped
```

---

## Task 5: Eight New Language Runtimes

**Priority:** Medium (6 hours)
**Depends on:** Task 4 (sandbox.ts)
**Status:** [ ] Not started

### What

Add Ruby, Go, Rust, PHP, Perl, R, Elixir, TypeScript(Bun) runtimes. Each follows the `RuntimePlugin` interface and uses `spawnSafe()` from Task 4.

### New Files

All in `src/plugins/runtimes/`:

| # | File | Language | Detection | Notes |
|---|------|----------|-----------|-------|
| 1 | `typescript.ts` | TypeScript | `bun` → `tsx` → `ts-node` | Bun preferred (3-5x faster) |
| 2 | `ruby.ts` | Ruby | `ruby` | Direct execution |
| 3 | `go.ts` | Go | `go` | Auto-wrap in `package main` if absent |
| 4 | `rust.ts` | Rust | `rustc` | Compile then execute (60s compile timeout) |
| 5 | `php.ts` | PHP | `php` | Prepend `<?php` if missing |
| 6 | `perl.ts` | Perl | `perl` | Direct execution |
| 7 | `r.ts` | R | `Rscript` → `r` | Direct execution |
| 8 | `elixir.ts` | Elixir | `elixir` | Direct execution |

### Template (each runtime follows this pattern)

```typescript
import { spawnSafe, buildSafeEnv } from './sandbox.js';
import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export class RubyRuntime implements RuntimePlugin {
  name = 'ruby-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'ruby';
  extensions = ['.rb'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    try {
      await spawnSafe({ cmd: 'ruby', args: ['--version'], timeout: 5000 });
      return true;
    } catch { return false; }
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const tmp = mkdtempSync(join(tmpdir(), 'ctx-mem-rb-'));
    const file = join(tmp, 'script.rb');
    writeFileSync(file, code);
    try {
      const result = await spawnSafe({
        cmd: 'ruby', args: [file],
        timeout: opts.timeout || 30_000,
        env: opts.env,
      });
      return result;
    } finally {
      try { rmSync(tmp, { recursive: true }); } catch {}
    }
  }
}
```

### Special cases:

**Go (`go.ts`):**
- If code doesn't contain `package main`, wrap it:
  ```go
  package main
  import "fmt"
  func main() {
    // user code
  }
  ```
- Execute via `go run script.go`

**Rust (`rust.ts`):**
- Two-step: compile (`rustc script.rs -o binary`), then execute (`./binary`)
- Compile timeout: 60s (Rust compilation is slow)
- Execute timeout: from opts

**PHP (`php.ts`):**
- If code doesn't start with `<?php`, prepend it

**TypeScript (`typescript.ts`):**
- Detection cascade: `bun` → `tsx` → `ts-node`
- If Bun: `bun run script.ts`
- If tsx: `tsx script.ts`
- If ts-node: `ts-node script.ts`

### Register in Kernel

**File:** `src/core/kernel.ts`

In `start()`, after existing runtime registrations (find where JS/Python/Shell are registered), add:

```typescript
import { TypeScriptRuntime } from '../plugins/runtimes/typescript.js';
import { RubyRuntime } from '../plugins/runtimes/ruby.js';
import { GoRuntime } from '../plugins/runtimes/go.js';
import { RustRuntime } from '../plugins/runtimes/rust.js';
import { PhpRuntime } from '../plugins/runtimes/php.js';
import { PerlRuntime } from '../plugins/runtimes/perl.js';
import { RRuntime } from '../plugins/runtimes/r.js';
import { ElixirRuntime } from '../plugins/runtimes/elixir.js';

// Register runtimes (detection is lazy — only checks availability on first use)
for (const Runtime of [TypeScriptRuntime, RubyRuntime, GoRuntime, RustRuntime, PhpRuntime, PerlRuntime, RRuntime, ElixirRuntime]) {
  const rt = new Runtime();
  this.registry.register(rt);
}
```

### Update execute tool

**File:** `src/mcp-server/tools.ts`

In `handleExecute()` (line 568), the runtime lookup already searches by language name. No changes needed if each new runtime has a unique `language` property.

Update the tool schema description to list all supported languages:
```typescript
description: 'Execute code snippets in JavaScript, TypeScript, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, or Elixir'
```

### Tests

One test file per runtime in `tests/plugins/runtimes/`:
- `typescript.test.ts` — "console.log('hello')" via bun/tsx
- `ruby.test.ts` — "puts 'hello'"
- `go.test.ts` — "fmt.Println(\"hello\")" with auto-wrap
- `rust.test.ts` — "fn main() { println!(\"hello\"); }" compile+run
- `php.test.ts` — "echo 'hello';" with auto-prepend
- `perl.test.ts` — "print 'hello\n';"
- `r.test.ts` — "cat('hello\n')"
- `elixir.test.ts` — "IO.puts \"hello\""

Each test: detect() returns bool, execute() returns correct stdout, timeout kills process.

### Verification

```bash
npm run build && npm test
# Manual: start MCP server, call execute with each language
```

---

## Task 6: 15-Category Session Guide

**Priority:** Medium (6 hours)
**Depends on:** Task 3 (correlation_id, files_modified)
**Status:** [ ] Not started

### What

Expand session snapshots from 4 categories to 15, with P1/P2/P3 priority-based budget allocation. This matches context-mode's structured session restore while using our existing event+observation infrastructure.

### Where

**File:** `src/core/session.ts` (117 lines) — major rewrite

### New Design

```typescript
// Priority tiers with budget allocation
const PRIORITY_BUDGET = {
  P1: 0.50,  // 50% = ~1024 bytes — files, tasks, rules
  P2: 0.35,  // 35% = ~716 bytes  — errors, decisions, cwd, env, git, plan
  P3: 0.15,  // 15% = ~308 bytes  — skills, intent, mcp tools, data
};

// 15 categories
interface SessionCategory {
  name: string;
  priority: 1 | 2 | 3;
  extract: (ctx: SnapshotContext) => string | null;
}

interface SnapshotContext {
  sessionId: string;
  storage: StoragePlugin;
  events: EventTracker;
  stats: TokenEconomics;
}

const CATEGORIES: SessionCategory[] = [
  // P1 — Critical
  { name: 'files', priority: 1, extract: (ctx) => {
    // Query events where event_type IN ('file_read', 'file_modify')
    // Deduplicate by file path, keep last 10
    // Format: "path (read:N, write:N, last: write)"
  }},
  { name: 'tasks', priority: 1, extract: (ctx) => {
    // Query events where event_type = 'task_start' or 'task_complete'
    // Show pending tasks (started but not completed)
  }},
  { name: 'rules', priority: 1, extract: (ctx) => {
    // Query events where data contains CLAUDE.md or .clinerules etc.
    // Just note which rules files were accessed
  }},

  // P2 — Important
  { name: 'decisions', priority: 2, extract: (ctx) => {
    // Last 5 'decision' type observations (summary only)
  }},
  { name: 'errors', priority: 2, extract: (ctx) => {
    // Last 3 'error' type observations (summary only)
  }},
  { name: 'cwd', priority: 2, extract: (ctx) => {
    // Current working directory from most recent event data
  }},
  { name: 'git', priority: 2, extract: (ctx) => {
    // Recent git events: commits, branches, merges
  }},
  { name: 'env', priority: 2, extract: (ctx) => {
    // Environment setup events: venv, npm install, etc.
  }},
  { name: 'plan', priority: 2, extract: (ctx) => {
    // Active plan state if any plan events exist
  }},

  // P3 — Context
  { name: 'mcp_tools', priority: 3, extract: (ctx) => {
    // MCP tool call counts from events
    // Format: "observe:15, search:8, get:3"
  }},
  { name: 'intent', priority: 3, extract: (ctx) => {
    // Inferred session mode: investigate/implement/review/discuss
    // Based on event type distribution
  }},
  { name: 'knowledge', priority: 3, extract: (ctx) => {
    // Recent knowledge saves (titles only)
  }},
  { name: 'stats', priority: 3, extract: (ctx) => {
    // Token economics summary
  }},
  { name: 'search_history', priority: 3, extract: (ctx) => {
    // Last 5 search queries performed
  }},
  { name: 'correlation_groups', priority: 3, extract: (ctx) => {
    // Active correlation_id groups and their observation counts
  }},
];
```

### Trimming Algorithm

```typescript
buildSnapshot(ctx: SnapshotContext): Record<string, string> {
  const sections: Map<string, { content: string; priority: number }> = new Map();

  // Extract all categories
  for (const cat of CATEGORIES) {
    const content = cat.extract(ctx);
    if (content) sections.set(cat.name, { content, priority: cat.priority });
  }

  // Trim to fit MAX_SNAPSHOT_BYTES (2048)
  // Drop P3 first, then P2, then trim P1
  let total = JSON.stringify(Object.fromEntries(
    [...sections].map(([k, v]) => [k, v.content])
  )).length;

  if (total > MAX_SNAPSHOT_BYTES) {
    // Drop P3 categories one by one (smallest first)
    for (const [name, sec] of [...sections].filter(([, s]) => s.priority === 3).sort((a, b) => a[1].content.length - b[1].content.length)) {
      sections.delete(name);
      total -= sec.content.length;
      if (total <= MAX_SNAPSHOT_BYTES) break;
    }
  }
  // Same for P2 if still over...
  // Truncate remaining P1 entries if still over...

  return Object.fromEntries([...sections].map(([k, v]) => [k, v.content]));
}
```

### Restore Format

`restoreSnapshot()` returns structured session guide:

```
## Session Restore (12 categories captured)

### Active Files
- src/core/session.ts (read:3, write:2, last: write)
- src/core/types.ts (read:1)

### Pending Tasks
- Implement 15-category session guide

### Decisions
- Use 60/40 truncation split for better error preservation
- Add correlation_id for causality tracking

### Errors
- TypeError in pipeline.ts line 45 (resolved)

### Environment
- cwd: /Users/macbook/Desktop/Projects/context-mem
- git: branch main, last commit ae3a33b

### Stats
- 45 observations, 89% savings, 12 searches
```

### Test

**File:** `tests/core/session-guide.test.ts` (new)

1. "builds snapshot with all 15 categories"
2. "P3 categories dropped first when over budget"
3. "P2 categories dropped if P3 removal insufficient"
4. "condensed restore for stale snapshots"
5. "empty categories omitted"
6. "files deduplicated by path"
7. "total snapshot under 2KB"

### Verification

```bash
npm run build && npm test
# Manual: create session with various events, call restore_session, check all categories present
```

---

## Task 7: Progressive Disclosure — AI Rules Enhancement

**Priority:** Small (2 hours)
**Depends on:** Nothing
**Status:** [ ] Not started

### What

Update all AI rules files across 12 platforms to enforce the search → timeline → get workflow. Claude-mem's key insight: baking workflow instructions into tool descriptions raises compliance from ~60% to ~98%.

### Changes — Two parts:

### Part A: AI Rules Content Update

**Files to update (all contain `CONTEXT_MEM_RULES` constant):**
1. `src/cli/commands/init.ts` — line 24 (`CONTEXT_MEM_RULES` constant)
2. `src/cli/commands/serve.ts` — line 52 (`CONTEXT_MEM_RULES` constant)

**New `CONTEXT_MEM_RULES` content:**

```markdown
# context-mem Integration

context-mem is active in this project. It compresses tool outputs via 14 content-aware summarizers (99% token savings) and serves optimized context through MCP.

## Workflow (IMPORTANT — follow this order)

1. **Session start**: Call `restore_session` to recover prior context
2. **Before re-reading files**: Call `search` first — the answer may already be stored
3. **After large outputs**: Call `observe` to compress and store content
4. **Need details on a search result?**: Call `get` with the ID — never guess content
5. **Need chronological context?**: Call `timeline` — optionally with `anchor` ID for before/after view
6. **When learning patterns**: Call `save_knowledge` for decisions, error fixes, API patterns
7. **Periodically**: Call `budget_status` — if >80%, call `restore_session` to save state and reclaim context

## Rules

- ALWAYS `search` before `get` — never guess observation IDs
- ALWAYS `observe` outputs over 500 tokens — keep context clean
- NEVER call `get` without first finding the ID via `search` or `timeline`
- When `budget_status` shows >80%: save your work, call `restore_session`

## Available MCP Tools

- `observe` — store and compress content (auto-summarized)
- `search` / `get` / `timeline` — retrieve stored context (use in this order)
- `stats` — view compression statistics
- `save_knowledge` / `search_knowledge` — persistent knowledge base
- `budget_status` / `budget_configure` — token budget management
- `emit_event` / `query_events` — event tracking
- `restore_session` — session continuity + context reclaim
```

### Part B: Tool Description Enhancement

**File:** `src/mcp-server/tools.ts`

Update tool descriptions to include workflow hints:

**search tool** (around line 115):
```typescript
description: 'Search stored observations. Use this FIRST before calling get. Returns IDs, titles, snippets — not full content.'
```

**get tool** (around line 150):
```typescript
description: 'Retrieve full observation by ID. Only use IDs found via search or timeline — never guess.'
```

**timeline tool** (around line 165):
```typescript
description: 'Chronological observation list. Use anchor param to see before/after context around a specific observation.'
```

**budget_status tool** (around line 250):
```typescript
description: 'Check token budget usage. If >80%, call restore_session to save state and reclaim context window.'
```

### Part C: Config Template Files

Update all files in `configs/` that contain rules:
- `configs/cursor/context-mem.mdc`
- `configs/windsurf/context-mem.md`
- `configs/copilot/copilot-instructions.md`
- `configs/cline/context-mem.md`
- `configs/roo-code/context-mem.md`
- `configs/claude-code/CLAUDE.md`
- `configs/gemini-cli/GEMINI.md`
- `configs/antigravity/GEMINI.md`

All should contain the new `CONTEXT_MEM_RULES` content.

### Verification

```bash
npm run build
# Grep all rules files for "ALWAYS search before get"
grep -r "ALWAYS.*search.*before.*get" configs/ src/cli/
# Should find matches in all rules files
```

---

## Task 8: Context Recycling (LLM-free Endless Mode)

**Priority:** Medium-Large (8 hours)
**Depends on:** Task 6 (15-category session guide), Task 7 (AI rules)
**Status:** [ ] Not started

### What

Implement our answer to claude-mem's "Endless Mode" — without any LLM dependency. Our hooks already compress tool output before it enters context (that's our core feature). What's missing is **active context management**: signaling the AI when to recycle context, and making `restore_session` powerful enough to serve as a full context reset.

### Design Philosophy

Claude-mem's Endless Mode blocks on every tool call to LLM-compress the output, then rewrites the transcript. This adds latency and cost.

Our approach: hooks compress proactively (before context entry), and when context gets full, the AI calls `restore_session` which returns a comprehensive 15-category session guide. The AI can then start a new context with full knowledge of what happened before.

### Part A: Smart Budget Signals

**File:** `src/core/budget.ts`

Add signal messages to `BudgetStatus`:

```typescript
interface BudgetStatus {
  // ... existing fields ...
  signal?: string;  // Human-readable action recommendation
}

check(sessionId: string): BudgetStatus {
  const status = /* existing logic */;

  if (status.percentage >= 90) {
    status.signal = 'CRITICAL: Context 90%+ full. Call restore_session NOW to save state before context is lost.';
  } else if (status.percentage >= 80) {
    status.signal = 'WARNING: Context 80%+ full. Consider calling restore_session to save state and reclaim context.';
  } else if (status.percentage >= 60) {
    status.signal = 'Context 60% used. No action needed yet.';
  }

  return status;
}
```

### Part B: Auto-Checkpoint

**File:** `src/core/pipeline.ts`

After every N observations, auto-save a snapshot checkpoint:

```typescript
private observationCount = 0;
private readonly CHECKPOINT_INTERVAL = 20;  // Auto-save every 20 observations

async observe(...): Promise<Observation> {
  // ... existing pipeline ...

  // After successful store:
  this.observationCount++;
  if (this.observationCount % this.CHECKPOINT_INTERVAL === 0) {
    try {
      // Auto-checkpoint (non-blocking, best-effort)
      const stats = await this.kernel.stats();
      this.kernel.getSessionManager().saveSnapshot(this.sessionId, stats);
    } catch {
      // Non-fatal
    }
  }

  return observation;
}
```

Note: Pipeline needs a reference to kernel or session manager. Add via constructor or setter.

### Part C: Enhanced restore_session

**File:** `src/mcp-server/tools.ts`

Update `handleRestoreSession()` to return the 15-category guide plus a summary header:

```typescript
async function handleRestoreSession(params, kernel): Promise<Result> {
  const sessionId = params.session_id || kernel.sessionId;
  const result = kernel.sessionManager.restoreSnapshot(sessionId);

  if (!result) {
    return { content: [{ type: 'text', text: 'No saved session found. Starting fresh.' }] };
  }

  // Format as structured session guide
  let guide = `## Session Restored${result.condensed ? ' (condensed — session > 24h old)' : ''}\n\n`;

  const snapshot = result.snapshot;
  const categoryOrder = ['files', 'tasks', 'rules', 'decisions', 'errors', 'cwd', 'git', 'env', 'plan', 'mcp_tools', 'intent', 'knowledge', 'stats', 'search_history', 'correlation_groups'];

  for (const key of categoryOrder) {
    if (snapshot[key]) {
      guide += `### ${formatCategoryName(key)}\n${snapshot[key]}\n\n`;
    }
  }

  guide += `---\nUse \`search\` to find specific past observations. Use \`timeline\` with \`anchor\` for chronological context.\n`;

  return { content: [{ type: 'text', text: guide }] };
}
```

### Part D: Budget-Aware Observe Response

**File:** `src/mcp-server/tools.ts`

In `handleObserve()`, append budget signal to response when context is getting full:

```typescript
async function handleObserve(params, kernel): Promise<Result> {
  // ... existing logic ...

  // Check budget after observe
  const budgetStatus = kernel.budgetManager.check(kernel.sessionId);

  let response = `Stored observation ${obs.id}. Saved ${tokensSaved} tokens (${savingsPct}%).`;

  if (budgetStatus.signal && budgetStatus.percentage >= 80) {
    response += `\n\n⚠️ ${budgetStatus.signal}`;
  }

  return { content: [{ type: 'text', text: response }] };
}
```

### Test

**File:** `tests/core/context-recycling.test.ts` (new)

1. "budget signal at 80% says WARNING"
2. "budget signal at 90% says CRITICAL"
3. "auto-checkpoint saves snapshot every 20 observations"
4. "restore_session returns formatted 15-category guide"
5. "observe response includes budget warning at 80%"
6. "condensed restore for sessions > 24h old"

### Verification

```bash
npm run build && npm test
# Manual: observe 25 items, check auto-checkpoint saved
# Manual: set budget to low value, observe until 80%, verify warning in response
# Manual: restore_session returns formatted guide with categories
```

---

## Implementation Order & Dependencies

```
Task 1: 60/40 Truncation ─────────────────── (no deps)
Task 2: Search Throttling ─────────────────── (no deps)
Task 3: Causality (correlation_id + anchor) ─ (no deps)
Task 4: Subprocess Isolation ──────────────── (no deps)
Task 7: AI Rules Enhancement ─────────────── (no deps)
                                      │
Task 5: 8 New Runtimes ──────────────── depends on Task 4
Task 6: 15-Category Session Guide ──── depends on Task 3
                                      │
Task 8: Context Recycling ────────── depends on Task 6 + Task 7
```

**Parallelizable groups:**
- Group A (independent): Tasks 1, 2, 3, 4, 7 — can all be done in parallel
- Group B (after Task 4): Task 5
- Group C (after Task 3): Task 6
- Group D (after Tasks 6+7): Task 8

**Optimal serial order:**
1. Task 1 (30 min) — trivial warm-up
2. Task 2 (2 hrs) — small, self-contained
3. Task 7 (2 hrs) — text updates, no code logic
4. Task 3 (3 hrs) — schema change, needs careful testing
5. Task 4 (4 hrs) — new module, runtime refactor
6. Task 5 (6 hrs) — 8 new files, depends on Task 4
7. Task 6 (6 hrs) — major session.ts rewrite, depends on Task 3
8. Task 8 (8 hrs) — ties everything together, depends on Tasks 6+7

**Total estimated effort:** ~31 hours of implementation

---

## Version Bump & Release Checklist

After all 8 tasks complete:

1. [ ] `npm run build` — TypeScript compilation passes
2. [ ] `npm test` — all existing + new tests pass
3. [ ] Manual smoke test: `context-mem serve` in test project
4. [ ] Manual test: each new runtime via execute tool
5. [ ] Manual test: throttling (10 rapid searches)
6. [ ] Manual test: context recycling flow (observe 25 items → budget warning → restore_session)
7. [ ] Benchmark: `node docs/benchmarks/run-benchmarks.js` — compression ratios maintained
8. [ ] Update `package.json` version to `0.4.0`
9. [ ] Update `vscode-extension/package.json` version to `0.4.0`
10. [ ] Update README.md:
    - Add 11 runtimes to feature list
    - Update "How It Compares" table
    - Add Context Recycling to features
    - Update "What Gets Compressed" if new content types
11. [ ] `npm publish`
12. [ ] `cd vscode-extension && vsce publish`
13. [ ] Git commit + tag `v0.4.0`
14. [ ] Git push

---

## File Change Summary

### New files (13):
- `src/plugins/runtimes/sandbox.ts` — shared subprocess isolation
- `src/plugins/runtimes/typescript.ts` — TypeScript runtime
- `src/plugins/runtimes/ruby.ts` — Ruby runtime
- `src/plugins/runtimes/go.ts` — Go runtime
- `src/plugins/runtimes/rust.ts` — Rust runtime
- `src/plugins/runtimes/php.ts` — PHP runtime
- `src/plugins/runtimes/perl.ts` — Perl runtime
- `src/plugins/runtimes/r.ts` — R runtime
- `src/plugins/runtimes/elixir.ts` — Elixir runtime
- `tests/plugins/runtimes/sandbox.test.ts`
- `tests/plugins/search/throttling.test.ts`
- `tests/core/causality.test.ts`
- `tests/core/session-guide.test.ts`
- `tests/core/context-recycling.test.ts`

### Modified files (12):
- `src/core/truncation.ts` — 60/40 constants (Task 1)
- `src/core/types.ts` — correlation_id, files_modified, budget signal (Tasks 3, 8)
- `src/core/pipeline.ts` — correlation_id passthrough, auto-checkpoint (Tasks 3, 8)
- `src/core/session.ts` — 15-category rewrite (Task 6)
- `src/core/budget.ts` — signal messages (Task 8)
- `src/core/kernel.ts` — register 8 new runtimes (Task 5)
- `src/plugins/search/fusion.ts` — throttling (Task 2)
- `src/plugins/storage/migrations.ts` — v4 migration (Task 3)
- `src/plugins/runtimes/javascript.ts` — use sandbox (Task 4)
- `src/plugins/runtimes/python.ts` — use sandbox (Task 4)
- `src/plugins/runtimes/shell.ts` — use sandbox (Task 4)
- `src/mcp-server/tools.ts` — anchor timeline, budget signals, enhanced restore (Tasks 3, 7, 8)

### Updated content files (10):
- `src/cli/commands/init.ts` — new CONTEXT_MEM_RULES (Task 7)
- `src/cli/commands/serve.ts` — new CONTEXT_MEM_RULES (Task 7)
- `configs/cursor/context-mem.mdc` (Task 7)
- `configs/windsurf/context-mem.md` (Task 7)
- `configs/copilot/copilot-instructions.md` (Task 7)
- `configs/cline/context-mem.md` (Task 7)
- `configs/roo-code/context-mem.md` (Task 7)
- `configs/claude-code/CLAUDE.md` (Task 7)
- `configs/gemini-cli/GEMINI.md` (Task 7)
- `configs/antigravity/GEMINI.md` (Task 7)
