# context-mem Benchmarks

Head-to-head comparison against [MemPalace](https://github.com/milla-jovovich/mempalace) using the same academic benchmarks.

## Quick Start

```bash
npm run build
npm run bench          # quick mode (small samples, ConvoMem auto-downloads)
npm run bench:full     # full benchmarks (requires data setup below)
```

## Setup Data

### 1. LongMemEval (500 questions)

Tests retrieval across ~53 conversation sessions per question. The standard benchmark for AI memory.

```bash
mkdir -p /tmp/longmemeval-data
curl -fsSL -o /tmp/longmemeval-data/longmemeval_s_cleaned.json \
  https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
```

### 2. LoCoMo (1,986 QA pairs)

Tests multi-hop reasoning across 10 long conversations (19-32 sessions each, 400-600 dialog turns).

```bash
git clone https://github.com/snap-research/locomo.git /tmp/locomo
```

### 3. ConvoMem (75K+ QA pairs)

Tests six categories of conversational memory. **Downloads from HuggingFace automatically** — no setup needed.

### 4. MemBench (ACL 2025)

Tests memory across multi-turn conversations in multiple categories.

```bash
git clone https://github.com/import-myself/Membench.git /tmp/membench
```

## Running Individual Benchmarks

```bash
# LongMemEval
node benchmarks/longmemeval.js /tmp/longmemeval-data/longmemeval_s_cleaned.json
node benchmarks/longmemeval.js data.json --limit 20 --granularity turn

# LoCoMo
node benchmarks/locomo.js /tmp/locomo/data/locomo10.json
node benchmarks/locomo.js data.json --granularity dialog --top-k 50

# ConvoMem
node benchmarks/convomem.js --category all --limit 50
node benchmarks/convomem.js --category user_evidence --limit 100

# MemBench
node benchmarks/membench.js /tmp/membench/MemData/FirstAgent
node benchmarks/membench.js data --category highlevel --mode hybrid
```

## What Each Benchmark Tests

| Benchmark | What it measures | Why it matters |
|---|---|---|
| **LongMemEval** | Can you find a fact buried in 53 sessions? | Tests basic retrieval quality — the "needle in a haystack" |
| **LoCoMo** | Can you connect facts across conversations over weeks? | Tests multi-hop reasoning and temporal understanding |
| **ConvoMem** | Does your memory system work at scale? | Tests all memory types: facts, preferences, changes, abstention |
| **MemBench** | Can you recall specific turns from multi-turn conversations? | Tests turn-level retrieval with multiple question categories |

## Architecture Comparison

| | MemPalace | context-mem |
|---|---|---|
| **Storage** | ChromaDB (vector-first) | SQLite FTS5 (text-first) |
| **Embeddings** | all-MiniLM-L6-v2 (always) | all-MiniLM-L6-v2 (optional) |
| **Primary search** | Cosine similarity | BM25 + Trigram + Levenshtein |
| **Reranking** | Keyword boost + temporal | Intent-classified + AttnRes |
| **Dependencies** | chromadb (Python) | better-sqlite3 (Node.js) |
| **Offline** | Yes | Yes |
| **API key needed** | No (base), Yes (LLM rerank) | No (base), Yes (AI curation) |

## Results Format

Results are saved to `benchmarks/results/` as JSON with full per-question details for auditability. Each file includes:
- Overall metrics (Recall@K, NDCG@K)
- Per-type/category breakdown
- Every question with retrieved IDs and scores
