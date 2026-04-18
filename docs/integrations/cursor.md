# Cursor + context-mem

**Status:** Supported via native MCP.
**Difficulty:** Easy — add one JSON block to `~/.cursor/mcp.json`, then reload.

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- Cursor 0.43 or later (MCP support ships with the Agent tab)
- Node 18 or later

## Quick Start

### 1. Start context-mem

```bash
# In your project root (or any directory)
context-mem serve
```

This starts the MCP server on stdio, an HTTP bridge on port 51894, and the dashboard on port 51893.

With `npx` (no global install required):

```bash
npx context-mem serve
```

### 2. Configure Cursor

Cursor reads MCP server definitions from two locations:

| Scope | File |
|---|---|
| Global (all projects) | `~/.cursor/mcp.json` |
| Project-only | `.cursor/mcp.json` in the project root |

Open (or create) `~/.cursor/mcp.json` and add:

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

If you already have other servers in the file, add the `"context-mem"` entry inside the existing `"mcpServers"` object.

**Alternative — Cursor Settings UI:**

1. Open **Cursor Settings** (⌘ , on macOS).
2. Navigate to **Features → MCP**.
3. Click **Add New MCP Server**.
4. Set transport to **stdio**, name it `context-mem`, and enter `npx -y context-mem serve` as the command.

**Alternative — Cursor CLI:**

```bash
cursor mcp add context-mem -- npx -y context-mem serve
```

### 3. Verify

Open a new Cursor Agent chat and ask:

> "What MCP tools do you have available?"

You should see `context-mem` tools listed (e.g., `observe`, `recall`, `search`, `ask`). As a functional test:

```
Use context-mem observe to store: "Cursor integration test — working"
Then use context-mem recall to retrieve the note you just stored.
```

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` — auto-capture AI session context | Works |
| `recall` / `search` — retrieve past context | Works |
| `ask` — natural-language memory query | Works |
| 44 MCP tools total | Works |
| Dashboard at :51893 | Works (open in browser manually) |

Cursor's Agent tab streams tool calls in real time, so you can watch context-mem tools being invoked as the agent works.

## Troubleshooting

- **Tools not appearing after adding config:** Cursor caches MCP registrations. Fully quit and relaunch Cursor, then open the Agent tab — tools should appear.
- **`npx` not found:** Ensure Node 18+ is on your `PATH`. Run `which npx` in your terminal to confirm. If Cursor launches from a GUI without your shell PATH, use the full path: `"command": "/usr/local/bin/npx"`.
- **Port 51894 / 51893 already in use:** Another context-mem instance is running. Run `pkill -f "context-mem serve"` to clear it, then retry.
- **`mcp.json` parse errors:** Validate the file with `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" ~/.cursor/mcp.json`. Trailing commas cause silent failures.
- **Project-level config ignored:** Ensure `.cursor/mcp.json` is in the exact root of the workspace Cursor has open, not a subdirectory.

## Uninstall

Remove the `"context-mem"` entry from `~/.cursor/mcp.json` (or delete `.cursor/mcp.json` if it was project-only). Optionally remove the global package:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
