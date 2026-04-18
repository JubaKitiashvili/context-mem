# Reddit Post — /r/ClaudeAI

---

## Title

```
I built a free MCP server that gives Claude Code persistent memory and 99% token savings — zero config to start
```

---

## Body

I've been building context-mem, an MCP server designed for Claude Code. v4.0 ships today. Here's what it does and how to wire it up in about 60 seconds.

**The two problems it solves**

Claude Code forgets everything when a session ends. You re-explain the same context, re-read the same files, re-confirm the same decisions. context-mem gives Claude Code a persistent memory — a local Markdown vault that updates incrementally as you work.

The second problem is context explosion. Claude Code calls tools constantly: file reads, grep, test runs, type-check output. That output is verbose. context-mem compresses it with 15 content-aware summarizers before it reaches Claude's context window. Measured: 365 KB → 3.2 KB. 99% reduction.

**60-second setup**

Install:
```bash
npm install -g context-mem
```

Add to your Claude Code MCP config (`~/.claude/mcp.json` or the project-level `.claude/mcp.json`):
```json
{
  "mcpServers": {
    "context-mem": {
      "command": "context-mem",
      "args": ["serve"]
    }
  }
}
```

That's it. Start a Claude Code session. Observations start flowing automatically.

**What Claude Code gets**

- `observe` — Claude records anything worth remembering: a decision, a file, a key finding
- `search` — unified retrieval across everything observed: entities, topics, sessions, knowledge
- `ask` — retrieve-then-answer with optional `save_as_page: true` to persist the answer
- 44 more tools — timeline, graph neighbors, session handoff, entity merge suggestions, and more

**The memory vault**

All observations sync to `.context-mem/vault/` — plain Markdown with wikilinks. Entity pages auto-update. Topic pages aggregate. If you use Obsidian, open the vault directory for a live graph view of your project's knowledge.

v4.0 adds synthesis pages: entity pages are now rewritten as knowledge accumulates, not just appended. Claude Haiku rewrites them when you have `ai_curation.enabled = true`; a deterministic template runs otherwise.

**Compression for long Claude Code sessions**

The 15 summarizers are content-aware — not generic truncation. A test run summarizer keeps failure messages and total counts, drops passing test output. A Python traceback summarizer keeps the exception type, message, and topmost user-code frame, skips library frames. The session stays in budget.

**Honest benchmarks**

Retrieval recall on LongMemEval: 97.8% R@5 in pure local mode. 100% with an optional Claude Haiku reranker. These are retrieval numbers — v4.0 also publishes the first E2E QA baseline (retrieve → answer → judge), which is the more meaningful metric.

**Links**

npm: https://www.npmjs.com/package/context-mem  
Repo: https://github.com/JubaKitiashvili/context-mem  
Release v4.0.0: https://github.com/JubaKitiashvili/context-mem/releases/tag/v4.0.0  
Obsidian plugin: https://github.com/JubaKitiashvili/context-mem/tree/main/obsidian-plugin

Open source, MIT. Happy to answer questions about the MCP integration or how the compression layer interacts with Claude's tool calls.
