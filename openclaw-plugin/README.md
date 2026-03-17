# @context-mem/openclaw-plugin

> Native ContextEngine plugin for OpenClaw — 99% token savings via 14 content-aware summarizers.

## Install

```bash
openclaw plugins install @context-mem/openclaw-plugin
```

## Configure

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "context-mem"
    },
    "entries": {
      "context-mem": {
        "enabled": true
      }
    }
  }
}
```

## What It Does

context-mem replaces OpenClaw's built-in context engine with an optimized pipeline:

- **14 summarizers** detect content type (shell, JSON, errors, tests, builds, git, CSV, markdown, HTML, network, code, logs, TypeScript errors, binary) and compress each optimally
- **3-layer search** (BM25 + Trigram + Fuzzy) for sub-millisecond retrieval
- **Knowledge base** with relevance decay scoring
- **Budget management** with overflow strategies
- **Session continuity** via snapshots

### Lifecycle Integration

| Hook | What context-mem does |
|---|---|
| `bootstrap` | Initializes kernel, loads SQLite, starts summarizers |
| `ingest` | Compresses tool outputs via pipeline (99% savings) |
| `assemble` | Returns compressed context with token estimates |
| `compact` | Re-compresses aggressively when window is full |
| `afterTurn` | Saves session snapshot for continuity |
| `dispose` | Cleanup and shutdown |

## Dashboard

When active, the dashboard is available at `http://localhost:51893` — token economics, observations, search, knowledge base, events.

## License

MIT
