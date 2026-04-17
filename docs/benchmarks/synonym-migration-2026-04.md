# Synonym Migration — April 2026

## Motivation

[Issue #6](https://github.com/JubaKitiashvili/context-mem/issues/6) (AlexisOlson, 2026-04-15) identified that
`benchmarks/lib/expansions.js` contained synonym expansions that were **only applied during benchmark runs** via
`mergeExpansions()`, not in the live product.  This inflated reported retrieval scores relative to real-world query
performance — specifically point 4 of the critique: "benchmark-fitted synonym expansions".

This migration:

1. Audited every entry in `benchmarks/lib/expansions.js` and classified it as **general vocabulary** or
   **benchmark-fitted**.
2. Moved all general-vocabulary entries into `src/plugins/search/query-builder.ts` (`_expansions`), where they run
   for every user query.
3. Deleted benchmark-fitted entries — they will no longer be counted toward reported scores.
4. Left `benchmarks/lib/expansions.js` empty so future adversarial patches are clearly labelled as such.

## Audit Summary

- **Total entries before migration:** 38 (`wc -l` was misleading; precise count of `key:` lines is 38)
- **Moved to core as new keys:** 28 (family terms, workplace vocab, objects/subject nouns)
- **Extended existing core keys (value-merge only):** 3 (`education`, `workplace`, `hobby`)
- **Deleted as benchmark-fitted:** 7 (`cookie`, `violin`, `race`, `martial`, `supervillain`, `counseling`, `digestive`)
- **Value-stripped during move:** 1 (`sport`'s `collectible` value — see Close Calls)
- **Remaining in `benchmarks/lib/expansions.js`:** 0

## General-vocabulary entries migrated to core

| Key | Values added/extended in core |
|---|---|
| `mother` | `['mom', 'parent', 'mama']` (new key) |
| `father` | `['dad', 'parent', 'papa']` (new key) |
| `brother` | `['sibling', 'family']` (new key) |
| `sister` | `['sibling', 'family']` (new key) |
| `cousin` | `['relative', 'family']` (new key) |
| `nephew` | `['relative', 'family']` (new key) |
| `niece` | `['relative', 'family']` (new key) |
| `aunt` | `['relative', 'family']` (new key) |
| `uncle` | `['relative', 'family']` (new key) |
| `boss` | `['manager', 'supervisor', 'lead']` (new key) |
| `coworker` | `['colleague', 'workmate', 'office']` (new key) |
| `age` | `['years', 'old', 'born', 'birthday']` (new key) |
| `background` | `['degree', 'studied', 'education', 'school']` (new key) |
| `level` | `['degree', 'completed', 'graduated']` (new key) |
| `living` | `['job', 'work', 'career', 'profession']` (new key) |
| `hobbies` | `['interest', 'activity', 'passion', 'enjoy', 'loves', 'likes']` (new key) |
| `hobby` | extended with `loves`, `likes`, `free` (was `['interest','activity','passion','enjoy']`) |
| `education` | extended with `graduated` (was missing from the core set) |
| `workplace` | extended with `works` (was missing from the core set) |
| `accessories` | `['gear', 'equipment', 'setup', 'kit']` (new key) |
| `photography` | `['camera', 'photo', 'lens', 'shoot']` (new key) |
| `battery` | `['charge', 'power']` — `phone` dropped (too context-specific) |
| `jewelry` | `['ring', 'necklace', 'bracelet', 'gift']` (new key) |
| `appliance` | `['kitchen', 'device']` — `bought`/`purchase` dropped (covered by core `buy`/`bought`) |
| `certificate` | `['award', 'achievement', 'recognition']` (new key) |
| `volunteer` | `['charity', 'community', 'help', 'service']` (new key) |
| `journal` | `['write', 'diary', 'notebook']` — `supplies` dropped (too narrow) |
| `bookshelf` | `['furniture', 'shelf', 'storage']` — `living` dropped (ambiguous; `living` is already a separate key) |
| `publication` | `['conference', 'research', 'journal', 'paper']` (new key) |
| `conference` | `['publication', 'research', 'academic', 'paper']` (new key) |
| `sport` | `['game', 'play', 'athletic', 'team']` — see Close Calls below |

## Benchmark-fitted entries deleted (7 keys)

- **`cookie: ['bake', 'recipe', 'chocolate', 'dessert']`** — Narrowly fitted to a cookie-baking narrative question. The
  coverage is already provided by core `cook: ['recipe', 'bake', 'kitchen', 'meal']`.
- **`violin: ['practice', 'instrument', 'music', 'play']`** — Specific instrument. Generalising would require adding
  every instrument (piano, guitar, drums…). Clearly fitted to one benchmark question.
- **`race: ['charity', 'run', 'marathon', 'event']`** — Highly ambiguous word (race = competition, ethnicity, event).
  The mapping is fitted to a single charity-run narrative and would generate noise on other queries.
- **`martial: ['karate', 'judo', 'taekwondo', 'fighting']`** — Narrow sub-domain of martial arts. Would need an
  exhaustive list to be universally useful; this one-line entry is clearly fitted to one question.
- **`supervillain: ['villain', 'comic', 'hero', 'fan']`** — Obviously fitted to a specific benchmark narrative. No
  general-purpose justification.
- **`counseling: ['therapy', 'support', 'help', 'career']`** — Mixed-signal expansion: `career` is unrelated to
  counseling in general usage, exposing the benchmark-fitted origin. Too narrow.
- **`digestive: ['stomach', 'health', 'issue', 'problem']`** — Overly specific medical/health pattern fitted to one
  health-related question. Generalising health vocabulary belongs in a dedicated health-domain module, not ad-hoc here.

The `sport` key was moved to core without the `collectible` value (see Close Calls below) — not counted among the 7
deleted keys since the key itself survives.

## Close calls and rationale

### `sport: ['game', 'play', 'athletic', 'team', 'collectible']`

**Decision: general synonyms moved to core; `collectible` dropped.**

`game`, `play`, `athletic`, and `team` are universally associated with "sport" in everyday language — adding them to
core improves recall for any sports-related query without introducing noise. The value `collectible` is the red flag: it
maps "sport" to "sports collectible" merchandise, which is clearly fitted to a single benchmark question about a sports
memorabilia purchase. Keeping `collectible` would be exactly the kind of benchmark-fitted inflation issue #6 flagged.

Result: `sport: ['game', 'play', 'athletic', 'team']` lives in core; `collectible` is permanently deleted.

## Delta on benchmarks

| Benchmark | Before | After | Delta |
|---|---|---|---|
| LongMemEval R@5 (pure local) | 97.8% | _pending_ | _pending_ |
| LoCoMo R@10 | 98.1% | _pending_ | _pending_ |
| MemBench R@5 | 98.0% | _pending_ | _pending_ |
| ConvoMem R@10 | 97.7% | _pending_ | _pending_ |

> **Note:** v3.4.0 ships without re-run numbers — the release is a flag-plant preview (`vault.enabled` is opt-in
> off by default) whose value is the LLM Wiki narrative and schema spec, not a retrieval-score claim. The migration
> changes core expansion semantics, so the post-migration re-run is scheduled for v4.0.0 "Cognition" (target 2026-05-22)
> where the full benchmark sweep is part of the release gate.

## Honest reporting

The benchmark numbers published after this migration are what context-mem ships end-to-end. Previous benchmark-only
expansions that did not run in production will no longer be counted. Any score delta (positive or negative) is the true
product delta — not an artifact of test-time patching.

## Resolves

Partial fix for https://github.com/JubaKitiashvili/context-mem/issues/6 — specifically point 4 (benchmark-fitted
synonym expansions). Points 1 (retrieval recall vs E2E QA), 2 (granularity disclosure), and 3 (enriched ingestion
disclosure) are addressed by `docs/benchmarks/methodology.md` + `benchmarks/e2e-qa.js` (T3.4.5).
