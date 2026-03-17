# context-mem ERNE-Parity Benchmarks

> Using ERNE's exact fixture files for apples-to-apples comparison.
> Generated on 2026-03-16

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
| Supabase Edge Functions | 4.9 KB | 778 B | 84% | 1 |
| React useEffect docs | 6.4 KB | 932 B | 86% | 4 |
| Next.js App Router docs | 8.0 KB | 2.1 KB | 73% | 6 |
| Tailwind CSS docs | 5.2 KB | 790 B | 85% | 2 |
| React hooks (re-search) | 6.4 KB | 2.4 KB | 63% | 4 |
| Next.js API routes | 8.0 KB | 1.0 KB | 87% | 3 |

**Subtotal: 38.9 KB raw → 8.0 KB context (80% savings)**

## Part 3: Full Session Simulation

| Metric | Without context-mem | With context-mem |
|--------|--------------------|-----------------|
| Total data | 365.5 KB | 3.2 KB |
| Tokens | ~93,556 | ~819 |
| Savings | — | **99%** |

## Part 4: Search Performance

| Operation | Avg | p50 | p95 | p99 | ops/s |
|-----------|-----|-----|-----|-----|-------|
| BM25 search | 0.299ms | 0.011ms | 1.459ms | 1.566ms | 3,342 |
| trigram search | 0.008ms | 0.008ms | 0.01ms | 0.011ms | 120,122 |
| levenshtein search | 0.19ms | 0.183ms | 0.247ms | 0.286ms | 5,272 |
| timeline (limit 50) | 0.033ms | 0.033ms | 0.035ms | 0.041ms | 30,187 |
| timeline (limit 200) | 0.12ms | 0.118ms | 0.128ms | 0.172ms | 8,329 |
| count by type | 0.152ms | 0.15ms | 0.161ms | 0.168ms | 6,572 |

## Part 5: New Features Performance

| Feature | Operation | Avg | p50 | ops/s |
|---------|-----------|-----|-----|-------|
| | knowledge save | 0.137ms | 0.087ms | 7,278 |
| | knowledge search (FTS5) | 0.72ms | 0.547ms | 1,389 |
| | budget check | 0.01ms | 0.008ms | 102,870 |
| | event emit | 0.058ms | 0.034ms | 17,183 |
| | event query | 0.156ms | 0.152ms | 6,406 |
| | snapshot save | 0.062ms | 0.046ms | 16,240 |
| | snapshot restore | 0.005ms | 0.005ms | 186,699 |

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
| DB Size | 2.84 MB |
| Avg per obs | 596 bytes |
| FTS5 index | 437.1 KB |
| Trigram index | 257.9 KB |

## Comparison with ERNE

| Metric | ERNE | context-mem |
|--------|------|-------------|
| Summarizer savings | 100% | **99%** |
| Index+Search savings | 80% | **80%** |
| Full session savings | 99% | **99%** |
| Content types detected | 14 | **14** |
| Search technology | FTS5 BM25 | FTS5 BM25 + Trigram + Levenshtein |
| Code preservation | Yes | Yes |
| Budget management | Yes | **Yes** |
| Session continuity | Yes | **Yes** |
| Knowledge base | No | **Yes** |
| Event tracking | No | **Yes** |
| Total raw data tested | 537.5 KB | **555.9 KB** |
