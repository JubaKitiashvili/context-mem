# context-mem Project Instructions

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

## Core Search Architecture (v3.1)
BM25 (src/plugins/search/bm25.ts) runs 4 strategies:
1. AND-mode (weight 2.0) — high precision
2. Entity-focused (1.8) — proper nouns, dates
3. Sanitized FTS5 (1.5) — default tokenization
4. OR-mode with expansion (1.0) — broad recall

Vector (src/plugins/search/vector.ts):
- nomic-embed-text-v1.5 (768-dim) via @huggingface/transformers
- Memory-efficient: BM25 top-30 → embed → rerank
- Runs in parallel with BM25 (not cascade)

Fusion (src/plugins/search/fusion.ts):
- Hybrid parallel merge — BM25 + vector run independently, results fused
- Intent-adaptive weights (bm25: 0.45, trigram: 0.15, levenshtein: 0.05, vector: 0.35)
- IDF-weighted content reranker (keyword density + bigrams)
- Score normalization: BM25/trigram scores mapped to 0–1 range

Benchmarks: LME 98.0%, LoCoMo 98.2%, MemBench 98.0%, ConvoMem 97.7% (LLM-free ceiling)

## Fix Core, Not Adapter
All improvements must go into src/plugins/search/, not just benchmarks/lib/kernel-adapter.js.
The adapter imports from core modules — never duplicate logic.
