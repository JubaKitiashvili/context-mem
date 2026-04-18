# IDE Integrations

context-mem is an MCP server: it speaks the [Model Context Protocol](https://modelcontextprotocol.io) so any compliant IDE can use it. It also exposes an HTTP bridge (port 51894) for non-MCP clients.

## Supported editors

### Native MCP (recommended)

| Editor | Status | Setup |
|---|---|---|
| Claude Code | Works out of the box | `claude mcp add context-mem -- npx context-mem serve` |
| Cursor | Supported | [Setup](./cursor.md) |
| Cline | Supported | [Setup](./cline.md) |
| Roo Code | Supported | [Setup](./roo-code.md) |
| Windsurf | Supported | [Setup](./windsurf.md) |
| Continue.dev | Supported | [Setup](./continue.md) |
| VS Code (Copilot agent mode) | Supported via `.vscode/mcp.json` | [Setup](./vscode.md) |
| JetBrains AI | Via Continue plugin or MCP proxy | [Setup](./jetbrains-ai.md) |
| OpenHands | Works out of the box | Add context-mem as MCP server per OpenHands docs |

### HTTP bridge (non-MCP clients)

| Editor | Status | Setup |
|---|---|---|
| Aider | Via HTTP bridge on port 51894 | [Setup](./aider.md) |

## Generic MCP client setup

Any MCP-compatible client can use context-mem. The canonical config entry is:

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

The exact file path and top-level key name depend on the client. Common variations:

| Client | Key name | File location |
|---|---|---|
| Cursor | `"mcpServers"` | `~/.cursor/mcp.json` or `.cursor/mcp.json` |
| Windsurf | `"mcpServers"` | `~/.codeium/windsurf/mcp_config.json` |
| Cline | `"mcpServers"` | `~/.cline/data/settings/cline_mcp_settings.json` |
| Roo Code | `"mcpServers"` | Global `mcp_settings.json` or `.roo/mcp.json` |
| VS Code | `"servers"` | `.vscode/mcp.json` (workspace) |
| Continue.dev | `mcpServers:` (YAML) | `~/.continue/config.yaml` |
| Claude Desktop | `"mcpServers"` | `~/Library/Application Support/Claude/claude_desktop_config.json` |

## Non-MCP clients

For editors without MCP support (currently: Aider), use the HTTP bridge:

- `POST http://127.0.0.1:51894/api/observe` — ingest an observation
- `GET  http://127.0.0.1:51894/api/search?q=<query>` — retrieve relevant context
- `GET  http://127.0.0.1:51894/api/health` — liveness check
- Dashboard: `http://127.0.0.1:51893`

Start the bridge alongside the MCP server with a single command:

```bash
context-mem serve
# or, zero-install:
npx context-mem serve
```

Both the MCP stdio interface and the HTTP bridge start together.

## Already working out of the box

**Claude Code** and **OpenHands** support MCP natively and require no special setup beyond adding the server:

```bash
# Claude Code
claude mcp add context-mem -- npx context-mem serve

# OpenHands
# Add context-mem as an MCP server in OpenHands settings per their documentation.
```

No separate integration guide is needed for these — they follow the standard MCP server pattern.
