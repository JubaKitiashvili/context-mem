# Roo Code + context-mem

**Status:** Supported via native MCP.
**Difficulty:** Easy — configure via Roo Code's MCP settings UI or by editing the global `mcp_settings.json` / project `.roo/mcp.json`.

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- VS Code with the [Roo Code extension](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline) installed
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

### 2. Configure Roo Code

Roo Code supports two levels of MCP configuration:

| Scope | File |
|---|---|
| Global (all workspaces) | Accessible via **Edit Global MCP** in the Roo Code MCP settings view |
| Project-specific | `.roo/mcp.json` in the project root (takes precedence over global) |

**Option A — Roo Code UI (recommended):**

1. Open the Roo Code panel in VS Code.
2. Click the **server icon** in the top navigation of the Roo Code pane.
3. At the bottom, click **Edit Global MCP** to open the global `mcp_settings.json`, or **Edit Project MCP** to open/create `.roo/mcp.json`.
4. Add the `context-mem` entry:

```json
{
  "mcpServers": {
    "context-mem": {
      "command": "npx",
      "args": ["-y", "context-mem", "serve"],
      "alwaysAllow": ["observe", "recall", "search", "ask"],
      "disabled": false
    }
  }
}
```

5. Save the file. Roo Code detects changes automatically.

**Option B — Direct file edit (project-level):**

Create `.roo/mcp.json` in your project root with the JSON above. Commit it to share the config with your team.

### 3. Verify

Open a new Roo Code conversation and ask:

> "What MCP tools do you have available?"

You should see context-mem tools listed. As a functional test:

```
Use context-mem observe to store: "Roo Code integration test — working"
Then use context-mem recall to retrieve it.
```

The MCP panel in Roo Code shows a status indicator for each server — confirm context-mem appears in green.

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` — capture session context | Works |
| `recall` / `search` — retrieve past context | Works |
| `ask` — natural-language memory query | Works |
| 44 MCP tools total | Works |
| `alwaysAllow` for hands-free approval | Works |
| Project-level config (`.roo/mcp.json`) | Works — great for team sharing |
| Dashboard at :51893 | Works (open in browser manually) |

The `alwaysAllow` array lets context-mem memory tools run without per-call confirmation. Recommended: include at minimum `observe`, `recall`, `search`, and `ask`.

## Troubleshooting

- **Server fails to start:** Click the server in the MCP panel to view logs. Most common cause: `npx` not on PATH. Use absolute path: `"command": "/usr/local/bin/npx"`.
- **Project config not picked up:** The `.roo/mcp.json` file must be in the exact directory that Roo Code considers the workspace root. Open VS Code at that folder level.
- **Global config location:** If you are unsure where the global `mcp_settings.json` lives, use **Edit Global MCP** in the UI — it opens the file directly.
- **Conflicting global vs. project config:** Project-level config takes precedence. If context-mem is disabled globally but enabled in `.roo/mcp.json`, the project config wins.

## Uninstall

Remove the `"context-mem"` entry from `mcp_settings.json` and/or `.roo/mcp.json`. Optionally:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [Cline integration](./cline.md) — Roo Code's upstream; config format is nearly identical
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
