# Reddit Post — /r/ObsidianMD

---

## Title

```
I built an AI that writes your Obsidian vault for you — live, from your coding sessions
```

---

## Body

I've been using Obsidian as the frontend for an AI memory system I've been building. v4.0 shipped today and I wanted to share it here because the Obsidian integration is now a first-class part of the project.

**What it is**

context-mem is a local MCP server that gives AI coding assistants (Claude Code, Cursor, Cline, etc.) long-term memory. The memory is stored as Markdown in an Obsidian vault.

You run `context-mem serve`, open `.context-mem/vault/` as your Obsidian vault, and start a coding session. As the AI works — reading files, running commands, making decisions — observations get synthesized into entity pages and topic pages in real time. The graph view in Obsidian updates live.

[screenshot: synthesis-graph-update.png]

**The vault structure**

```
.context-mem/vault/
├── CLAUDE.md          ← project memory schema (auto-imported by Claude Code)
├── index.md           ← live table of contents, top entities, recent topics
├── log.md             ← append-only event log
├── entities/          ← one page per entity (person, file, DB, decision...)
├── topics/            ← one page per topic
├── sessions/          ← session summaries
├── knowledge/         ← saved facts, promoted insights
└── answers/           ← Answer-as-Page output (new in v4.0)
```

All pages use `[[wikilinks]]`, so the graph view is meaningful. Entity pages link to the topics they appear in. Topics link back to sessions.

**Obsidian plugin v1**

v4.0 ships a dedicated Obsidian plugin (manual install for now; community store submission is v4.1):

- Sidebar pane showing bridge status, recent log tail, and quick-observe
- Commands: observe selected text, observe this file, open dashboard, refresh sidebar
- Status bar indicator showing connection state
- Settings: bridge host/port, auto-detect vault

[screenshot: obsidian-plugin-sidebar.png]

**Answer-as-Page**

This one is my favorite. You ask your AI assistant a question — "which database did we pick and why?" — and instead of the answer disappearing into chat history, it gets filed as a new page in `vault/answers/` with source citations. The vault becomes a growing knowledge base, not just a session log.

**Privacy**

Observations flagged `private` are never written to vault files. The vault is a filtered, synthesized view of your store — it will never accidentally surface content you've marked sensitive.

**Install**

```bash
npm install -g context-mem
cd your-project
context-mem serve
# Open .context-mem/vault/ in Obsidian
```

Repo: https://github.com/JubaKitiashvili/context-mem  
Obsidian plugin: https://github.com/JubaKitiashvili/context-mem/tree/main/obsidian-plugin  
Release: https://github.com/JubaKitiashvili/context-mem/releases/tag/v4.0.0

The LLM Wiki pattern is from Andrej Karpathy's [April 4 gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Happy to talk vault structure, synthesis logic, or plugin architecture.
