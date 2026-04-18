# Reddit Post — /r/LocalLLaMA

---

## Title

```
context-mem v4.0: local-first LLM Wiki + 15-summarizer compression for AI coding assistants (99% token savings)
```

---

## Body

I shipped context-mem v4.0 today. It is a fully local MCP server for AI coding assistants. No cloud required. Nothing leaves your machine unless you configure an LLM provider for optional reranking.

**What it does**

Two problems, two pillars:

**Memory.** Your AI coding session ends and everything is forgotten. v4.0 implements the LLM Wiki pattern — observations auto-sync to a local Markdown vault. Entity pages, topic pages, wikilinks. Open the vault in Obsidian and you get a graph view of your project's knowledge building in real time. The next session starts from the wiki, not from zero.

**Compression.** Tool output from AI agents (grep, file reads, test runs, diffs) is extremely verbose. 15 content-aware summarizers intercept that output before it reaches context. Each summarizer is specialized: test output keeps only failures, stack traces keep only user-code frames, file diffs keep only changed lines. Measured: 365 KB → 3.2 KB. 99% token savings.

**The local-first architecture**

- BM25 + hybrid vector search runs entirely on device
- Vector embeddings via `nomic-embed-text-v1.5` (768-dim, Hugging Face Transformers) — no API call, no latency
- SQLite is the authoritative store; the Markdown vault is a derived, synced view
- LLM reranking (Claude Haiku) is optional and off by default — retrieval is fully local without it
- Privacy filter: `private`-flagged observations never reach disk or the vault

**Benchmarks (honest disclosure)**

Retrieval recall: 97.8% R@5 on LongMemEval in pure local mode (BM25 + vector). 100% with optional Haiku reranker.

Important caveat: those numbers measure whether the right observation lands in top-5. They do not measure answer quality. v4.0 publishes a first E2E QA baseline — retrieve → generate → judge — alongside the release. Methodology is documented.

**10 editor integrations**

Claude Code, OpenHands, Cursor, Cline, Roo Code, Windsurf, Continue, VS Code, JetBrains AI, Aider. Each has a dedicated guide in `docs/integrations/`.

**Install**

```bash
npm install -g context-mem
cd your-project
context-mem serve
```

Repo: https://github.com/JubaKitiashvili/context-mem  
Release: https://github.com/JubaKitiashvili/context-mem/releases/tag/v4.0.0  
npm: https://www.npmjs.com/package/context-mem

The LLM Wiki framing comes from Andrej Karpathy's April 4 gist — credit where it's due. Happy to answer questions on the compression architecture or retrieval approach.
