# v2.0.0 Phase 1 Design Spec — Streaming, Cross-Project, Plugin API

**Goal:** Add 3 independent subsystems that form the foundation for context-mem v2.0.0's "Intelligence Layer."

**Architecture:** Each feature is a self-contained module with clear interfaces. No feature depends on another. All three can be built and tested independently.

**Tech Stack:** Node.js, TypeScript, SQLite (better-sqlite3), WebSocket (ws), MCP SDK

---

## Feature 1: Streaming Observations (WebSocket)

### Problem
Dashboard uses HTTP polling (1-2s intervals). This wastes resources, adds latency, and doesn't scale for real-time visualization.

### Design

**Hybrid architecture** (industry standard — Slack, Discord, GitHub pattern):
- **Dashboard → WebSocket** for real-time push (observations, stats, events)
- **Hooks → HTTP POST** for observation ingestion (unchanged, fire-and-forget)

**New file:** `src/core/ws-server.ts`

```typescript
export class ObservationStream {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    // Heartbeat every 30s (RFC 6455)
    this.heartbeatInterval = setInterval(() => this.ping(), 30_000);
    this.heartbeatInterval.unref();
  }

  broadcast(event: { type: string; data: unknown }): void {
    const msg = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  stop(): void {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
  }
}
```

**Event types broadcast to clients:**
- `observation:new` — when a new observation is stored
- `stats:update` — token economy stats changed
- `knowledge:change` — knowledge entry added/modified/archived
- `event:new` — new P1-P4 event emitted
- `dreamer:cycle` — Dreamer completed a validation cycle

**Dashboard client changes** (`dashboard/server.js`):
- Add WebSocket client with auto-reconnect (exponential backoff: 1s, 2s, 4s, 8s, max 30s)
- Keep HTTP polling as fallback when WebSocket unavailable
- On `observation:new` → update observation list without full refresh
- On `stats:update` → update stats panel

**Integration point:**
- `kernel.ts` emits events to `ObservationStream` after storing observations
- Dashboard HTTP server passes its `http.Server` to `ObservationStream` constructor

**Dependencies:** `ws` npm package (add to dependencies)

### Files to Create/Modify
- Create: `src/core/ws-server.ts`
- Modify: `src/core/kernel.ts` — emit to stream after observe/knowledge/event operations
- Modify: `dashboard/server.js` — attach WebSocket server, add client-side WS code
- Modify: `package.json` — add `ws` dependency
- Create: `src/tests/core/ws-server.test.ts`

### Tests
- WebSocket connection established
- Broadcast reaches all connected clients
- Heartbeat keeps connection alive
- Auto-reconnect on disconnect (client-side)
- Graceful shutdown clears all resources
- Fallback to HTTP polling when WS unavailable

---

## Feature 2: Cross-Project Knowledge Transfer

### Problem
Knowledge learned in Project A (e.g., "PostgreSQL connection pooling pattern") is invisible in Project B. Developers re-discover the same patterns in every project.

### Design

**Global SQLite store** at `~/.context-mem/global/store.db` — same schema as project-level knowledge table. This is the proven approach (SQLite is already our stack, FTS5 search works, migration system exists).

**New file:** `src/core/global-store.ts`

```typescript
export class GlobalKnowledgeStore {
  private db: Database;
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(os.homedir(), '.context-mem', 'global', 'store.db');
    // Create directory + open DB + run migrations
  }

  promote(entry: KnowledgeEntry, projectName: string): void {
    // Copy entry from project → global, tag with source project
  }

  search(query: string, opts?: { category?: string; limit?: number }): KnowledgeEntry[] {
    // Same FTS5 + trigram search as project-level
  }

  demote(id: string, targetProjectDb: string): void {
    // Copy global entry → specific project
  }
}
```

**Knowledge promotion flow:**
1. **Manual:** MCP tool `promote_knowledge(id)` — user explicitly promotes entry
2. **Auto-suggest:** When `save_knowledge` stores an entry with `source_type: 'explicit'` and `access_count >= 3`, suggest promotion via response message
3. **Never auto-promote** without user intent — privacy boundary

**Global search integration:**
- MCP tool `global_search(query, category?)` — search global store only
- Existing `search_knowledge` gains optional `include_global: true` param — merges project + global results, project results ranked higher

**Privacy controls:**
- Privacy engine runs on content before promotion (redact secrets)
- Config: `global_knowledge: { enabled: true, auto_suggest: true }` in `.context-mem.json`
- Each promoted entry tagged with `source_project` for traceability

**Schema (global store):**
Same as project knowledge table + `source_project TEXT NOT NULL` column.

### Files to Create/Modify
- Create: `src/core/global-store.ts`
- Create: `src/plugins/storage/global-migrations.ts` — separate migration chain for global DB
- Modify: `src/mcp-server/tools.ts` — add `promote_knowledge`, `global_search` tools; add `include_global` to `search_knowledge`
- Modify: `src/mcp-server/server.ts` — register new tools
- Modify: `src/core/kernel.ts` — initialize GlobalKnowledgeStore
- Modify: `src/core/types.ts` — add GlobalKnowledgeStore types, config fields
- Modify: `.context-mem.json.example` — document global_knowledge config
- Create: `src/tests/core/global-store.test.ts`

### Tests
- Promote entry from project → global
- Search global store returns results
- search_knowledge with include_global merges results (project first)
- Privacy engine redacts secrets before promotion
- Global store creates directory if missing
- Disabled when `global_knowledge.enabled: false`
- source_project tag preserved
- Demote entry from global → project

---

## Feature 3: Custom Summarizer Plugin API

### Problem
14 built-in summarizers cover common content types, but users can't add domain-specific ones (Terraform output, Kubernetes logs, GraphQL responses, custom log formats).

### Design

**npm package convention** (ESLint/Prettier/Babel pattern — industry standard):
- Package name: `context-mem-summarizer-*` (e.g., `context-mem-summarizer-k8s`)
- Auto-discovery via `package.json` keyword: `"context-mem-summarizer"`
- Load via `require.resolve()` from project's `node_modules`

**Plugin interface:**

```typescript
// Published as part of context-mem's public API
export interface SummarizerPlugin {
  name: string;
  version: string;
  type: 'summarizer';

  // Return true if this summarizer handles this content
  detect(content: string): boolean;

  // Return compressed summary
  summarize(content: string): string;

  // Priority (lower = checked first). Built-ins use 100-900.
  // Plugins should use 50 (run before built-ins) or 950 (run after).
  priority?: number;

  // Optional lifecycle
  init?(config: Record<string, unknown>): Promise<void>;
  destroy?(): Promise<void>;
}
```

**Discovery and loading:**

```typescript
// src/core/plugin-loader.ts
export class PluginLoader {
  loadSummarizers(projectDir: string): SummarizerPlugin[] {
    const pkgPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return [];

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    const plugins: SummarizerPlugin[] = [];
    for (const name of Object.keys(deps)) {
      if (!name.startsWith('context-mem-summarizer-')) continue;
      try {
        const mod = require(require.resolve(name, { paths: [projectDir] }));
        const plugin = mod.default || mod;
        if (plugin.detect && plugin.summarize) {
          plugins.push(plugin);
        }
      } catch {} // Skip broken plugins silently
    }
    return plugins;
  }
}
```

**Config integration:**
```json
// .context-mem.json
{
  "plugins": {
    "summarizers": ["shell", "json", "error", "log", "code"],
    "external_summarizers": {
      "context-mem-summarizer-k8s": { "enabled": true, "priority": 50 },
      "context-mem-summarizer-terraform": { "enabled": true }
    }
  }
}
```

**Hot-reload:** Not in v2.0 scope. Plugins loaded on `kernel.start()`. Restart required for new plugins. This matches ESLint/Prettier behavior.

**Scaffolding command:** `context-mem create-summarizer <name>` generates a template package with `detect()`, `summarize()`, `package.json`, and test file.

### Files to Create/Modify
- Create: `src/core/plugin-loader.ts`
- Modify: `src/core/kernel.ts` — use PluginLoader to discover and register external summarizers
- Modify: `src/core/types.ts` — add `external_summarizers` to config, export SummarizerPlugin interface
- Modify: `.context-mem.json.example` — document external_summarizers
- Create: `src/cli/commands/create-summarizer.ts` — scaffolding command
- Create: `src/tests/core/plugin-loader.test.ts`

### Tests
- Discovers npm packages with `context-mem-summarizer-` prefix
- Loads valid plugin and registers as summarizer
- Skips broken/missing plugins silently
- Plugin priority ordering works (50 before built-ins, 950 after)
- Plugin detect/summarize called correctly in pipeline
- Config can enable/disable specific plugins
- create-summarizer generates valid template

---

## Shared Concerns

### Error Handling
All three features follow context-mem's existing pattern: non-critical features never crash the host. Every external operation (WebSocket, global DB, plugin load) wrapped in try/catch with graceful degradation.

### Testing Strategy
Each feature gets its own test file. Integration tests verify features work together (e.g., WebSocket broadcasts when global knowledge is promoted). Target: 30+ new tests across the 3 features.

### Migration Strategy
- Global store uses separate migration chain (not affecting project DB)
- No breaking changes to existing MCP tools (new tools added, existing tools gain optional params)
- WebSocket is additive (HTTP polling remains as fallback)

### Config Backwards Compatibility
All new config fields are optional with sensible defaults:
- `global_knowledge.enabled` defaults to `true`
- `global_knowledge.auto_suggest` defaults to `true`
- `external_summarizers` defaults to `{}` (no external plugins)
- WebSocket requires no config (auto-starts with dashboard)
