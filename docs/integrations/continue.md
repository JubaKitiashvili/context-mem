# Continue.dev + context-mem

**Status:** Supported via native MCP.
**Difficulty:** Easy — add one entry to `~/.continue/config.yaml` (or `config.json`).

## Prerequisites

- context-mem installed globally: `npm install -g context-mem` (or use `npx` for zero-install)
- VS Code or JetBrains IDE with the [Continue extension](https://marketplace.visualstudio.com/items?itemName=Continue.continue) installed
- Continue v0.9.230 or later (MCP support)
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

### 2. Configure Continue

Continue reads MCP servers from its config file:

```
~/.continue/config.yaml    (preferred, YAML format)
~/.continue/config.json    (legacy JSON format — still supported)
```

**YAML config (recommended for Continue v0.9.230+):**

Open `~/.continue/config.yaml` and add the `mcpServers` section:

```yaml
mcpServers:
  - name: context-mem
    command: npx
    args:
      - "-y"
      - "context-mem"
      - "serve"
```

If the file already has a `mcpServers:` key, add the new entry under it.

**Legacy JSON config (`~/.continue/config.json`):**

```json
{
  "mcpServers": [
    {
      "name": "context-mem",
      "command": "npx",
      "args": ["-y", "context-mem", "serve"]
    }
  ]
}
```

**Tip — Continue also supports dropping MCP JSON files directly:**

Place any standard `mcpServers`-format JSON file in `~/.continue/mcpServers/` and Continue will auto-discover it. This is useful if you share a single MCP config across multiple clients:

```
~/.continue/mcpServers/context-mem.json
```

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

### 3. Verify

Open Continue chat in VS Code (`⌘ L` or `⌘ ⇧ L` for a new session) and ask:

> "What MCP tools do you have available?"

You should see context-mem tools in the response. As a functional test:

```
Use context-mem observe to store: "Continue integration test — working"
Then use context-mem recall to retrieve it.
```

## Features in this IDE

| Feature | Status |
|---|---|
| `observe` — capture session context | Works |
| `recall` / `search` — retrieve past context | Works |
| `ask` — natural-language memory query | Works |
| 44 MCP tools total | Works |
| Works in both VS Code and JetBrains | Yes — same config file |
| Dashboard at :51893 | Works (open in browser manually) |

Continue works identically in VS Code and JetBrains because it uses a single shared `~/.continue/config.yaml` — configure once, works everywhere.

## Troubleshooting

- **MCP tools not appearing:** Open the Continue extension logs (`⌘ ⇧ P` → "Continue: View Logs") and look for server startup errors.
- **`npx` not found:** Use the absolute path: `command: /usr/local/bin/npx` (YAML) or `"command": "/usr/local/bin/npx"` (JSON).
- **YAML indentation errors:** YAML is sensitive to spaces. Use 2-space indentation throughout. Validate with `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" ~/.continue/config.yaml`.
- **JSON still used after migrating to YAML:** If both files exist, Continue may prefer one over the other depending on the version. Check the Continue release notes and remove the old file if needed.
- **JetBrains: config not loading:** Ensure the Continue JetBrains plugin is version 1.0 or later. Restart the IDE after editing `config.yaml`.

## Uninstall

Remove the context-mem entry from `~/.continue/config.yaml` (or `config.json`). Optionally:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [VS Code integration](./vscode.md)
- [JetBrains AI integration](./jetbrains-ai.md)
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
