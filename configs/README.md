# Platform Configs

Copy the relevant files to integrate context-mem with your AI coding assistant.

## MCP Server Configs

Each platform needs an MCP config to connect to the context-mem server.

| Platform | Config File | Copy To |
|----------|------------|---------|
| Claude Code | `claude-code/CLAUDE.md` | Project root |
| Cursor | `cursor/mcp.json` | `.cursor/mcp.json` |
| Windsurf | `windsurf/mcp_config.json` | `~/.codeium/windsurf/mcp_config.json` |
| Copilot | `copilot/mcp.json` | `.vscode/mcp.json` |
| Cline | `cline/cline_mcp_settings.json` | VS Code Cline MCP settings |
| Roo Code | `roo-code/mcp_settings.json` | VS Code Roo Code MCP settings |
| Gemini CLI | `gemini-cli/GEMINI.md` | Project root + `.gemini/settings.json` |
| Antigravity | `antigravity/GEMINI.md` | Project root |
| OpenClaw | `openclaw/mcp_config.json` | OpenClaw MCP config |
| Goose | `goose/recipe.yaml` | `goose session --recipe recipe.yaml` |
| CrewAI | `crewai/example.py` | Python project |
| LangChain | `langchain/example.py` | Python project |

## AI Rules / Instructions

Rules tell the AI **how and when** to use context-mem tools automatically.

| Platform | Rules File | Copy To |
|----------|-----------|---------|
| Claude Code | `claude-code/CLAUDE.md` | Project root `CLAUDE.md` |
| Cursor | `cursor/context-mem.mdc` | `.cursor/rules/context-mem.mdc` |
| Windsurf | `windsurf/context-mem.md` | `.windsurf/rules/context-mem.md` |
| Copilot | `copilot/copilot-instructions.md` | `.github/copilot-instructions.md` |
| Cline | `cline/context-mem.md` | `.clinerules/context-mem.md` |
| Roo Code | `roo-code/context-mem.md` | `.roo/rules/context-mem.md` |
| Gemini CLI | `gemini-cli/GEMINI.md` | Project root `GEMINI.md` |

## Quick Start

```bash
# Example: Cursor setup
cp configs/cursor/mcp.json .cursor/mcp.json
cp configs/cursor/context-mem.mdc .cursor/rules/context-mem.mdc
```
