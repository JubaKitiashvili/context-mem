# Multi-Agent Shared Memory Design Spec — v2.0.0 Phase 4

**Goal:** Multiple Claude sessions share knowledge, coordinate tasks, and avoid duplicate work. Like Slack channels for AI agents — each sees what others are doing.

**Architecture:** Shared SQLite DB (already supports concurrent WAL access) + agent registry + event broadcast. No new server process — piggybacks on existing infrastructure.

**Tech Stack:** SQLite WAL (existing), file-based agent registry, existing event system

---

## Agent Registry

Each Claude session registers itself on startup and deregisters on stop.

### Registry file: `.context-mem/agents.json`

```json
{
  "agents": [
    {
      "id": "01HXYZ...",
      "name": "auth-agent",
      "session_id": "sess_abc123",
      "pid": 12345,
      "started_at": 1711500000000,
      "last_heartbeat": 1711500060000,
      "status": "active",
      "current_task": "Implementing JWT refresh",
      "files_claimed": ["src/auth.ts", "src/middleware/jwt.ts"]
    }
  ]
}
```

### Agent lifecycle

```
SessionStart hook → register agent (write to agents.json)
Every 60s → heartbeat update (update last_heartbeat)
Stop hook → deregister agent (remove from agents.json)
Stale detection → agents with last_heartbeat > 5min auto-removed
```

### File claiming

Agents can "claim" files they're working on. Other agents see claimed files and avoid conflicts:
- `claim_files(paths)` — mark files as being worked on
- `release_files(paths)` — release claimed files
- `get_claimed_files()` — see what's claimed by whom

---

## New MCP Tools (4 tools)

### `agent_register`
```typescript
{
  name: 'agent_register',
  inputSchema: {
    properties: {
      name: { type: 'string', description: 'Agent name (e.g., auth-agent, test-runner)' },
      task: { type: 'string', description: 'Current task description' },
    },
    required: ['name'],
  },
}
```
Registers the current session as a named agent. Returns agent ID.

### `agent_status`
```typescript
{
  name: 'agent_status',
  inputSchema: {
    properties: {
      include_stale: { type: 'boolean', description: 'Include agents with stale heartbeats' },
    },
  },
}
```
Returns all active agents with their tasks and claimed files. Prunes stale agents.

### `claim_files`
```typescript
{
  name: 'claim_files',
  inputSchema: {
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'File paths to claim' },
    },
    required: ['files'],
  },
}
```
Claims files for the current agent. Returns conflicts if already claimed by another agent.

### `agent_broadcast`
```typescript
{
  name: 'agent_broadcast',
  inputSchema: {
    properties: {
      message: { type: 'string', description: 'Message to broadcast to all agents' },
      priority: { type: 'number', enum: [1, 2, 3, 4], description: 'Message priority' },
    },
    required: ['message'],
  },
}
```
Broadcasts a message to all active agents via the event system. Other agents see it on their next proactive injection cycle.

---

## Implementation

### New file: `src/core/agent-registry.ts`

```typescript
export class AgentRegistry {
  private registryPath: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private agentId: string;

  constructor(private projectDir: string, private sessionId: string) {
    this.registryPath = path.join(projectDir, '.context-mem', 'agents.json');
    this.agentId = ulid();
  }

  register(name: string, task?: string): AgentInfo {
    const agents = this.load();
    this.pruneStale(agents);
    const agent: AgentInfo = {
      id: this.agentId,
      name,
      session_id: this.sessionId,
      pid: process.pid,
      started_at: Date.now(),
      last_heartbeat: Date.now(),
      status: 'active',
      current_task: task || '',
      files_claimed: [],
    };
    agents.push(agent);
    this.save(agents);
    this.startHeartbeat();
    return agent;
  }

  deregister(): void {
    this.stopHeartbeat();
    const agents = this.load().filter(a => a.id !== this.agentId);
    this.save(agents);
  }

  getActive(includeStale?: boolean): AgentInfo[] {
    const agents = this.load();
    if (!includeStale) this.pruneStale(agents);
    return agents;
  }

  claimFiles(files: string[]): { claimed: string[]; conflicts: Array<{ file: string; agent: string }> } {
    const agents = this.load();
    this.pruneStale(agents);
    const conflicts: Array<{ file: string; agent: string }> = [];
    const claimed: string[] = [];

    for (const file of files) {
      const owner = agents.find(a => a.id !== this.agentId && a.files_claimed.includes(file));
      if (owner) {
        conflicts.push({ file, agent: owner.name });
      } else {
        claimed.push(file);
      }
    }

    // Update our agent's claimed files
    const self = agents.find(a => a.id === this.agentId);
    if (self) {
      self.files_claimed = [...new Set([...self.files_claimed, ...claimed])];
      this.save(agents);
    }

    return { claimed, conflicts };
  }

  broadcast(message: string, priority: number): void {
    // Write to events table with event_type 'agent_broadcast'
    // Other agents pick this up via proactive injection or query_events
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const agents = this.load();
      const self = agents.find(a => a.id === this.agentId);
      if (self) {
        self.last_heartbeat = Date.now();
        this.save(agents);
      }
    }, 60_000);
    this.heartbeatInterval.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private pruneStale(agents: AgentInfo[]): void {
    const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
    const stale = agents.filter(a => a.last_heartbeat < cutoff);
    for (const s of stale) {
      agents.splice(agents.indexOf(s), 1);
    }
    if (stale.length > 0) this.save(agents);
  }

  private load(): AgentInfo[] {
    try {
      if (!fs.existsSync(this.registryPath)) return [];
      return JSON.parse(fs.readFileSync(this.registryPath, 'utf8')).agents || [];
    } catch { return []; }
  }

  private save(agents: AgentInfo[]): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify({ agents }, null, 2));
  }
}
```

### File locking for concurrent access

`agents.json` may be written by multiple processes simultaneously. Use atomic write pattern:
1. Write to `.context-mem/agents.json.tmp`
2. Rename to `.context-mem/agents.json` (atomic on POSIX)

---

## Integration Points

### kernel.ts
- Initialize `AgentRegistry` in `start()`
- Expose on ToolKernel interface as `agentRegistry?: AgentRegistry`
- Call `deregister()` in `stop()`

### tools.ts + server.ts
- Add 4 tool definitions and handlers
- Register in dispatch switch (27 total tools)

### hooks/proactive-inject.js
- Check for agent broadcasts in events table
- Inject "[Agent auth-agent] Completed JWT implementation" messages

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/core/agent-registry.ts` |
| Create | `src/tests/core/agent-registry.test.ts` |
| Modify | `src/core/types.ts` — AgentInfo interface |
| Modify | `src/core/kernel.ts` — initialize + expose AgentRegistry |
| Modify | `src/mcp-server/tools.ts` — 4 new tools + handlers |
| Modify | `src/mcp-server/server.ts` — register 4 new tools |

---

## Tests

- Register agent, verify in registry
- Deregister removes agent
- Heartbeat updates last_heartbeat
- Stale agents pruned after 5 minutes
- Claim files succeeds when unclaimed
- Claim files returns conflicts when claimed by another
- Release files works
- Multiple agents coexist
- Atomic write doesn't corrupt on concurrent access
- Broadcast creates event

Target: 12+ new tests.
