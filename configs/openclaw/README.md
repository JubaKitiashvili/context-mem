# context-mem for OpenClaw

## MCP Server Integration

Add to your OpenClaw MCP configuration:

```json
{
  "mcpServers": {
    "context-mem": {
      "command": "npx",
      "args": ["-y", "context-mem", "serve"],
      "env": {}
    }
  }
}
```

## ContextEngine Plugin (Native)

If using OpenClaw's ContextEngine plugin system, add to your project config:

```json
{
  "contextEngine": {
    "plugins": ["context-mem"]
  }
}
```

Then install:
```bash
npm install context-mem
```

context-mem provides:
- 14 content-aware summarizers (99% token savings)
- 3-layer hybrid search (BM25 + Trigram + Fuzzy)
- Knowledge base with relevance decay
- Budget management with overflow strategies
- Session continuity via snapshots
- Real-time dashboard at http://localhost:51893
