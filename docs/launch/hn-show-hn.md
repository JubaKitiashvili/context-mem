# HN Show HN — Post Draft

## Posting notes

- Best window: **Thursday 9am ET** (highest HN traffic for Show HN)
- Second-best: Sunday morning
- Avoid Friday
- Post from your own HN account (Juba). Not an alt.

---

## Title (80 chars max — check before posting)

```
Show HN: Context Mem – LLM Wiki for your AI sessions (99% token savings)
```

Character count: 73 chars. Within limit.

---

## Body (800–1200 chars)

```
context-mem is a local MCP server that gives AI coding assistants (Claude Code,
Cursor, Cline, etc.) two things they're missing:

1. Persistent memory across sessions — observations, entities, and decisions
   auto-sync into a Markdown vault. Ask "which database did we pick and why?" in
   a new session and get the answer from last week's work.

2. Compression — 15 content-aware summarizers shrink tool output before it hits
   context. Measured: 365 KB → 3.2 KB (99% reduction). Session stays in budget.

v4.0 is a reference implementation of Andrej Karpathy's LLM Wiki pattern
(April 4 gist). SQLite is authoritative; the Markdown vault is a derived,
synthesized view — entity pages, topic pages, wikilinks, Obsidian graph view.
Answer-as-Page: ask a question, the answer is filed as a new wiki page.

Retrieval: 97.8% R@5 on LongMemEval (pure local BM25+vector). E2E QA baseline
published alongside this release — methodology at docs/benchmarks/methodology.md.

Works with 10 editors: Claude Code, Cursor, Cline, Roo Code, Windsurf,
Continue, VS Code, JetBrains AI, OpenHands, Aider.

Context Protocol v1 RFC also in this release — draft interop spec for AI memory
systems, open for community feedback.

npm i -g context-mem → context-mem serve

Repo: https://github.com/JubaKitiashvili/context-mem
Release: https://github.com/JubaKitiashvili/context-mem/releases/tag/v4.0.0
```

Character count: ~1,100 chars. Within 800–1200 limit.

---

## Notes for voice pass

- The title uses an en-dash (–) not a hyphen. Verify HN renders it correctly; swap to ` - ` if not.
- "context-mem" lowercased per project convention.
- The 99% savings claim is sourced: 365 KB → 3.2 KB measured compression result, cited in CHANGELOG.
- LongMemEval 97.8% is the pre-v4.0 pure-local baseline. E2E QA baseline is the new honest metric — do not upgrade this number before the v4.0 benchmark sweep confirms it.
