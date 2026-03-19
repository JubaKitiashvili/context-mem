# context-mem for VS Code

Context optimization for AI coding assistants — 99% token savings, zero configuration.

## Features

- **Status Bar** — Live token savings indicator
- **Sidebar Dashboard** — Real-time view of observations, search, knowledge base
- **Command Palette** — Start/stop server, search, stats, init

## Commands

| Command | Description |
|---------|-------------|
| `context-mem: Start Server` | Start the MCP server |
| `context-mem: Stop Server` | Stop the MCP server |
| `context-mem: Open Dashboard` | Open the web dashboard |
| `context-mem: Show Token Stats` | Display current session stats |
| `context-mem: Search Observations` | Search stored observations |
| `context-mem: Initialize in Workspace` | Set up context-mem in current project |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `context-mem.autoStart` | `true` | Auto-start MCP server on workspace open |
| `context-mem.port` | `51893` | Dashboard port |
| `context-mem.showStatusBar` | `true` | Show savings in status bar |
| `context-mem.statusBarRefreshInterval` | `10` | Refresh interval (seconds) |

## Requirements

- Node.js >= 18
- `context-mem` npm package (`npm install -g context-mem`)

## Links

- [npm package](https://www.npmjs.com/package/context-mem)
- [GitHub](https://github.com/JubaKitiashvili/context-mem)
- [Documentation](https://github.com/JubaKitiashvili/context-mem#readme)
