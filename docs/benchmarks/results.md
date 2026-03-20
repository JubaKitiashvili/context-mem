# context-mem ERNE-Parity Benchmarks

> Using ERNE's exact fixture files for apples-to-apples comparison.
> Generated on 2026-03-20

## Environment

| Metric | Value |
|--------|-------|
| Node.js | v22.22.0 |
| OS | darwin arm64 |
| CPU | Apple M3 Pro |
| RAM | 18 GB |
| Total raw data tested | 555.9 KB |

## Part 1: Summarizer — Structured Data Processing (14 scenarios)

| Scenario | Source | Raw Size | Context | Savings |
|----------|--------|----------|---------|--------|
| React useEffect docs | Context7 | 6.4 KB | 492 B | 93% |
| Next.js App Router docs | Context7 | 8.0 KB | 450 B | 95% |
| Tailwind CSS docs | Context7 | 5.2 KB | 336 B | 94% |
| Page snapshot (HN) | Playwright | 203.9 KB | 107 B | 100% |
| Network requests | Playwright | 312 B | 312 B | 0% |
| PR list (vercel/next.js) | GitHub | 10.4 KB | 318 B | 97% |
| Issues (facebook/react) | GitHub | 125.3 KB | 510 B | 100% |
| Test output (30 suites) | vitest | 3.4 KB | 237 B | 93% |
| TypeScript errors (50) | tsc | 7.2 KB | 969 B | 87% |
| Build output (100+ lines) | next build | 4.1 KB | 143 B | 97% |
| MCP tools (40 tools) | MCP tools/list | 24.4 KB | 224 B | 99% |
| Access log (500 reqs) | nginx | 90.9 KB | 683 B | 99% |
| Git log (150+ commits) | git | 23.7 KB | 436 B | 98% |
| Analytics CSV (500 rows) | analytics | 42.7 KB | 468 B | 99% |

**Subtotal: 555.9 KB raw → 5.6 KB context (99% savings)**

## Part 2: Index+Search — Knowledge Retrieval (6 scenarios)

| Scenario | Raw Size | Search Result (3 queries) | Savings | Chunks |
|----------|----------|---------------------------|---------|--------|
| Supabase Edge Functions | 4.9 KB | 3.4 KB | 31% | 7 |
| React useEffect docs | 6.4 KB | 4.0 KB | 37% | 9 |
| Next.js App Router docs | 8.0 KB | 3.6 KB | 55% | 9 |
| Tailwind CSS docs | 5.2 KB | 2.7 KB | 47% | 7 |
| React hooks (re-search) | 6.4 KB | 4.3 KB | 34% | 9 |
| Next.js API routes | 8.0 KB | 1.4 KB | 83% | 6 |

**Subtotal: 38.9 KB raw → 19.3 KB context (50% savings)**

## Part 3: Full Session Simulation

| Metric | Without context-mem | With context-mem |
|--------|--------------------|-----------------|
| Total data | 365.5 KB | 3.8 KB |
| Tokens | ~93,556 | ~977 |
| Savings | — | **99%** |

## Part 4: Search Performance

| Operation | Avg | p50 | p95 | p99 | ops/s |
|-----------|-----|-----|-----|-----|-------|
| BM25 search | 0.298ms | 0.011ms | 1.463ms | 1.517ms | 3,356 |
| trigram search | 0.008ms | 0.008ms | 0.009ms | 0.011ms | 118,767 |
| levenshtein search | 0.193ms | 0.187ms | 0.252ms | 0.292ms | 5,173 |
| timeline (limit 50) | 0.034ms | 0.033ms | 0.037ms | 0.042ms | 29,816 |
| timeline (limit 200) | 0.13ms | 0.123ms | 0.163ms | 0.29ms | 7,713 |
| count by type | 0.155ms | 0.152ms | 0.166ms | 0.192ms | 6,462 |

## Part 5: New Features Performance

| Feature | Operation | Avg | p50 | ops/s |
|---------|-----------|-----|-----|-------|
| | knowledge save | 0.111ms | 0.082ms | 9,043 |
| | knowledge search (FTS5) | 0.61ms | 0.521ms | 1,640 |
| | budget check | 0.01ms | 0.008ms | 104,152 |
| | event emit | 0.045ms | 0.032ms | 22,120 |
| | event query | 0.16ms | 0.154ms | 6,255 |
| | snapshot save | 0.226ms | 0.209ms | 4,427 |
| | snapshot restore | 0.005ms | 0.005ms | 197,403 |

## Part 6: Truncation Cascade

| Tier | Input Size | Output Size | Savings |
|------|-----------|-------------|--------|
| T1: JSON schema | 125.3 KB | 264 B | 100% |
| T2: Test output pattern | 3.4 KB | 583 B | 83% |
| T3: Head/Tail (large text) | 203.9 KB | 3.9 KB | 98% |
| T4: Binary content | 2.0 KB | 101 B | 95% |

## Part 7: Database Metrics

| Metric | Value |
|--------|-------|
| Observations | 5000 |
| DB Size | 2.87 MB |
| Avg per obs | 602 bytes |
| FTS5 index | 437.1 KB |
| Trigram index | 257.9 KB |

## Comparison with ERNE

| Metric | ERNE | context-mem |
|--------|------|-------------|
| Summarizer savings | 100% | **99%** |
| Index+Search savings | 80% | **50%** |
| Full session savings | 99% | **99%** |
| Content types detected | 14 | **14** |
| Search technology | FTS5 BM25 | FTS5 BM25 + Trigram + Levenshtein |
| Code preservation | Yes | Yes |
| Budget management | Yes | **Yes** |
| Session continuity | Yes | **Yes** |
| Knowledge base | No | **Yes** |
| Event tracking | No | **Yes** |
| Total raw data tested | 537.5 KB | **555.9 KB** |
