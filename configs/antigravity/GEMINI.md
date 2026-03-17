# context-mem — Context Optimization

context-mem compresses tool outputs via 14 content-aware summarizers and serves optimized context through MCP.

## Setup

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "context-mem": {
      "command": "npx",
      "args": ["-y", "context-mem", "serve"]
    }
  }
}
```

## Available MCP tools
- `observe` / `search` / `get` / `timeline` / `stats` — core context operations
- `save_knowledge` / `search_knowledge` — persistent knowledge base
- `budget_status` / `budget_configure` — token budget management
- `emit_event` / `query_events` — event tracking
- `restore_session` — session continuity
