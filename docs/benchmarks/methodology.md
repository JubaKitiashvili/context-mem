# Benchmark Methodology

This document describes how context-mem benchmarks are designed, what they measure, and how to reproduce results. See also [issue #6](https://github.com/JubaKitiashvili/context-mem/issues/6) for the community discussion that motivated the addition of the E2E QA harness.

## Scope: Retrieval Recall vs. E2E QA Accuracy

context-mem reports two complementary metrics:

**Retrieval recall** measures whether the correct evidence session(s) appear in the top-K retrieved results. This is the primary metric used in published comparisons against MemPalace, RAPTOR, and similar systems. It is cheap to compute (no LLM calls) and allows large-scale ablations.

**E2E QA accuracy** measures the full pipeline: retrieve top-K → generate an answer with Claude Haiku → judge the answer as correct or incorrect with a second Haiku call acting as judge. This metric answers the question that end-users actually care about: does the system produce a correct answer? It is more expensive to compute (two Haiku calls per question) but directly comparable to competitors that report QA accuracy numbers.

Both are necessary. High retrieval recall is a prerequisite but not sufficient — a system can retrieve the right session yet still fail to synthesize a correct answer. E2E QA accuracy catches that gap.

## Datasets and Granularity

All benchmarks default to **session-level granularity**: each indexed unit is one conversation session. The number of sessions per question varies by dataset:

| Dataset | Sessions per question | Notes |
|---|---|---|
| LongMemEval (`longmemeval_s_cleaned.json`) | ~53 | Haystack sessions, user turns + answer-bearing assistant turns |
| LoCoMo | 19–35 | Multi-session conversations with structured events |
| MemBench | varies | FirstAgent subset; single-agent memory |
| ConvoMem | varies | Conversational memory across speaker roles |

Turn-level granularity (each user turn indexed separately) is available via `--granularity turn` on LongMemEval and ConvoMem. Turn granularity increases corpus size by ~10× and changes recall calculation: retrieved turn IDs are mapped back to their parent session for scoring.

## Scoring Rules

### Retrieval recall
- **Recall@K**: 1 if any of the gold session IDs appears in the top-K retrieved results, else 0. Averaged over all questions. Single-evidence and multi-evidence questions are treated identically — any-evidence suffices for a hit.
- **NDCG@10**: standard normalized discounted cumulative gain, treating each gold session as equally relevant (relevance = 1).

### E2E QA accuracy
- Answer generation prompt: system is told to answer concisely in 1–3 sentences using only the provided context; if the context does not contain the answer it must say "I don't know."
- Judge prompt: see `benchmarks/lib/qa-judge-prompt.md`. The judge scores 1 (correct) or 0 (incorrect). Minor wording differences are allowed; partial answers that miss key facts are scored 0; additional correct context beyond the expected answer is allowed.
- A question is counted correct if the judge returns `SCORE: 1`.

### Multi-evidence questions
For retrieval recall on questions with multiple gold sessions, **any-evidence** scoring is used: the question is a hit if at least one gold session is retrieved in top-K. This matches the MemPalace baseline. Full all-evidence scoring (`recallAllAtK`) is available in `benchmarks/lib/metrics.js` but is not the default reported metric.

## Enriched Ingestion Disclosure

LoCoMo sessions are ingested with enriched content: each session document concatenates the raw dialogue turns, the `session_summary` field, and any `observation` and `event_summary` entries when present. This enrichment is applied during ingestion in `benchmarks/locomo.js` and significantly boosts recall on LoCoMo's structured-event questions. Disclosed here for transparency.

LongMemEval and MemBench use raw turn content only (user turns + answer-bearing assistant turns). ConvoMem uses raw speaker turns.

## Synonym Expansions

The query pipeline includes a synonym expansion step that broadens recall for semantic gaps (e.g., a query about "siblings" matching sessions that mention "brother" or "sister"). Previously, `benchmarks/lib/expansions.js` contained entries that were fitted to benchmark failure cases. These have since been audited and migrated into the core product. See [synonym-migration-2026-04.md](./synonym-migration-2026-04.md) for the full audit and migration record (created in T3.4.6).

## How to Reproduce

### Retrieval recall — all four datasets

```bash
# LongMemEval (500 questions)
node benchmarks/longmemeval.js /tmp/longmemeval-data/longmemeval_s_cleaned.json

# LoCoMo (10 multi-session conversations)
node benchmarks/locomo.js /tmp/locomo/data/locomo10.json

# ConvoMem (all categories, first 50 per category)
node benchmarks/convomem.js --category all --limit 50

# MemBench (FirstAgent subset)
node benchmarks/membench.js /tmp/membench-data/MemData/FirstAgent --limit 500
```

Quick mode (all four, fast limits):
```bash
npm run bench
```

Full mode:
```bash
npm run bench:full
```

### E2E QA accuracy — LongMemEval

Claude Haiku is called for answer generation and judging. **No `ANTHROPIC_API_KEY` is required if you have the `claude` CLI logged in** (Claude Max subscription). The SDK auto-detects auth in this order:

1. `ANTHROPIC_API_KEY` environment variable (API key billing).
2. `claude` CLI OAuth session (Claude Max / Pro subscription). Run `claude` and follow the prompts to log in once.

#### Authentication

```bash
# Option A — Claude CLI subscription (no API key needed)
claude   # follow login prompts once, then:
node benchmarks/e2e-qa.js /tmp/longmemeval-data/longmemeval_s_cleaned.json --limit 20

# Option B — API key
ANTHROPIC_API_KEY=sk-ant-... node benchmarks/e2e-qa.js \
  /tmp/longmemeval-data/longmemeval_s_cleaned.json --limit 20
```

The harness prints `Auth path: ...` at startup so you can confirm which path is active.

#### Published numbers

All published E2E QA scores can be reproduced with either auth method — the model (`claude-haiku-4-5-20251001`), prompt templates, and rate-limiting (2.2 s minimum interval) are identical in both paths.

```bash
# Quick smoke test (2 synthetic questions, ~60s)
node benchmarks/smoke-e2e-qa.mjs

# Full run (500 questions, ~30 min at rate limit)
node benchmarks/e2e-qa.js \
  /tmp/longmemeval-data/longmemeval_s_cleaned.json \
  --top-k 5

# npm shortcut
npm run bench:e2e-qa -- \
  /tmp/longmemeval-data/longmemeval_s_cleaned.json --limit 20
```

Results are saved to `benchmarks/results/e2e-qa-lme-YYYY-MM-DD.json` with per-question-type breakdown.

## Related Issues and References

- [Issue #6](https://github.com/JubaKitiashvili/context-mem/issues/6) — AlexisOlson: "benchmarks report retrieval recall while competitors report E2E QA accuracy"
- `benchmarks/e2e-qa.js` — E2E QA harness implementation
- `benchmarks/lib/qa-judge-prompt.md` — Judge prompt template
- `benchmarks/lib/metrics.js` — `recallAtK`, `recallAllAtK`, `ndcg`, `formatPercent`
- `benchmarks/lib/kernel-adapter.js` — `BenchKernel` (ingest + search), `llmRerank`
