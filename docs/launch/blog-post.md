# Your AI Remembers Everything, and Your Sessions Fit in Context
## context-mem v4.0 — the LLM Wiki release

---

### The two problems this fixes

AI assistants forget everything when the session ends. You start fresh each time: same context, same re-explanations, same "as I mentioned last week." The raw session history exists in your head but not in the model's. Over weeks of real work this is not a minor inconvenience — it's a fundamental limit on how much an AI can help you with a real project.

The second problem appears inside a single session. Modern AI agents — Claude Code, Cursor, Cline — call tools constantly: grep results, file reads, test output, type-check errors. That output piles up. A busy session can generate hundreds of kilobytes of raw content. Context windows are large but not infinite, and verbose tool output is the fastest way to exhaust them. When the context window fills, the agent starts forgetting things that happened two hundred lines ago.

---

### Andrej's gist, two weeks ago

On April 4 Andrej Karpathy published a [short gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) describing a pattern he called the LLM Wiki: a structured Markdown vault that sits alongside your project, updated incrementally by the AI itself. Raw observations come in, get synthesized into entity and topic pages, and the wiki becomes the AI's long-term memory — searchable, human-readable, version-controlled. context-mem was already about 85% of this pattern. v4.0 ships the remaining 15% and repositions around this framing.

---

### One tool, two pillars

context-mem solves both problems with a single MCP server you run locally. The Memory pillar addresses session amnesia. The Compression pillar addresses context explosion. Both are live in v4.0.

---

#### Pillar 1 — Memory: the LLM Wiki

The vault is a directory of plain Markdown files that mirrors your SQLite observation store. Every observation the AI makes gets written to `.context-mem/vault/`. Entity pages auto-update incrementally — a page for a person, a file, a database, a decision. Topic pages aggregate across entities. Everything links with `[[wikilinks]]`, so the graph view in Obsidian shows your project's knowledge structure building in real time.

The key features:

- **Markdown vault auto-syncs from SQLite.** SQLite is authoritative; the vault is derived. The sync is live — observe something, the page updates.
- **Entity and topic synthesis pages update incrementally.** When `vault.synthesis` is enabled, entity pages are rewritten as knowledge accumulates. A deterministic template runs when no LLM provider is configured; Claude Haiku is used when `ai_curation.enabled = true`.
- **Wikilinks and Obsidian graph view out of the box.** Open `.context-mem/vault/` as an Obsidian vault and you get a live knowledge graph of your project.
- **Privacy-first.** Observations flagged `privacy_level='private'` are never written to disk. The vault is a filtered projection of your store, not a raw dump.
- **Answer-as-Page.** Call `search({file_as: 'knowledge'})` or `ask({save_as_page: true})` and the synthesized answer is persisted to `vault/answers/` with source citations. The AI's answers become retrievable knowledge, not ephemeral output.

---

#### Pillar 2 — Compression: 15 content-aware summarizers

The compression layer intercepts tool output before it lands in context and shrinks it. v4.0 ships 15 content-aware summarizers:

1. **File diff** — extracts changed lines only, drops unchanged context
2. **Test output** — keeps failures and counts, drops passing test bodies
3. **Stack trace** — topmost relevant frames, drops library internals
4. **Code block** — strips repetitive boilerplate
5. **Shell command output** — first/last N lines for long command output
6. **JSON** — keys-only summary for large objects
7. **Markdown** — headings and first line per section
8. **Log stream** — deduplicates repeated log lines
9. **File listing** — tree summary with file counts by type
10. **Search results** — top-N only, score summary
11. **Error block** — message + type, deduplicated
12. **HTTP response** — status + truncated body
13. **Dependency list** — name + version only
14. **Generic text** — extractive summarization for unclassified content
15. **Python traceback** (new in v4.0) — extracts exception type + message + topmost user-code frame, skips `site-packages` / `venv` library frames

The compression is adaptive across four tiers — light, moderate, aggressive, maximum — selected based on available context budget. The measured result: 365 KB raw tool output → 3.2 KB in context, a 99% reduction. Important observations can be pinned verbatim; pinned content is never compressed.

---

### See it work

You open a new Claude Code session. context-mem is already running (`context-mem serve`). You've opened `.context-mem/vault/` as an Obsidian vault in a second window.

You ask Claude Code to figure out the database situation in your project. Claude Code reads several files, runs some queries, calls grep. All of that output is compressed before it reaches context. The entities it encounters — `PostgresAdapter`, `migration_v17`, `DatabaseConfig` — appear as new pages in the vault. The Obsidian graph view updates live.

Thirty minutes in, you ask: "which database did we pick and why?" context-mem searches the wiki, finds the decision recorded in `entities/DatabaseConfig.md` with citations back to the session that surfaced it, and returns a direct answer. You call `ask({save_as_page: true})` and the answer is filed in `vault/answers/` for the next session.

The next session starts with the wiki already populated. Claude Code reads the relevant entity pages upfront rather than re-reading every source file. The session starts from where the last one ended.

---

### Architecture: the three Karpathy layers

The schema follows the three-layer model formalized in [`docs/llm-wiki-schema.md`](../llm-wiki-schema.md):

**Source layer (raw):** Observations flow in from tool calls. SQLite stores them with entity tags, topic tags, timestamps, session IDs, and privacy levels. This is the append-only ledger.

**Wiki layer (synthesized):** Entity and topic pages are derived views over the source layer. The synthesis process runs on a debounced scheduler — observations accumulate, then the page is rewritten. A minimum-observations guard (default 3) prevents noisy single-observation pages from cluttering the vault.

**Schema layer (CLAUDE.md convention):** The vault's root-level `CLAUDE.md` — imported by Claude Code automatically — encodes the directory layout, page types, linking rules, and agent workflows. This is what makes the wiki self-describing to any AI that opens the project.

---

### Benchmarks, honestly

On retrieval recall: 97.8% R@5 on LongMemEval (500-question) in pure local mode (BM25 + hybrid vector, no cloud); 100% R@5 with Claude Haiku as a semantic reranker. LoCoMo: 98.1%. MemBench: 98.0%. ConvoMem: 97.7%.

Those numbers measure whether the right observation lands in the top-5 retrieved candidates. They do not measure whether the AI produces the correct answer from that evidence — that is the harder question. Per the methodology review from @AlexisOlson (issue #6), v4.0 introduces the first E2E QA baseline: retrieve top-k, generate an answer, judge it. The baseline results are published to `benchmarks/results/v4-release-2026-04-18.json` alongside this release. Methodology is documented at [`docs/benchmarks/methodology.md`](../benchmarks/methodology.md).

One deliberate change worth calling out: the synonym migration. Prior to v3.4, the benchmark query expansion included terms tuned to the test sets — "violin," "supervillain," "digestive" — that did not reflect real-world usage. v3.4 audited all 38 expansion entries: 28 moved to core, 7 deleted as benchmark-fitted. That migration is documented at `docs/benchmarks/synonym-migration-2026-04.md`. The retrieval numbers that remain after this cleanup are the honest numbers.

---

### For every editor

context-mem works as an MCP server. It is compatible with the ten most-used AI coding clients: **Claude Code, OpenHands, Cursor, Cline, Roo Code, Windsurf, Continue, VS Code (Copilot), JetBrains AI Assistant, and Aider** (via HTTP bridge). Each has a dedicated integration guide at [`docs/integrations/`](../integrations/). The config is usually three lines.

---

### Context Protocol v1 (Draft)

AI memory systems currently do not interoperate. A context store built for Claude Code is invisible to Cursor. An Obsidian plugin synced from one agent does not speak to another. [Context Protocol v1](../context-protocol-v1.md) is a draft RFC that defines a three-layer interop specification — vault filesystem, MCP tool surface, HTTP bridge — along with a resource model, identity addressing, and compliance levels (Core / Extended / Full). It is released alongside v4.0 for community review. The intent is a minimal, open standard that any memory layer can implement.

---

### What changed from v3.4 (shipped 2026-04-17)

- **Synthesis pages** — entity and topic pages now auto-update from the LLM or deterministic template; no more static snapshots
- **Answer-as-Page** — `ask()` and `search()` can persist answers with source citations into the vault
- **Obsidian plugin v1** — sidebar pane, quick-observe, status bar; manual install for this release (community store submission is v4.1)
- **Unified `search()` MCP tool** — supersedes 7 legacy retrieval tools; legacy tools remain callable with `_meta.deprecated: true` for forward guidance
- **Context Protocol v1 RFC** and eight IDE integration guides
- **Python traceback summarizer** (15th summarizer)
- **Compression analytics dashboard** at `/compression` — per-content-type breakdown, savings histogram
- **`tools.ts` refactored** — 2576-line god file split into 8 domain modules; `dashboard/server.js` split into 6 modules

---

### Try it

```bash
npm install -g context-mem
cd your-project
context-mem serve
# Then open .context-mem/vault/ in Obsidian if you want the graph view.
```

The MCP server starts on the default port. Your AI client connects via the MCP config (see [`docs/integrations/`](../integrations/) for client-specific setup). The vault populates on first use.

---

### What's next

**v4.1 "Network" (Month 3):** post-release polish from community feedback, HNSW vector index, bulk-ingest endpoint, Obsidian community-store submission, Context Protocol RFC v1.1.

**v5.0 "Platform" (Month 12):** multi-tenant memory, marketplace.

---

### License and credits

MIT. Built by Juba Kitiashvili.

Credit: [Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for the LLM Wiki paradigm framing; @AlexisOlson for benchmark-methodology rigor (issue #6); Vannevar Bush for the Memex idea (1945), referenced in the schema spec and Context Protocol.

---

[npm](https://www.npmjs.com/package/context-mem) | [GitHub](https://github.com/JubaKitiashvili/context-mem) | [Release v4.0.0](https://github.com/JubaKitiashvili/context-mem/releases/tag/v4.0.0) | [Obsidian plugin](https://github.com/JubaKitiashvili/context-mem/tree/main/obsidian-plugin) | [Context Protocol RFC](https://github.com/JubaKitiashvili/context-mem/blob/main/docs/context-protocol-v1.md)
