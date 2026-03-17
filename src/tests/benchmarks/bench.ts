/**
 * context-mem Performance Benchmarks
 *
 * Standalone runner — not a test file.
 * Build: npx tsc
 * Run:   node dist/tests/benchmarks/bench.js
 */

import { Kernel } from '../../core/kernel.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';
import { BM25Search } from '../../plugins/search/bm25.js';
import { TrigramSearch } from '../../plugins/search/trigram.js';
import { SearchFusion } from '../../plugins/search/fusion.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BenchResult {
  name: string;
  ops_per_sec: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  iterations: number;
}

// ─── Bench Helper ───────────────────────────────────────────────────────────

async function bench(
  name: string,
  fn: () => void | Promise<void>,
  iterations: number = 1000,
): Promise<BenchResult> {
  // Warmup (5% of iterations, min 3, max 20)
  const warmup = Math.min(20, Math.max(3, Math.floor(iterations * 0.05)));
  for (let i = 0; i < warmup; i++) await fn();

  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    timings.push(performance.now() - t0);
  }

  timings.sort((a, b) => a - b);
  const total = timings.reduce((s, v) => s + v, 0);
  const avg_ms = total / iterations;
  const p50_ms = timings[Math.floor(iterations * 0.50)] ?? 0;
  const p95_ms = timings[Math.floor(iterations * 0.95)] ?? 0;
  const p99_ms = timings[Math.floor(iterations * 0.99)] ?? 0;
  const ops_per_sec = avg_ms > 0 ? Math.round(1000 / avg_ms) : Infinity;

  return { name, ops_per_sec, avg_ms, p50_ms, p95_ms, p99_ms, iterations };
}

// ─── Data Generators ────────────────────────────────────────────────────────

function generateShellOutput(lines: number): string {
  const chunks = [
    '$ npm install',
    'npm warn deprecated lodash@3.10.1: use lodash@4',
    'npm warn deprecated request@2.88.2: request has been deprecated',
  ];
  for (let i = 0; i < lines - 3; i++) {
    chunks.push(`added package-${i}@1.0.${i % 10} (${Math.floor(Math.random() * 500)}B)`);
  }
  chunks.push(`added ${lines - 3} packages in ${(lines * 0.1).toFixed(1)}s`);
  return chunks.join('\n');
}

function generateJsonPayload(keys: number): string {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < keys; i++) {
    obj[`field_${i}`] = {
      id: i,
      value: `value_${i}_${'x'.repeat(20)}`,
      timestamp: Date.now() - i * 1000,
      nested: { a: i * 2, b: `nested_${i}` },
    };
  }
  return JSON.stringify(obj, null, 2);
}

function generateErrorStack(frames: number): string {
  const lines = [
    'Error: Cannot read properties of undefined (reading \'map\')',
    '    at processResponse (src/api/client.ts:142:23)',
  ];
  for (let i = 0; i < frames - 2; i++) {
    lines.push(`    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:${95 + i}:5)`);
  }
  lines.push('    at next (node_modules/express/lib/router/route.js:137:13)');
  return lines.join('\n');
}

function generateLogOutput(lines: number, duplicateRatio: number): string {
  const uniqueTemplates = [
    'INFO  [RequestHandler] Processing request id=REQ-%d method=GET path=/api/data',
    'WARN  [Auth] Token expiry approaching for user user-%d ttl=300s',
    'DEBUG [Cache] Cache miss for key=data-%d fetching from DB',
    'ERROR [DB] Query timeout after 5000ms query=SELECT_data_%d',
    'INFO  [Worker] Job completed id=JOB-%d duration=142ms',
  ];
  const result: string[] = [];
  const uniqueCount = Math.floor(lines * (1 - duplicateRatio));
  for (let i = 0; i < lines; i++) {
    if (i < uniqueCount) {
      const tmpl = uniqueTemplates[i % uniqueTemplates.length];
      result.push(tmpl.replace('%d', String(i)));
    } else {
      // Repeat an earlier line (duplicates)
      result.push(result[i % uniqueCount] ?? `INFO repeated line ${i}`);
    }
  }
  return result.join('\n');
}

function randomWord(): string {
  const words = ['error', 'install', 'package', 'build', 'test', 'deploy', 'config', 'module', 'function', 'async'];
  return words[Math.floor(Math.random() * words.length)];
}

// ─── Print Helpers ───────────────────────────────────────────────────────────

function hr(char = '─', width = 72) {
  return char.repeat(width);
}

function printTable(results: BenchResult[]): void {
  const colWidths = { name: 38, ops: 12, avg: 10, p50: 10, p95: 10, p99: 10 };
  const header = [
    'Benchmark'.padEnd(colWidths.name),
    'ops/sec'.padStart(colWidths.ops),
    'avg ms'.padStart(colWidths.avg),
    'p50 ms'.padStart(colWidths.p50),
    'p95 ms'.padStart(colWidths.p95),
    'p99 ms'.padStart(colWidths.p99),
  ].join('  ');

  console.log(hr());
  console.log(header);
  console.log(hr());

  for (const r of results) {
    const row = [
      r.name.padEnd(colWidths.name),
      r.ops_per_sec.toLocaleString().padStart(colWidths.ops),
      r.avg_ms.toFixed(3).padStart(colWidths.avg),
      r.p50_ms.toFixed(3).padStart(colWidths.p50),
      r.p95_ms.toFixed(3).padStart(colWidths.p95),
      r.p99_ms.toFixed(3).padStart(colWidths.p99),
    ].join('  ');
    console.log(row);
  }
  console.log(hr());
}

function section(title: string): void {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(72)}`);
}

// ─── Benchmark Suites ───────────────────────────────────────────────────────

async function benchObservePipeline(kernel: Kernel): Promise<void> {
  section('1. Observe Pipeline Throughput');

  const sizes = [
    { label: '100B', content: 'x'.repeat(100) },
    { label: '1KB',  content: generateShellOutput(10) },     // ~1KB, <20 lines → no summarizer
    { label: '10KB', content: generateShellOutput(200) },    // ~10KB, triggers ShellSummarizer
    { label: '100KB', content: generateShellOutput(2000) },  // ~100KB
  ];

  const results: BenchResult[] = [];

  for (const { label, content } of sizes) {
    const r = await bench(
      `observe ${label} (with summarizer)`,
      async () => { await kernel.observe(content, 'log', 'bench', undefined); },
      200,
    );
    results.push(r);
  }

  // Without summarizer: tiny content that won't hit ShellSummarizer threshold (< 20 lines)
  const tinyContent = 'short line of text for bench\nline two\nline three';
  const rNoSumm = await bench(
    'observe 100B (no summarizer match)',
    async () => { await kernel.observe(tinyContent, 'log', 'bench', undefined); },
    500,
  );
  results.push(rNoSumm);

  printTable(results);

  // Highlight target
  const smallResult = results[0];
  const target = 1000;
  const status = smallResult.ops_per_sec >= target ? '✓ PASS' : '✗ BELOW TARGET';
  console.log(`  Target: ${target.toLocaleString()} obs/sec for 100B  →  ${status} (got ${smallResult.ops_per_sec.toLocaleString()})`);
}

async function benchSearch(kernel: Kernel, storage: BetterSqlite3Storage): Promise<void> {
  section('2. Search Latency (by DB size)');

  const dbSizes = [100, 1000, 10000];
  const queries = ['error timeout', 'npm install package', 'async function', 'config build deploy'];

  for (const targetSize of dbSizes) {
    // Count current observations
    const current = (storage.prepare('SELECT COUNT(*) as c FROM observations').get() as { c: number }).c;
    if (current < targetSize) {
      process.stdout.write(`  Seeding DB to ${targetSize.toLocaleString()} observations... `);
      const toAdd = targetSize - current;
      const batchContent = generateLogOutput(30, 0.3);
      for (let i = 0; i < toAdd; i++) {
        await kernel.observe(batchContent + ` batch_id=${i}`, 'log', 'seed', undefined);
      }
      console.log('done');
    }

    // BM25, Trigram, Fusion
    const bm25 = new BM25Search(storage);
    const trigram = new TrigramSearch(storage);
    const fusion = new SearchFusion([bm25, trigram]);

    const subResults: BenchResult[] = [];

    for (const strategy of ['bm25', 'trigram', 'fusion'] as const) {
      const q = queries[Math.floor(Math.random() * queries.length)];
      const r = await bench(
        `search ${strategy} @ ${targetSize.toLocaleString()} obs`,
        async () => {
          if (strategy === 'bm25') await bm25.search(q, { limit: 5 });
          else if (strategy === 'trigram') await trigram.search(q, { limit: 5 });
          else await fusion.execute(q, { limit: 5 });
        },
        300,
      );
      subResults.push(r);
    }

    printTable(subResults);

    // Check p99 target for 10K
    if (targetSize === 10000) {
      const target = 10; // ms
      for (const r of subResults) {
        const status = r.p99_ms <= target ? '✓ PASS' : '✗ ABOVE TARGET';
        console.log(`  ${r.name}: p99=${r.p99_ms.toFixed(2)}ms  target <${target}ms  →  ${status}`);
      }
    }
  }
}

async function benchTokenSavings(kernel: Kernel): Promise<void> {
  section('3. Token Savings by Content Type');

  const { ShellSummarizer } = await import('../../plugins/summarizers/shell-summarizer.js');
  const { JsonSummarizer } = await import('../../plugins/summarizers/json-summarizer.js');
  const { ErrorSummarizer } = await import('../../plugins/summarizers/error-summarizer.js');
  const { LogSummarizer } = await import('../../plugins/summarizers/log-summarizer.js');
  const { estimateTokens } = await import('../../core/utils.js');

  const datasets = [
    { label: 'npm install (200 lines)', content: generateShellOutput(200), summarizer: new ShellSummarizer() },
    { label: 'JSON response (10KB, 80 keys)', content: generateJsonPayload(80), summarizer: new JsonSummarizer() },
    { label: 'Error + stack (50 frames)', content: generateErrorStack(50), summarizer: new ErrorSummarizer() },
    { label: 'Log 1000 lines (30% dupe)', content: generateLogOutput(1000, 0.3), summarizer: new LogSummarizer() },
  ];

  const colW = { label: 30, orig: 14, summ: 14, saved: 10, pct: 8 };
  const header = [
    'Content Type'.padEnd(colW.label),
    'orig tokens'.padStart(colW.orig),
    'summ tokens'.padStart(colW.summ),
    'saved'.padStart(colW.saved),
    'savings%'.padStart(colW.pct),
  ].join('  ');

  console.log(hr());
  console.log(header);
  console.log(hr());

  for (const { label, content, summarizer } of datasets) {
    const tokensOrig = estimateTokens(content);
    let tokensSumm = tokensOrig;
    let savings = 0;
    let savingsPct = 0;

    if (summarizer.detect(content)) {
      try {
        const result = await summarizer.summarize(content, {});
        tokensSumm = result.tokens_summarized;
        savings = tokensOrig - tokensSumm;
        savingsPct = result.savings_pct;
      } catch {
        // no-op
      }
    }

    const row = [
      label.padEnd(colW.label),
      tokensOrig.toLocaleString().padStart(colW.orig),
      tokensSumm.toLocaleString().padStart(colW.summ),
      savings.toLocaleString().padStart(colW.saved),
      `${savingsPct}%`.padStart(colW.pct),
    ].join('  ');
    console.log(row);
  }
  console.log(hr());

  // Also pull session-level stats from kernel
  const stats = await kernel.stats();
  console.log(`\n  Session-level token economics:`);
  console.log(`    observations stored : ${stats.observations_stored.toLocaleString()}`);
  console.log(`    total content tokens: ${stats.total_content_bytes.toLocaleString()}`);
  console.log(`    total summary tokens: ${stats.total_summary_bytes.toLocaleString()}`);
  console.log(`    tokens saved        : ${stats.tokens_saved.toLocaleString()}`);
  console.log(`    savings %           : ${stats.savings_percentage}%`);
}

async function benchStorage(storage: BetterSqlite3Storage): Promise<void> {
  section('4. Storage Performance');

  // Write throughput — direct INSERT (bypass pipeline overhead)
  const insertStmt = storage.prepare(
    `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let counter = 0;
  const sampleContent = generateLogOutput(30, 0.2);
  const sampleMeta = JSON.stringify({ source: 'bench', tokens_original: 100, tokens_summarized: 80, privacy_level: 'public' });

  const writeResult = await bench(
    'raw INSERT (no pipeline)',
    () => {
      const id = `BENCH${Date.now()}${counter++}`;
      insertStmt.run(id, 'log', sampleContent, null, sampleMeta, Date.now(), 'public', 'bench-session');
    },
    2000,
  );

  printTable([writeResult]);

  // DB size growth per 1000 observations
  const sizeBefore = (storage.prepare(
    `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`
  ).get() as { size: number }).size;

  const batchContent = generateLogOutput(20, 0.1);
  for (let i = 0; i < 1000; i++) {
    const id = `SIZE${Date.now()}${i}`;
    insertStmt.run(id, 'log', batchContent, null, sampleMeta, Date.now(), 'public', 'bench-session');
  }

  const sizeAfter = (storage.prepare(
    `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`
  ).get() as { size: number }).size;

  const growth = sizeAfter - sizeBefore;
  console.log(`\n  DB size growth per 1000 observations:`);
  console.log(`    before : ${(sizeBefore / 1024).toFixed(1)} KB`);
  console.log(`    after  : ${(sizeAfter / 1024).toFixed(1)} KB`);
  console.log(`    growth : ${(growth / 1024).toFixed(1)} KB  (~${(growth / 1000 / 1024).toFixed(2)} KB/obs)`);

  // FTS5 index overhead
  const ftsSize = (storage.prepare(
    `SELECT SUM(pgsize) as size FROM dbstat WHERE name LIKE 'obs_fts%'`
  ).get() as { size: number | null }).size ?? 0;

  const trigramSize = (storage.prepare(
    `SELECT SUM(pgsize) as size FROM dbstat WHERE name LIKE 'obs_trigram%'`
  ).get() as { size: number | null }).size ?? 0;

  const mainSize = (storage.prepare(
    `SELECT SUM(pgsize) as size FROM dbstat WHERE name = 'observations'`
  ).get() as { size: number | null }).size ?? 0;

  console.log(`\n  Index overhead:`);
  console.log(`    observations table : ${(mainSize / 1024).toFixed(1)} KB`);
  console.log(`    obs_fts (BM25)     : ${(ftsSize / 1024).toFixed(1)} KB  (${mainSize > 0 ? ((ftsSize / mainSize) * 100).toFixed(0) : '?'}% of table)`);
  console.log(`    obs_trigram        : ${(trigramSize / 1024).toFixed(1)} KB  (${mainSize > 0 ? ((trigramSize / mainSize) * 100).toFixed(0) : '?'}% of table)`);
}

async function benchPrivacyEngine(): Promise<void> {
  section('5. Privacy Engine Performance');

  const sizes = [
    { label: '1KB',   content: 'a'.repeat(1024) },
    { label: '10KB',  content: 'a'.repeat(10 * 1024) },
    { label: '100KB', content: 'x secret_key=sk-abc123 y '.repeat(3000) },
  ];

  const patternSets = [
    { label: '0 patterns',  patterns: [] as string[] },
    { label: '5 patterns',  patterns: [
      'sk-[a-zA-Z0-9]{20,}',
      'password\\s*=\\s*[^\\s]+',
      '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}',
      '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
      'Bearer\\s+[A-Za-z0-9\\-._~+/]+=*',
    ]},
    { label: '20 patterns', patterns: [
      'sk-[a-zA-Z0-9]{20,}',
      'password\\s*=\\s*[^\\s]+',
      '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}',
      '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
      'Bearer\\s+[A-Za-z0-9\\-._~+/]+=*',
      'api[_-]?key\\s*[:=]\\s*[^\\s,;]+',
      'secret\\s*[:=]\\s*[^\\s,;]+',
      'token\\s*[:=]\\s*[^\\s,;]+',
      'AKIA[0-9A-Z]{16}',
      'ghp_[a-zA-Z0-9]{36}',
      'xox[baprs]-[0-9A-Za-z\\-]{10,}',
      '-----BEGIN (RSA |EC )?PRIVATE KEY-----',
      'mysql://[^@\\s]+@[^\\s]+',
      'postgres://[^@\\s]+@[^\\s]+',
      'mongodb\\+srv://[^@\\s]+@[^\\s]+',
      '\\b[0-9]{16}\\b',
      'ssn[:\\s=]+[0-9]{3}-[0-9]{2}-[0-9]{4}',
      'credit.?card[:\\s=]+[0-9\\s-]{13,19}',
      'Authorization:\\s*[^\\n]+',
      'X-API-Key:\\s*[^\\n]+',
    ]},
  ];

  const results: BenchResult[] = [];

  for (const { label: sizeLabel, content } of sizes) {
    for (const { label: patLabel, patterns } of patternSets) {
      const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: patterns });
      const r = await bench(
        `privacy ${sizeLabel} × ${patLabel}`,
        () => { engine.process(content); },
        500,
      );
      results.push(r);
    }
  }

  printTable(results);
}

async function benchMemoryUsage(kernel: Kernel): Promise<void> {
  section('6. Memory Usage');

  // Force GC if available
  if (global.gc) global.gc();
  const rssBefore = process.memoryUsage().rss;
  const heapBefore = process.memoryUsage().heapUsed;

  console.log('  Storing 10K observations...');
  const content = generateLogOutput(30, 0.2);
  for (let i = 0; i < 10000; i++) {
    await kernel.observe(content + ` id=${i}`, 'log', 'mem-bench', undefined);
    if (i % 1000 === 0) process.stdout.write('.');
  }
  console.log(' done');

  if (global.gc) global.gc();
  const rssAfter = process.memoryUsage().rss;
  const heapAfter = process.memoryUsage().heapUsed;

  console.log(`\n  RSS  before: ${(rssBefore / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  RSS  after : ${(rssAfter / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  RSS  delta : +${((rssAfter - rssBefore) / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap before: ${(heapBefore / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap after : ${(heapAfter / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap delta : +${((heapAfter - heapBefore) / 1024 / 1024).toFixed(1)} MB`);

  // Search with large result set
  if (global.gc) global.gc();
  const rssPreSearch = process.memoryUsage().rss;

  const searchResults = await kernel.search('error timeout install package', { limit: 100 });

  const rssPostSearch = process.memoryUsage().rss;
  console.log(`\n  Search (limit=100) returned ${searchResults.length} results`);
  console.log(`  RSS delta during search: +${((rssPostSearch - rssPreSearch) / 1024 / 1024).toFixed(2)} MB`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n  context-mem Performance Benchmarks');
  console.log('  ===================================');
  console.log(`  Node ${process.version}  |  ${os.cpus()[0]?.model ?? 'unknown CPU'}  |  ${os.totalmem() / 1024 / 1024 / 1024 | 0}GB RAM`);
  console.log(`  Date: ${new Date().toISOString()}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-bench-'));
  const kernel = new Kernel(tmpDir);
  await kernel.start();

  // Reach into kernel internals to get storage for direct-access benchmarks
  // We cast to access private members for benchmark purposes only
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (kernel as unknown as Record<string, unknown>).storage as BetterSqlite3Storage;

  try {
    await benchObservePipeline(kernel);
    await benchSearch(kernel, storage);
    await benchTokenSavings(kernel);
    await benchStorage(storage);
    await benchPrivacyEngine();
    await benchMemoryUsage(kernel);
  } finally {
    await kernel.stop();
    fs.rmSync(tmpDir, { recursive: true });
  }

  console.log('\n  Benchmarks complete.\n');
}

// Declare global.gc for --expose-gc flag
declare const global: { gc?: () => void } & typeof globalThis;

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
