# Session Handoff & Context Continuity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session chaining, token estimation, PreCompact state preservation, auto-restore, and `/context-mem-handoff` command so that context survives across sessions and compactions.

**Architecture:** New `session_chains` DB table links sessions. Enhanced `BudgetManager` estimates tokens per-tool. PreCompact hook saves state before compaction; proactive-inject recovers it after. SessionStart auto-restores from recent predecessors. New `handoff_session` MCP tool and 3 slash commands expose the system.

**Tech Stack:** TypeScript (core), JavaScript (hooks), SQLite (migrations), MCP protocol

**Spec:** `docs/superpowers/specs/2026-03-28-session-handoff-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/plugins/storage/migrations.ts` | Migration v10: `session_chains` table |
| `src/core/types.ts` | `SessionChain`, `HandoffResult`, `TokenEstimate`, `SessionContinuityConfig` interfaces |
| `src/core/session.ts` | Chain CRUD, continuation prompt generation, snapshot limit 16KB |
| `src/core/budget.ts` | Tool-specific token weights, compaction tracking |
| `src/mcp-server/tools.ts` | `handoff_session` tool definition + handler |
| `src/mcp-server/server.ts` | Wire `handoff_session` into switch |
| `src/core/kernel.ts` | Chain initialization in start(), handoff in stop() |
| `hooks/context-mem-precompact.js` | **New** — PreCompact hook |
| `hooks/proactive-inject.js` | Post-compaction recovery injection |
| `hooks/session-start-hook.js` | Auto-restore from chain predecessor |
| `hooks/hooks.json` | PreCompact event registration |

---

## Task 1: Migration v10 — session_chains table

**Files:**
- Modify: `src/plugins/storage/migrations.ts:312-351`
- Modify: `src/tests/plugins/storage/migrations.test.ts`

- [ ] **Step 1: Write the migration test**

Add test for v10 in `src/tests/plugins/storage/migrations.test.ts`. Find the test that checks `LATEST_SCHEMA_VERSION` and the test that checks migration count — these need updating too.

```typescript
// Update existing assertions:
// LATEST_SCHEMA_VERSION should be 10
// migrations array should have 10 entries

// Add new test:
it('v10 creates session_chains table with correct columns', () => {
  const sql = migrations[9].up;
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS session_chains');
  expect(sql).toContain('chain_id TEXT NOT NULL');
  expect(sql).toContain('session_id TEXT NOT NULL UNIQUE');
  expect(sql).toContain('parent_session TEXT');
  expect(sql).toContain('project_path TEXT NOT NULL');
  expect(sql).toContain('handoff_reason TEXT NOT NULL');
  expect(sql).toContain('summary TEXT');
  expect(sql).toContain('token_estimate INTEGER');
});

it('v10 creates required indexes', () => {
  const sql = migrations[9].up;
  expect(sql).toContain('idx_chains_session');
  expect(sql).toContain('idx_chains_parent');
  expect(sql).toContain('idx_chains_created');
  expect(sql).toContain('idx_chains_project');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/plugins/storage/migrations.test.ts`
Expected: FAIL — v10 doesn't exist yet, LATEST_SCHEMA_VERSION is 9

- [ ] **Step 3: Add migration v10**

In `src/plugins/storage/migrations.ts`, update `LATEST_SCHEMA_VERSION` to 10 and add the migration after v9:

```typescript
export const LATEST_SCHEMA_VERSION = 10;

// ... after the v9 migration entry in the array:
  {
    version: 10,
    description: 'Session chains for context continuity across sessions',
    up: `
      CREATE TABLE IF NOT EXISTS session_chains (
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

      CREATE INDEX IF NOT EXISTS idx_chains_session ON session_chains(session_id);
      CREATE INDEX IF NOT EXISTS idx_chains_parent ON session_chains(parent_session);
      CREATE INDEX IF NOT EXISTS idx_chains_created ON session_chains(created_at);
      CREATE INDEX IF NOT EXISTS idx_chains_project ON session_chains(project_path);

      INSERT OR IGNORE INTO schema_version (version, applied_at, description)
      VALUES (10, unixepoch(), 'Session chains for context continuity across sessions');
    `,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/plugins/storage/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/storage/migrations.ts src/tests/plugins/storage/migrations.test.ts
git commit -m "feat: migration v10 — session_chains table for context continuity"
```

---

## Task 2: New types — SessionChain, HandoffResult, TokenEstimate

**Files:**
- Modify: `src/core/types.ts:315-388`

- [ ] **Step 1: Add new interfaces**

After the `SessionContext` interface (line ~322) in `src/core/types.ts`, add:

```typescript
// Session chaining
export interface SessionChain {
  chain_id: string;
  session_id: string;
  parent_session: string | null;
  project_path: string;
  created_at: string;
  handoff_reason: 'auto' | 'manual' | 'compaction' | 'session_end';
  summary: string | null;
  token_estimate: number;
}

export interface HandoffResult {
  continuation_prompt: string;
  chain_id: string;
  snapshot_id: string;
  token_estimate: TokenEstimate;
}

export interface TokenEstimate {
  used: number;
  limit: number;
  percentage: number;
}

export interface SessionContinuityConfig {
  enabled: boolean;
  auto_restore_threshold_hours: number;
  light_restore_threshold_hours: number;
  snapshot_max_bytes: number;
  recovery_injection_max_bytes: number;
  recovery_cooldown_minutes: number;
}

export interface TokenEstimationConfig {
  model_context_limit: number;
  bytes_per_token: number;
  system_prompt_tokens: number;
  tool_definitions_tokens: number;
  per_message_overhead: number;
}
```

- [ ] **Step 2: Add session_continuity and token_estimation to ContextMemConfig**

In `src/core/types.ts`, add to the `ContextMemConfig` interface (after `proactive_injection`):

```typescript
  session_continuity?: SessionContinuityConfig;
  token_estimation?: TokenEstimationConfig;
```

And add defaults to `DEFAULT_CONFIG`:

```typescript
  session_continuity: {
    enabled: true,
    auto_restore_threshold_hours: 2,
    light_restore_threshold_hours: 24,
    snapshot_max_bytes: 16384,
    recovery_injection_max_bytes: 2048,
    recovery_cooldown_minutes: 10,
  },
  token_estimation: {
    model_context_limit: 1_000_000,
    bytes_per_token: 4,
    system_prompt_tokens: 4000,
    tool_definitions_tokens: 2000,
    per_message_overhead: 500,
  },
```

- [ ] **Step 3: Run all tests to verify nothing breaks**

Run: `npx vitest run`
Expected: All tests pass (types are additive, no breaking changes)

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: add SessionChain, HandoffResult, TokenEstimate types"
```

---

## Task 3: SessionManager — chain CRUD + snapshot limit increase

**Files:**
- Modify: `src/core/session.ts`
- Create: `src/tests/core/session-chain.test.ts`

- [ ] **Step 1: Write tests for chain operations**

Create `src/tests/core/session-chain.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../core/session.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('SessionManager — chain operations', () => {
  let storage: BetterSqlite3Storage;
  let session: SessionManager;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chain-test-'));
    storage = new BetterSqlite3Storage();
    await storage.init({ projectDir: tmpDir, config: {} as any });
    session = new SessionManager(storage);
  });

  afterEach(async () => {
    await storage.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new chain for the first session', () => {
    const chain = session.createChainEntry('sess-1', '/project/path', null, 'auto');
    expect(chain.chain_id).toBeTruthy();
    expect(chain.session_id).toBe('sess-1');
    expect(chain.parent_session).toBeNull();
    expect(chain.project_path).toBe('/project/path');
    expect(chain.handoff_reason).toBe('auto');
  });

  it('links sessions in a chain', () => {
    const first = session.createChainEntry('sess-1', '/project', null, 'auto');
    const second = session.createChainEntry('sess-2', '/project', 'sess-1', 'auto');
    expect(second.chain_id).toBe(first.chain_id);
    expect(second.parent_session).toBe('sess-1');
  });

  it('gets the latest chain entry for a project', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.createChainEntry('sess-2', '/project', 'sess-1', 'auto');
    const latest = session.getLatestChainEntry('/project');
    expect(latest?.session_id).toBe('sess-2');
  });

  it('returns null for unknown project', () => {
    const latest = session.getLatestChainEntry('/unknown');
    expect(latest).toBeNull();
  });

  it('gets chain history', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.createChainEntry('sess-2', '/project', 'sess-1', 'manual');
    session.createChainEntry('sess-3', '/project', 'sess-2', 'compaction');
    const history = session.getChainHistory('sess-3');
    expect(history).toHaveLength(3);
    expect(history[0].session_id).toBe('sess-3');
    expect(history[2].session_id).toBe('sess-1');
  });

  it('updates chain summary and token estimate', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    session.updateChainEntry('sess-1', { summary: 'Built feature X', token_estimate: 340000 });
    const entry = session.getLatestChainEntry('/project');
    expect(entry?.summary).toBe('Built feature X');
    expect(entry?.token_estimate).toBe(340000);
  });

  it('generates continuation prompt from snapshot', () => {
    session.createChainEntry('sess-1', '/project', null, 'auto');
    // Save a snapshot first
    session.saveSnapshot('sess-1', {
      session_id: 'sess-1',
      observations_stored: 10,
      total_content_bytes: 5000,
      total_summary_bytes: 500,
      searches_performed: 3,
      discovery_tokens: 100,
      read_tokens: 200,
      tokens_saved: 4300,
      savings_percentage: 86,
    });
    const prompt = session.generateContinuationPrompt('sess-1');
    expect(prompt).toContain('Session Handoff');
    expect(prompt).toBeTruthy();
  });

  it('snapshot limit is 16KB', () => {
    // Verify the constant was updated
    expect(session.getSnapshotMaxBytes()).toBe(16384);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/core/session-chain.test.ts`
Expected: FAIL — methods don't exist yet

- [ ] **Step 3: Update SessionManager with chain operations**

In `src/core/session.ts`:

1. Update `MAX_SNAPSHOT_BYTES` from 8192 to 16384:
```typescript
const MAX_SNAPSHOT_BYTES = 16384;
```

2. Add imports at the top:
```typescript
import type { StoragePlugin, TokenEconomics, SessionChain } from './types.js';
import { ulid } from './utils.js';
```

3. Add chain methods to the `SessionManager` class (after `restoreSnapshot`):

```typescript
  getSnapshotMaxBytes(): number {
    return MAX_SNAPSHOT_BYTES;
  }

  createChainEntry(
    sessionId: string,
    projectPath: string,
    parentSession: string | null,
    reason: SessionChain['handoff_reason'],
  ): SessionChain {
    // If parent exists, inherit its chain_id; otherwise create new chain
    let chainId: string;
    if (parentSession) {
      const parentRow = this.storage
        .prepare('SELECT chain_id FROM session_chains WHERE session_id = ?')
        .get(parentSession) as { chain_id: string } | undefined;
      chainId = parentRow?.chain_id ?? ulid();
    } else {
      chainId = ulid();
    }

    const now = new Date().toISOString();
    this.storage.exec(
      `INSERT OR IGNORE INTO session_chains (chain_id, session_id, parent_session, project_path, created_at, handoff_reason, summary, token_estimate)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
      [chainId, sessionId, parentSession, projectPath, now, reason],
    );

    return {
      chain_id: chainId,
      session_id: sessionId,
      parent_session: parentSession,
      project_path: projectPath,
      created_at: now,
      handoff_reason: reason,
      summary: null,
      token_estimate: 0,
    };
  }

  getLatestChainEntry(projectPath: string): SessionChain | null {
    const row = this.storage
      .prepare('SELECT * FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 1')
      .get(projectPath) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToChain(row);
  }

  getChainHistory(sessionId: string, limit = 20): SessionChain[] {
    // Walk the chain backwards from sessionId
    const history: SessionChain[] = [];
    let currentId: string | null = sessionId;

    while (currentId && history.length < limit) {
      const row = this.storage
        .prepare('SELECT * FROM session_chains WHERE session_id = ?')
        .get(currentId) as Record<string, unknown> | undefined;

      if (!row) break;
      const entry = this.rowToChain(row);
      history.push(entry);
      currentId = entry.parent_session;
    }

    return history;
  }

  updateChainEntry(sessionId: string, update: { summary?: string; token_estimate?: number }): void {
    if (update.summary !== undefined) {
      this.storage.exec(
        'UPDATE session_chains SET summary = ? WHERE session_id = ?',
        [update.summary, sessionId],
      );
    }
    if (update.token_estimate !== undefined) {
      this.storage.exec(
        'UPDATE session_chains SET token_estimate = ? WHERE session_id = ?',
        [update.token_estimate, sessionId],
      );
    }
  }

  generateContinuationPrompt(sessionId: string): string {
    const snapshot = this.restoreSnapshot(sessionId);
    const chain = this.storage
      .prepare('SELECT * FROM session_chains WHERE session_id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;

    const lines: string[] = [];
    lines.push(`## Session Handoff — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
    lines.push('');

    if (chain) {
      const entry = this.rowToChain(chain);
      if (entry.summary) {
        lines.push(`### Summary`);
        lines.push(entry.summary);
        lines.push('');
      }
    }

    if (snapshot) {
      const data = snapshot.snapshot;

      if (data.changes) {
        lines.push('### Recent changes');
        lines.push(String(data.changes));
        lines.push('');
      }

      if (data.files) {
        lines.push('### Active files');
        lines.push(String(data.files));
        lines.push('');
      }

      if (data.tasks) {
        lines.push('### Pending tasks');
        lines.push(String(data.tasks));
        lines.push('');
      }

      if (data.decisions) {
        lines.push('### Key decisions');
        lines.push(String(data.decisions));
        lines.push('');
      }

      if (data.errors) {
        lines.push('### Recent errors');
        lines.push(String(data.errors));
        lines.push('');
      }

      if (data.plan) {
        lines.push('### Active plan');
        lines.push(String(data.plan));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private rowToChain(row: Record<string, unknown>): SessionChain {
    return {
      chain_id: row.chain_id as string,
      session_id: row.session_id as string,
      parent_session: (row.parent_session as string) || null,
      project_path: row.project_path as string,
      created_at: row.created_at as string,
      handoff_reason: row.handoff_reason as SessionChain['handoff_reason'],
      summary: (row.summary as string) || null,
      token_estimate: (row.token_estimate as number) || 0,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/core/session-chain.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/session.ts src/tests/core/session-chain.test.ts
git commit -m "feat: session chain CRUD + 16KB snapshot limit"
```

---

## Task 4: BudgetManager — tool-specific token estimation

**Files:**
- Modify: `src/core/budget.ts`
- Create: `src/tests/core/budget-estimation.test.ts`

- [ ] **Step 1: Write tests for token estimation**

Create `src/tests/core/budget-estimation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BudgetManager } from '../../core/budget.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('BudgetManager — token estimation', () => {
  let storage: BetterSqlite3Storage;
  let budget: BudgetManager;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'budget-test-'));
    storage = new BetterSqlite3Storage();
    await storage.init({ projectDir: tmpDir, config: {} as any });
    budget = new BudgetManager(storage);
  });

  afterEach(async () => {
    await storage.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('estimates tokens for Read tool', () => {
    const tokens = budget.estimateToolTokens('Read', 4000, 0);
    expect(tokens).toBe(1000); // 4000 bytes / 4
  });

  it('estimates tokens for Edit tool (old + new)', () => {
    const tokens = budget.estimateToolTokens('Edit', 400, 600);
    expect(tokens).toBe(250); // (400 + 600) / 4
  });

  it('estimates tokens for Bash tool', () => {
    const tokens = budget.estimateToolTokens('Bash', 100, 2000);
    expect(tokens).toBe(525); // (100 + 2000) / 4
  });

  it('records tool usage and tracks cumulative estimate', () => {
    budget.recordToolUsage('test-session', 'Read', 8000, 0);
    budget.recordToolUsage('test-session', 'Edit', 200, 300);
    const estimate = budget.getTokenEstimate('test-session');
    expect(estimate.used).toBeGreaterThan(0);
    expect(estimate.limit).toBe(1_000_000);
    expect(estimate.percentage).toBeGreaterThan(0);
  });

  it('detects compaction flag', () => {
    expect(budget.wasCompacted('test-session')).toBe(false);
    budget.markCompacted('test-session');
    expect(budget.wasCompacted('test-session')).toBe(true);
    budget.clearCompacted('test-session');
    expect(budget.wasCompacted('test-session')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/core/budget-estimation.test.ts`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Add token estimation methods to BudgetManager**

In `src/core/budget.ts`, add imports and new methods:

```typescript
import type { StoragePlugin, BudgetConfig, BudgetStatus, OverflowStrategy, TokenEstimate } from './types.js';

export class BudgetManager {
  private compactedSessions = new Set<string>();

  constructor(private storage: StoragePlugin) {}

  // ... existing methods unchanged ...

  estimateToolTokens(toolName: string, inputBytes: number, outputBytes: number): number {
    const bytesPerToken = 4;
    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'WebFetch':
        return Math.ceil(inputBytes / bytesPerToken);
      case 'Edit':
        return Math.ceil((inputBytes + outputBytes) / bytesPerToken);
      case 'Bash':
      case 'Grep':
      case 'Glob':
      case 'WebSearch':
        return Math.ceil((inputBytes + outputBytes) / bytesPerToken);
      case 'Agent':
        return Math.ceil(inputBytes / bytesPerToken);
      default:
        return Math.ceil((inputBytes + outputBytes) / bytesPerToken);
    }
  }

  recordToolUsage(sessionId: string, toolName: string, inputBytes: number, outputBytes: number): void {
    const tokens = this.estimateToolTokens(toolName, inputBytes, outputBytes);
    this.storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      [sessionId, `tool:${toolName}`, tokens, 0, Date.now()],
    );
  }

  getTokenEstimate(sessionId: string): TokenEstimate {
    const row = this.storage
      .prepare('SELECT COALESCE(SUM(tokens_in), 0) AS used FROM token_stats WHERE session_id = ?')
      .get(sessionId) as { used: number } | undefined;

    const used = row?.used ?? 0;
    const limit = 1_000_000; // Default model context limit
    return {
      used,
      limit,
      percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
    };
  }

  markCompacted(sessionId: string): void {
    this.compactedSessions.add(sessionId);
  }

  wasCompacted(sessionId: string): boolean {
    return this.compactedSessions.has(sessionId);
  }

  clearCompacted(sessionId: string): void {
    this.compactedSessions.delete(sessionId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/core/budget-estimation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/budget.ts src/tests/core/budget-estimation.test.ts
git commit -m "feat: tool-specific token estimation in BudgetManager"
```

---

## Task 5: handoff_session MCP tool — definition + handler

**Files:**
- Modify: `src/mcp-server/tools.ts`
- Modify: `src/mcp-server/server.ts`

- [ ] **Step 1: Write test for the new tool**

In `src/tests/integration/mcp-protocol.test.ts`, update the tool count and add `handoff_session` to the expected tool list. Find the test that checks `listTools()` and update it:

```typescript
// Update the expected tool count from 29 to 30
// Add 'handoff_session' to the expected tool names array after 'ask'
```

Also add a functional test:

```typescript
it('handoff_session returns continuation prompt', async () => {
  const result = await client.callTool({
    name: 'handoff_session',
    arguments: { reason: 'test handoff' },
  });
  const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
  expect(parsed.continuation_prompt).toContain('Session Handoff');
  expect(parsed.chain_id).toBeTruthy();
  expect(parsed.token_estimate).toBeDefined();
  expect(parsed.token_estimate.percentage).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/integration/mcp-protocol.test.ts`
Expected: FAIL — tool doesn't exist, count is wrong

- [ ] **Step 3: Add tool definition in tools.ts**

Add after the `ask` tool definition (line ~485) in `src/mcp-server/tools.ts`:

```typescript
  // Session Handoff
  {
    name: 'handoff_session',
    description: 'Generate session handoff — saves state and returns continuation prompt for a new session. Use when context is running low or before ending a session.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the handoff is happening' },
        target: {
          type: 'string',
          enum: ['clipboard', 'file', 'return'],
          description: 'Where to send the continuation prompt (default: return)',
        },
      },
    },
  },
```

- [ ] **Step 4: Add handler function in tools.ts**

Add at the end of `src/mcp-server/tools.ts` (after `handleAsk`):

```typescript
// Session Handoff
export async function handleHandoffSession(
  params: { reason?: string; target?: string },
  kernel: ToolKernel,
): Promise<{
  continuation_prompt: string;
  chain_id: string;
  snapshot_id: string;
  token_estimate: { used: number; limit: number; percentage: number };
}> {
  // Save snapshot
  const stats = {
    session_id: kernel.sessionId,
    observations_stored: 0,
    total_content_bytes: 0,
    total_summary_bytes: 0,
    searches_performed: 0,
    discovery_tokens: 0,
    read_tokens: 0,
    tokens_saved: 0,
    savings_percentage: 0,
  };

  try {
    // Get real stats if available
    const row = kernel.storage
      .prepare("SELECT COUNT(*) as cnt FROM token_stats WHERE session_id = ?")
      .get(kernel.sessionId) as { cnt: number } | undefined;
    stats.observations_stored = row?.cnt ?? 0;
  } catch {
    // non-critical
  }

  kernel.sessionManager.saveSnapshot(kernel.sessionId, stats);

  // Create or update chain entry
  const projectPath = kernel.config.db_path.replace(/\/.context-mem\/.*$/, '') || process.cwd();
  let chainEntry = kernel.sessionManager.getLatestChainEntry(projectPath);

  if (!chainEntry || chainEntry.session_id !== kernel.sessionId) {
    chainEntry = kernel.sessionManager.createChainEntry(
      kernel.sessionId,
      projectPath,
      chainEntry?.session_id ?? null,
      'manual',
    );
  }

  // Update with summary
  const reason = params.reason || 'Manual handoff';
  kernel.sessionManager.updateChainEntry(kernel.sessionId, { summary: reason });

  // Generate continuation prompt
  const prompt = kernel.sessionManager.generateContinuationPrompt(kernel.sessionId);

  // Get token estimate
  const tokenEstimate = kernel.budgetManager.getTokenEstimate(kernel.sessionId);

  return {
    continuation_prompt: prompt,
    chain_id: chainEntry.chain_id,
    snapshot_id: kernel.sessionId,
    token_estimate: tokenEstimate,
  };
}
```

- [ ] **Step 5: Wire handler into server.ts**

In `src/mcp-server/server.ts`:

1. Add import:
```typescript
import { handleHandoffSession } from './tools.js';
```

2. Add case in the switch statement (after `case 'ask':`):
```typescript
        case 'handoff_session':
          result = await handleHandoffSession(params as Parameters<typeof handleHandoffSession>[0], kernel);
          break;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/tests/integration/mcp-protocol.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/server.ts
git commit -m "feat: handoff_session MCP tool for session continuity"
```

---

## Task 6: Kernel integration — chain init + handoff on stop

**Files:**
- Modify: `src/core/kernel.ts`

- [ ] **Step 1: Add chain initialization in Kernel.start()**

In `src/core/kernel.ts`, after the AgentRegistry initialization (inside `start()`, around line 195), add:

```typescript
    // 6b. Session chain — link to previous session
    try {
      const latest = this.sessionManager.getLatestChainEntry(this.projectDir);
      if (latest) {
        this.sessionManager.createChainEntry(
          this.session.session_id,
          this.projectDir,
          latest.session_id,
          'auto',
        );
      } else {
        this.sessionManager.createChainEntry(
          this.session.session_id,
          this.projectDir,
          null,
          'auto',
        );
      }
    } catch {
      // Chain init is non-critical
    }
```

- [ ] **Step 2: Update stop() to save chain summary**

In `src/core/kernel.ts`, in the `stop()` method (line ~384), add before the snapshot save:

```typescript
    // Update session chain with summary before shutdown
    if (this.storage && this.sessionManager) {
      try {
        const tokenEstimate = this.budgetManager.getTokenEstimate(this.session.session_id);
        this.sessionManager.updateChainEntry(this.session.session_id, {
          summary: `Session ended after ${Math.round((Date.now() - this.session.started_at) / 60000)}m`,
          token_estimate: tokenEstimate.used,
        });
      } catch {
        // Non-critical
      }
    }
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/core/kernel.ts
git commit -m "feat: session chain init on start, summary on stop"
```

---

## Task 7: PreCompact hook

**Files:**
- Create: `hooks/context-mem-precompact.js`
- Modify: `hooks/hooks.json`

- [ ] **Step 1: Create the PreCompact hook**

Create `hooks/context-mem-precompact.js`:

```javascript
#!/usr/bin/env node

/**
 * context-mem PreCompact hook
 * Saves full session state before Claude Code auto-compaction.
 * This is the last chance to capture context before messages are compressed.
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join, resolve } = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || __dirname;

function main() {
  try {
    const projectDir = process.cwd();
    const configPath = join(projectDir, '.context-mem.json');

    if (!existsSync(configPath)) return;

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const dbPath = resolve(projectDir, config.db_path || '.context-mem/store.db');

    if (!existsSync(dbPath)) return;

    const db = new Database(dbPath, { readonly: false });
    db.pragma('journal_mode = WAL');

    // Find current session (most recent in session_chains)
    const latestChain = db.prepare(
      'SELECT session_id FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
    ).get(projectDir);

    if (!latestChain) {
      db.close();
      return;
    }

    const sessionId = latestChain.session_id;

    // Record compaction event
    db.prepare(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, 'compaction', 0, 0, Date.now());

    // Save compaction marker to state file for post-compaction recovery
    const stateDir = join(projectDir, '.context-mem');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

    const stateFile = join(stateDir, 'compaction-state.json');
    writeFileSync(stateFile, JSON.stringify({
      session_id: sessionId,
      compacted_at: Date.now(),
      recovered: false,
    }));

    // Extract critical context for post-compaction recovery
    const critical = {};

    // Active plan
    const planEvent = db.prepare(
      "SELECT data FROM events WHERE session_id = ? AND event_type = 'plan' ORDER BY timestamp DESC LIMIT 1"
    ).get(sessionId);
    if (planEvent) {
      try {
        const planData = JSON.parse(planEvent.data);
        critical.plan = planData.content || 'Active plan exists';
      } catch {}
    }

    // Pending tasks
    const taskStarts = db.prepare(
      "SELECT data FROM events WHERE session_id = ? AND event_type = 'task_start' ORDER BY timestamp DESC LIMIT 10"
    ).all(sessionId);
    const taskCompletes = new Set(
      db.prepare(
        "SELECT data FROM events WHERE session_id = ? AND event_type = 'task_complete'"
      ).all(sessionId).map(r => {
        try { return JSON.parse(r.data).task_id; } catch { return null; }
      }).filter(Boolean)
    );
    const pending = taskStarts.filter(r => {
      try { return !taskCompletes.has(JSON.parse(r.data).task_id); } catch { return false; }
    }).map(r => {
      try { return JSON.parse(r.data).description || 'task'; } catch { return 'task'; }
    });
    if (pending.length) critical.tasks = pending;

    // Last 3 decisions
    const decisions = db.prepare(
      "SELECT summary FROM observations WHERE session_id = ? AND type = 'decision' ORDER BY indexed_at DESC LIMIT 3"
    ).all(sessionId);
    if (decisions.length) critical.decisions = decisions.map(r => r.summary);

    // Recently active files
    const files = db.prepare(`
      SELECT DISTINCT json_extract(metadata, '$.file_path') as fp
      FROM observations
      WHERE session_id = ? AND json_extract(metadata, '$.file_path') IS NOT NULL
      ORDER BY indexed_at DESC LIMIT 8
    `).all(sessionId);
    if (files.length) critical.files = files.map(r => r.fp).filter(Boolean);

    // Save critical context
    const criticalFile = join(stateDir, 'compaction-critical.json');
    writeFileSync(criticalFile, JSON.stringify(critical));

    // Update chain entry
    db.prepare(
      "UPDATE session_chains SET handoff_reason = 'compaction' WHERE session_id = ?"
    ).run(sessionId);

    db.close();
  } catch (err) {
    // PreCompact hook must never fail loudly
    if (process.env.CONTEXT_MEM_DEBUG) {
      console.error('[context-mem:precompact]', err.message);
    }
  }
}

main();
```

- [ ] **Step 2: Register PreCompact hook in hooks.json**

In `hooks/hooks.json`, add the PreCompact event after the Stop section:

```json
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/context-mem-precompact.js\"",
            "timeout": 5
          }
        ]
      }
    ]
```

- [ ] **Step 3: Test manually**

Run: `node hooks/context-mem-precompact.js`
Expected: No errors, no output (graceful no-op if no DB exists)

- [ ] **Step 4: Commit**

```bash
git add hooks/context-mem-precompact.js hooks/hooks.json
git commit -m "feat: PreCompact hook — saves state before auto-compaction"
```

---

## Task 8: Post-compaction recovery in proactive-inject.js

**Files:**
- Modify: `hooks/proactive-inject.js`

- [ ] **Step 1: Add recovery logic**

At the beginning of the `main()` function in `hooks/proactive-inject.js`, add compaction recovery detection (before the existing rate-limit checks):

```javascript
    // --- Post-compaction recovery ---
    const compactionStateFile = join(projectDir, '.context-mem', 'compaction-state.json');
    if (existsSync(compactionStateFile)) {
      try {
        const compState = JSON.parse(readFileSync(compactionStateFile, 'utf8'));
        if (!compState.recovered) {
          // Mark as recovered immediately to prevent double-injection
          compState.recovered = true;
          writeFileSync(compactionStateFile, JSON.stringify(compState));

          // Load critical context
          const criticalFile = join(projectDir, '.context-mem', 'compaction-critical.json');
          if (existsSync(criticalFile)) {
            const critical = JSON.parse(readFileSync(criticalFile, 'utf8'));
            const lines = ['[Context Recovery — post-compaction]'];

            if (critical.plan) {
              lines.push(`Active plan: ${typeof critical.plan === 'string' ? critical.plan.slice(0, 300) : 'Active plan exists'}`);
            }
            if (critical.tasks && critical.tasks.length) {
              lines.push(`Pending tasks: ${critical.tasks.slice(0, 5).join(', ')}`);
            }
            if (critical.decisions && critical.decisions.length) {
              lines.push('Key decisions:');
              critical.decisions.forEach(d => lines.push(`  - ${(d || '').slice(0, 150)}`));
            }
            if (critical.files && critical.files.length) {
              lines.push(`Working files: ${critical.files.slice(0, 6).join(', ')}`);
            }

            const recovery = lines.join('\n').slice(0, 2048); // Max 2KB
            process.stdout.write(recovery);
            return; // Skip normal injection — recovery takes priority
          }
        }
      } catch {
        // Recovery is best-effort
      }
    }
    // --- End post-compaction recovery ---
```

- [ ] **Step 2: Test manually**

Create a test compaction state:
```bash
mkdir -p .context-mem
echo '{"session_id":"test","compacted_at":1234,"recovered":false}' > .context-mem/compaction-state.json
echo '{"plan":"Build feature X","tasks":["Write tests","Deploy"],"decisions":["Use approach B"],"files":["src/main.ts"]}' > .context-mem/compaction-critical.json
echo '{"tool_name":"Read","tool_input":{"file_path":"test.ts"}}' | node hooks/proactive-inject.js
```
Expected: stdout contains `[Context Recovery — post-compaction]`

Clean up:
```bash
rm .context-mem/compaction-state.json .context-mem/compaction-critical.json
```

- [ ] **Step 3: Commit**

```bash
git add hooks/proactive-inject.js
git commit -m "feat: post-compaction context recovery in proactive-inject"
```

---

## Task 9: Auto-restore on SessionStart

**Files:**
- Modify: `hooks/session-start-hook.js`

- [ ] **Step 1: Add auto-restore logic**

In `hooks/session-start-hook.js`, add chain-based auto-restore logic. Find where the profile and journal are loaded (early in the `main()` function) and add before the final output assembly:

```javascript
    // --- Session chain auto-restore ---
    let chainContext = '';
    try {
      const latestChain = db.prepare(
        'SELECT * FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 1'
      ).get(projectDir);

      if (latestChain && latestChain.session_id) {
        const chainCreated = new Date(latestChain.created_at).getTime();
        const hoursSince = (Date.now() - chainCreated) / (1000 * 60 * 60);

        // Read thresholds from config
        const autoThreshold = (config.session_continuity && config.session_continuity.auto_restore_threshold_hours) || 2;
        const lightThreshold = (config.session_continuity && config.session_continuity.light_restore_threshold_hours) || 24;

        if (hoursSince < autoThreshold) {
          // Full auto-restore
          const snapshot = db.prepare(
            'SELECT snapshot FROM snapshots WHERE session_id = ?'
          ).get(latestChain.session_id);

          const lines = [`[Session Continuity — continuing from previous session (${Math.round(hoursSince * 60)}m ago)]`];

          if (latestChain.summary) {
            lines.push(`Previous session: ${latestChain.summary}`);
          }

          if (snapshot) {
            try {
              const data = JSON.parse(snapshot.snapshot);
              if (data.tasks) lines.push(`Pending tasks:\n${data.tasks}`);
              if (data.plan) lines.push(`Active plan: ${String(data.plan).slice(0, 300)}`);
              if (data.decisions) lines.push(`Key decisions:\n${data.decisions}`);
              if (data.files) lines.push(`Working files:\n${data.files}`);
            } catch {}
          }

          chainContext = lines.join('\n');
        } else if (hoursSince < lightThreshold) {
          // Light restore — just chain summary
          if (latestChain.summary) {
            chainContext = `[Previous session (${Math.round(hoursSince)}h ago)]: ${latestChain.summary}`;
          }
        }
        // > lightThreshold: clean start, no chain context injected
      }
    } catch {
      // Chain restore is non-critical
    }
    // --- End session chain auto-restore ---
```

Then include `chainContext` in the final output (add it after the profile output):

```javascript
    if (chainContext) {
      output += '\n\n' + chainContext;
    }
```

- [ ] **Step 2: Commit**

```bash
git add hooks/session-start-hook.js
git commit -m "feat: auto-restore from session chain on SessionStart"
```

---

## Task 10: Update MCP protocol tests

**Files:**
- Modify: `src/tests/integration/mcp-protocol.test.ts`
- Modify: `src/tests/mcp-server/server.test.ts`

- [ ] **Step 1: Update tool count expectations**

In `src/tests/integration/mcp-protocol.test.ts`, find the test that checks `tools.length` and update from 29 to 30.

In `src/tests/mcp-server/server.test.ts`, find the same check and update.

Add `'handoff_session'` to the expected tool names arrays in both files.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/tests/integration/mcp-protocol.test.ts src/tests/mcp-server/server.test.ts
git commit -m "test: update tool count to 30 for handoff_session"
```

---

## Task 11: Version bump + full validation

**Files:**
- Modify: `package.json`
- Modify: `src/mcp-server/server.ts:40` (version string)

- [ ] **Step 1: Bump version to 2.1.0**

In `package.json`, change version from `2.0.1` to `2.1.0`.
In `src/mcp-server/server.ts` line 40, change `'2.0.1'` to `'2.1.0'`.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add package.json src/mcp-server/server.ts
git commit -m "release: context-mem v2.1.0 — Session Continuity"
```

---

## Post-Implementation Notes

- **Slash commands** (`/context-mem-handoff`, `/context-mem-status`, `/context-mem-history`) require Claude Code plugin command files. These should be created as separate `.md` files in the plugin's `commands/` directory after the core implementation is validated. Each command will invoke the `handoff_session` MCP tool or query session chains via the existing MCP tools.
- **npm publish** and **GitHub release** follow the established release workflow after all tests pass.
- **Dashboard integration** (token gauge, session timeline) is deferred to a future version per spec non-goals.
