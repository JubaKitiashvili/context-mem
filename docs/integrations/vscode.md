# VS Code + context-mem

**Status:** Supported via native MCP (GitHub Copilot agent mode, VS Code 1.99+).
**Difficulty:** Easy — add one JSON file to your workspace or user profile.

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- VS Code 1.99 or later (MCP support landed in the April 2025 release)
- GitHub Copilot extension (for agent mode) **or** Continue extension (see below)
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

### 2. Configure VS Code

VS Code reads MCP servers from:

| Scope | File |
|---|---|
| Workspace (shareable) | `.vscode/mcp.json` in the project root |
| Global (user profile) | Managed via **MCP: Add Server** command → choose "User" |

**Note:** VS Code uses `"servers"` as the top-level key (not `"mcpServers"` like other editors).

Create or edit `.vscode/mcp.json`:

```json
{
  "servers": {
    "context-mem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "context-mem", "serve"]
    }
  }
}
```

**Alternative — Command Palette:**

1. Open the Command Palette (`⌘ ⇧ P`).
2. Run **MCP: Add Server**.
3. Choose **stdio**, enter `npx` as the command, `-y context-mem serve` as the args.
4. Choose **Workspace** (saves to `.vscode/mcp.json`) or **User** (saves globally).

**Alternative — Continue extension:**

If you are using [Continue.dev](./continue.md) instead of Copilot, follow the Continue guide — it works in both VS Code and JetBrains.

### 3. Verify

Open GitHub Copilot Chat in agent mode (click the agent icon or press `⌘ ⇧ I`), then ask:

> "What MCP tools do you have available?"

You should see context-mem tools listed (`observe`, `recall`, `search`, `ask`, and others). As a functional test:

```
Use context-mem observe to store: "VS Code integration test — working"
Then use context-mem recall to retrieve it.
```

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` — capture session context | Works (agent mode) |
| `recall` / `search` — retrieve past context | Works (agent mode) |
| `ask` — natural-language memory query | Works (agent mode) |
| 44 MCP tools total | Works |
| Dashboard at :51893 | Works (open in browser manually) |
| Inline completions / chat (non-agent) | MCP tools not available in inline mode |

MCP tools are only available in **agent mode** (Copilot Chat with the agent toggle enabled). They are not invoked during inline tab-completion or standard chat without agent mode.

## Troubleshooting

- **MCP: Add Server command not found:** Update VS Code to 1.99+. Run `code --version` to confirm.
- **Tools not listed after config:** Open the Output panel (`⌘ ⇧ U`) and select **GitHub Copilot** or **MCP** from the dropdown to see server startup logs.
- **`npx` not found:** VS Code may launch without your full shell PATH. Use the absolute path: `"command": "/usr/local/bin/npx"`. Find it with `which npx` in your terminal.
- **`.vscode/mcp.json` not recognized:** Ensure you opened the workspace folder (not just a single file) and the file is at the exact root of the opened workspace.
- **Copilot agent mode not available:** Agent mode requires a Copilot subscription. Without it, use the Continue extension instead (see [continue.md](./continue.md)).

## Uninstall

Delete or remove the `"context-mem"` entry from `.vscode/mcp.json`. Optionally:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [Continue.dev integration](./continue.md)
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
