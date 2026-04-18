# Twitter Thread — context-mem v4.0 Launch

Post after HN goes live (cross-promote). Thread order: 1/ through 10/.

Screenshot/clip placeholders are marked with `[screenshot: filename]`. Record these before posting.

---

**1/**
Your AI coding assistant has two problems:
- It forgets everything between sessions
- Tool output floods the context window within a session

context-mem v4.0 fixes both. Thread 🧵

---

**2/**
v4.0 is the LLM Wiki release.

Andrej Karpathy described the pattern in April. context-mem was ~85% there. v4.0 ships the rest.

Dual-pillar: Memory (LLM Wiki) + Compression (15 summarizers).

https://github.com/JubaKitiashvili/context-mem/releases/tag/v4.0.0

---

**3/**
How the memory pillar works:

Every observation your AI makes auto-syncs to a Markdown vault. Entities get pages. Topics get pages. Everything links.

SQLite is authoritative. The vault is a synthesized, human-readable view.

[screenshot: vault-entity-page.png]

---

**4/**
Open `.context-mem/vault/` in Obsidian.

The graph view updates live as your session runs. Entities appear. Wikilinks connect them. The wiki builds itself.

[screenshot: obsidian-graph-live.gif]

Ask "which DB did we pick and why?" — context-mem answers from the wiki and files the answer as a new page.

---

**5/**
The compression pillar:

15 content-aware summarizers intercept tool output before it hits context.

Test output → failures only.
Stack traces → user-code frames only.
File diffs → changed lines only.

Measured result: 365 KB → 3.2 KB. 99% token savings.

[screenshot: compression-dashboard.png]

---

**6/**
Works with 10 editors:

Claude Code · OpenHands · Cursor · Cline · Roo Code · Windsurf · Continue · VS Code · JetBrains AI · Aider

Each has a dedicated integration guide.

docs/integrations/ → three config lines per editor.

---

**7/**
Benchmarks, honestly:

Retrieval recall: 97.8% R@5 on LongMemEval (pure local). 100% with Haiku judge.

But recall ≠ answer quality. v4.0 publishes the first E2E QA baseline — retrieve → generate → judge. That's the number that matters.

Methodology: docs/benchmarks/methodology.md

---

**8/**
Also shipping: Context Protocol v1 (Draft RFC).

AI memory systems don't interoperate today. Context Protocol is a minimal spec: vault filesystem / MCP tool surface / HTTP bridge. Three compliance levels. Open for community review.

https://github.com/JubaKitiashvili/context-mem/blob/main/docs/context-protocol-v1.md

---

**9/**
Credit where it's due:

The LLM Wiki framing comes from Andrej Karpathy's April 4 gist. Well worth reading if you think about AI memory at all.

https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Also: @AlexisOlson for pushing on benchmark methodology rigor (issue #6). Those callouts made the project more honest.

---

**10/**
Try it:

```
npm install -g context-mem
cd your-project
context-mem serve
```

Then open `.context-mem/vault/` in Obsidian (optional but worth it for the graph view).

npm: https://www.npmjs.com/package/context-mem
repo: https://github.com/JubaKitiashvili/context-mem

---

## Notes for voice pass

- Tweet 9: Karpathy is not tagged (`@karpathy`) by default. Add the tag if you're comfortable with it — but only if you'd be comfortable with the attention it brings.
- All URLs use the project's canonical GitHub. Don't shorten them — Twitter auto-shortens to ~23 chars anyway.
- Screenshots that don't exist yet: `vault-entity-page.png`, `obsidian-graph-live.gif`, `compression-dashboard.png`. Record/capture before posting.
- Tweet 4 (`demo-obsidian-graph-live.gif`) is the highest-value visual — prioritize capturing this one.
- Character counts have been estimated at ~200–260 chars per tweet excluding screenshots. Do a final count pass on tweet 2 and tweet 8 which are close to 280 with URLs included.
