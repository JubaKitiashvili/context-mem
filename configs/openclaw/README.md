# context-mem for OpenClaw

## Option 1: Native ContextEngine Plugin (recommended)

```bash
openclaw plugins install @context-mem/openclaw-plugin
```

See [openclaw-plugin/](../../openclaw-plugin/) for full documentation.

## Option 2: MCP Server

Add to your OpenClaw MCP configuration:

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
