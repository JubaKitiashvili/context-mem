# Cline + context-mem

**Status:** Supported via native MCP.
**Difficulty:** Easy — configure via Cline's MCP settings UI or by editing `cline_mcp_settings.json` directly.

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- VS Code with the [Cline extension](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) installed
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

### 2. Configure Cline

Cline stores MCP server settings in:

```
~/.cline/data/settings/cline_mcp_settings.json
```

**Option A — Cline Settings UI (recommended):**

1. Open the Cline panel in VS Code (click the Cline icon in the sidebar).
2. Click the **MCP Servers** icon (plug icon) in the top-right of the Cline panel.
3. Navigate to the **Configure** tab.
4. Click **Configure MCP Servers** to open `cline_mcp_settings.json`.
5. Add the `context-mem` entry inside the `"mcpServers"` object:

```json
{
  "mcpServers": {
    "context-mem": {
      "command": "npx",
      "args": ["-y", "context-mem", "serve"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

6. Save the file. Cline picks up changes automatically.

**Option B — Cline CLI:**

```bash
cline mcp add context-mem npx -- -y context-mem serve
```

### 3. Verify

Open a new Cline conversation and ask:

> "What MCP tools do you have available?"

You should see context-mem tools in the response (`observe`, `recall`, `search`, `ask`, and others). As a functional test:

```
Use context-mem observe to store: "Cline integration test — working"
Then use context-mem recall to retrieve it.
```

You can also click the MCP Servers panel to confirm context-mem appears with a green status indicator.

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` — capture session context | Works |
| `recall` / `search` — retrieve past context | Works |
| `ask` — natural-language memory query | Works |
| 44 MCP tools total | Works |
| `autoApprove` list for hands-free use | Works |
| Dashboard at :51893 | Works (open in browser manually) |

Setting `"autoApprove": ["observe", "recall", "search", "ask"]` lets context-mem tools run without a confirmation prompt on every call, which is recommended for memory tools.

## Troubleshooting

- **Server shows red/error status:** Click the server name in the MCP panel to see the error log. Common cause: `npx` not found — use the absolute path (`"command": "/usr/local/bin/npx"`).
- **Tools not appearing:** Ensure the JSON file is valid. Check with: `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" ~/.cline/data/settings/cline_mcp_settings.json`.
- **Cline restarts the server on every message:** This is normal — Cline manages server lifecycle. context-mem's database persists across restarts, so no data is lost.
- **`cline_mcp_settings.json` not found:** Launch Cline at least once after installation and the file will be created. Then add your entry.

## Uninstall

Remove the `"context-mem"` entry from `cline_mcp_settings.json`. Optionally:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [Roo Code integration](./roo-code.md) — Cline fork with identical MCP config format
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
