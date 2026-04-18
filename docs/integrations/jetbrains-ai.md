# JetBrains AI Assistant + context-mem

**Status:** Supported via the JetBrains MCP Proxy (`@jetbrains/mcp-proxy`).
**Difficulty:** Medium — requires installing the MCP proxy and wiring it through an MCP-capable client (Continue plugin or another external client).

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- Any JetBrains IDE 2024.1 or later (IntelliJ IDEA, PyCharm, WebStorm, GoLand, Rider, etc.)
- Node 18 or later
- One of the following MCP-capable front-ends:
  - **Continue plugin** for JetBrains (recommended) — see [continue.md](./continue.md)
  - An external MCP client (e.g., Claude Desktop, a custom client) connected to the JetBrains MCP proxy

## Background

JetBrains AI Assistant (the built-in AI chat panel) does not yet expose a first-party MCP server configuration UI. However, JetBrains publishes an official **MCP proxy** (`@jetbrains/mcp-proxy`) that bridges any external MCP client to the IDE's built-in web server. This lets you route context-mem memory tools through Continue's JetBrains plugin, which does support MCP natively.

## Quick Start

### 1. Start context-mem

```bash
context-mem serve
```

This starts the MCP server on stdio, an HTTP bridge on port 51894, and the dashboard on port 51893.

### 2. Path A — Use Continue plugin in JetBrains (recommended)

The simplest path is to install the Continue JetBrains plugin and follow the [Continue.dev guide](./continue.md). Continue uses the same `~/.continue/config.yaml` as the VS Code plugin — configure once, works in both IDEs.

The YAML entry is identical:

```yaml
mcpServers:
  - name: context-mem
    command: npx
    args:
      - "-y"
      - "context-mem"
      - "serve"
```

Continue's JetBrains plugin surfaces context-mem tools in the Continue chat panel inside your JetBrains IDE.

### 3. Path B — JetBrains MCP Proxy (advanced)

If you want to use context-mem with the JetBrains built-in AI features or an external client, use the official `@jetbrains/mcp-proxy` package:

**Step 1:** In your JetBrains IDE, ensure the **MCP Server** plugin is enabled (Settings → Plugins → search "MCP").

**Step 2:** Configure your external MCP client to run both the JetBrains proxy and context-mem. Example for Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jetbrains": {
      "command": "npx",
      "args": ["-y", "@jetbrains/mcp-proxy"]
    },
    "context-mem": {
      "command": "npx",
      "args": ["-y", "context-mem", "serve"]
    }
  }
}
```

This pattern gives Claude Desktop (or another external client) access to both IDE actions (via the JetBrains proxy) and persistent memory (via context-mem).

**Step 3 (optional):** If the IDE runs on a non-default port or a remote host, pass environment variables:

```json
{
  "mcpServers": {
    "jetbrains": {
      "command": "npx",
      "args": ["-y", "@jetbrains/mcp-proxy"],
      "env": {
        "IDE_PORT": "63342",
        "LOG_ENABLED": "true"
      }
    }
  }
}
```

### 4. Verify

**Via Continue plugin:** Open the Continue chat panel in JetBrains and ask:

> "What MCP tools do you have available?"

You should see context-mem tools listed. Test:

```
Use context-mem observe to store: "JetBrains integration test — working"
Then use context-mem recall to retrieve it.
```

**Via external client + JetBrains proxy:** Run your external client and confirm both `jetbrains` and `context-mem` tool sets appear.

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` / `recall` / `search` / `ask` | Works via Continue plugin |
| 44 context-mem tools | Works via Continue plugin |
| JetBrains MCP proxy (IDE actions) | Works via `@jetbrains/mcp-proxy` |
| Built-in JetBrains AI Assistant (native MCP) | Not yet available — no first-party MCP config UI |
| Dashboard at :51893 | Works (open in browser manually) |

## Troubleshooting

- **Continue plugin version:** MCP support requires Continue JetBrains plugin 1.0+. Update via Settings → Plugins.
- **JetBrains MCP plugin not found:** Search for "MCP Server" in the JetBrains Marketplace (Settings → Plugins → Marketplace).
- **Proxy can't connect to IDE:** The proxy connects to `http://localhost:63342` by default (JetBrains built-in web server). If your IDE uses a different port, set `IDE_PORT` in the env config.
- **External network access disabled:** If the IDE's built-in web server rejects connections, go to Settings → Build, Execution, Deployment → Debugger → Built-in Server and enable "Allow unsigned requests".
- **`npx` not found:** Use absolute paths for `command` fields.

## Uninstall

Remove the context-mem (and optionally jetbrains proxy) entries from your config. Optionally:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [Continue.dev integration](./continue.md) — the recommended path for JetBrains
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
