# Windsurf + context-mem

**Status:** Supported via native MCP (Cascade).
**Difficulty:** Easy — edit one JSON file or use the Windsurf settings UI.

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- Windsurf 1.0 or later (Cascade with MCP support)
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

### 2. Configure Windsurf

Windsurf's Cascade reads MCP servers from:

```
~/.codeium/windsurf/mcp_config.json
```

Open (or create) that file and add:

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

**Alternative — Windsurf Settings UI:**

1. Open **Settings** (⌘ , on macOS).
2. Navigate to **Tools → Windsurf Settings → Add Server**.
3. If context-mem is not in the plugin store, click **View Raw Config** to open `mcp_config.json` directly.
4. Add the JSON entry above, save, then click the **refresh** button in the MCP panel.

### 3. Verify

Open Cascade (the Windsurf AI panel) and ask:

> "What MCP tools do you have available?"

You should see `context-mem` tools listed. As a functional test:

```
Use context-mem observe to store: "Windsurf integration test — working"
Then use context-mem recall to retrieve it.
```

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` — capture session context | Works |
| `recall` / `search` — retrieve past context | Works |
| `ask` — natural-language memory query | Works |
| 44 MCP tools total | Works |
| Dashboard at :51893 | Works (open in browser manually) |

Cascade renders tool calls inline in the chat, showing each context-mem tool as it is invoked.

## Troubleshooting

- **Tools not showing after config change:** Click the **refresh** button (circular arrow) in the Cascade MCP panel. If that doesn't work, restart Windsurf.
- **`npx` not found:** Windsurf may not inherit your full shell PATH when launched from a GUI. Use the absolute path: `"command": "/usr/local/bin/npx"` (find it with `which npx`).
- **Config file location changed:** Older Windsurf versions used `~/.codeium/mcp_config.json` (without the `windsurf/` subdirectory). If `~/.codeium/windsurf/mcp_config.json` does not exist yet, create it. Check Windsurf's **View Raw Config** button for the canonical path on your installation.
- **Port conflicts:** Run `lsof -i :51894` to check for conflicting processes. Stop any stale context-mem instances with `pkill -f "context-mem serve"`.

## Uninstall

Remove the `"context-mem"` entry from `~/.codeium/windsurf/mcp_config.json`. Optionally remove the global package:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
