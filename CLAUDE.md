# context-mem Project Instructions

## Strategic Context (read first)

The **source of truth for direction, positioning, pricing, fundraising, roadmap** is:

📍 [`docs/superpowers/plans/2026-04-17-1b-company-architecture.md`](docs/superpowers/plans/2026-04-17-1b-company-architecture.md)

Read it before answering any strategic question. Update the Decision Log (§9) whenever a strategic call is made. Plans navigation: [`docs/superpowers/plans/INDEX.md`](docs/superpowers/plans/INDEX.md).

Current phase: **v3.4.0 "LLM Wiki Preview" shipped** (2026-04-18). Next: **v4.0.0 "Cognition"** (target 2026-05-22) — full synthesis pages, Obsidian plugin, 8 IDE integrations, Context Protocol v1 RFC, and the post-migration benchmark re-run to backfill `docs/benchmarks/synonym-migration-2026-04.md`.

## Auto-Observe Rule
When working on this project, use `mcp__context-mem__observe` to store:
- Every benchmark result (scores, per-category breakdown)
- Every decision about search strategy changes
- Every file modification with before/after scores
- Every failed experiment (what was tried, why it failed)

This ensures nothing is lost between sessions.

## Git Safety
- ALWAYS commit before any git checkout, revert, or stash operation
- Never overwrite uncommitted working files
- When experimenting, commit each iteration separately

## Benchmark Commands
```bash
npm run bench          # quick mode
npm run bench:full     # full benchmarks
node benchmarks/longmemeval.js /tmp/longmemeval-data/longmemeval_s_cleaned.json
node benchmarks/locomo.js /tmp/locomo/data/locomo10.json
node benchmarks/convomem.js --category all --limit 50
node benchmarks/membench.js /tmp/membench-data/MemData/FirstAgent --limit 500
node benchmarks/beam.js /tmp/beam/chats/100K
node benchmarks/lmeb.js /tmp/lmeb/eval_data
```

## Core Search Architecture (v3.2)
BM25 (src/plugins/search/bm25.ts) runs 8 strategies:
1. AND-mode (weight 2.0) — high precision
2. Phrase matching (1.9) — consecutive keyword pairs
3. Entity-focused (1.8) — proper nouns, dates
4. Sanitized FTS5 (1.5) — default tokenization
5. Relaxed AND (1.2) — entity + top keywords
6. OR-mode with synonym expansion (1.0) — broad recall
7. Individual keywords (0.5) — long-tail catch
7b. Individual synonym search (0.2) — semantic gap bridge (e.g., "siblings" → "brother")
8. Temporal resolution (1.6) — relative dates → absolute keywords

Temporal Resolver (src/plugins/search/temporal-resolver.ts):
- Parses "N days ago", "last Saturday", "last week", "a couple of days ago"
- Returns absolute date range with confidence level
- Pure deterministic, zero LLM cost

LLM Judge (src/plugins/search/llm-judge.ts):
- Optional Claude Haiku-based semantic reranker
- Scores top-N candidates 0-10, blends 50/50 with retrieval score
- Activates when ai_curation.enabled = true
- Achieves 100% R@5 on LongMemEval (500/500)

Vector (src/plugins/search/vector.ts):
- nomic-embed-text-v1.5 (768-dim) via @huggingface/transformers
- Memory-efficient: BM25 top-30 → embed → rerank
- Runs in parallel with BM25 (not cascade)

Fusion (src/plugins/search/fusion.ts):
- Hybrid parallel merge — BM25 + vector run independently, results fused
- Intent-adaptive weights (bm25: 0.45, trigram: 0.15, levenshtein: 0.05, vector: 0.35)
- IDF-weighted content reranker (keyword density + bigrams)
- Score normalization: BM25/trigram scores mapped to 0–1 range
- Weight clamping: Math.max(0, ...) prevents negative weights

Benchmarks (v3.2):
- LME 100% R@5 (BM25+Haiku) | 97.8% (pure local)
- LoCoMo 98.1% | MemBench 98.0% | ConvoMem 97.7%

## Fix Core, Not Adapter
All improvements must go into src/plugins/search/, not just benchmarks/lib/kernel-adapter.js.
The adapter imports from core modules — never duplicate logic.
