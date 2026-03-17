#!/usr/bin/env node
'use strict';

/**
 * context-mem ERNE-Parity Benchmark Suite
 *
 * Uses ERNE's EXACT fixture files for apples-to-apples comparison.
 * Mirrors ERNE's 3-part benchmark structure:
 *   Part 1: Summarizer (14 scenarios)
 *   Part 2: Index+Search (6 scenarios)
 *   Part 3: Full Session Simulation
 * Plus: search perf, new features, truncation, DB metrics.
 *
 * Usage: node docs/benchmarks/run-benchmarks.js
 */

var path = require('path');
var fs = require('fs');
var os = require('os');

var projectRoot = path.resolve(__dirname, '..', '..');
process.chdir(projectRoot);

var Database = require('better-sqlite3');
var migrations = require('../../dist/plugins/storage/migrations.js').migrations;

var BENCH_DB = path.join(os.tmpdir(), 'context-mem-bench-' + Date.now() + '.db');
var FIXTURES_DIR = path.join(__dirname, 'fixtures');
var results = [];

// ---- Helpers ----

function bench(name, fn, iterations) {
  if (iterations === undefined) iterations = 1000;
  for (var i = 0; i < Math.min(10, iterations); i++) fn(i);
  var times = [];
  var memBefore = process.memoryUsage().heapUsed;
  var start = performance.now();
  for (var i = 0; i < iterations; i++) {
    var t0 = performance.now();
    fn(i);
    times.push(performance.now() - t0);
  }
  var elapsed = performance.now() - start;
  var memAfter = process.memoryUsage().heapUsed;
  times.sort(function(a, b) { return a - b; });
  var p50 = times[Math.floor(times.length * 0.5)];
  var p95 = times[Math.floor(times.length * 0.95)];
  var p99 = times[Math.floor(times.length * 0.99)];
  var avg = elapsed / iterations;
  var ops = Math.round(iterations / (elapsed / 1000));
  var memDelta = Math.round((memAfter - memBefore) / 1024);
  var result = { name: name, avg: +avg.toFixed(3), p50: +p50.toFixed(3), p95: +p95.toFixed(3), p99: +p99.toFixed(3), ops: ops, mem_kb: memDelta };
  results.push(result);
  console.log('  ' + name + ': avg=' + avg.toFixed(3) + 'ms  p50=' + p50.toFixed(3) + 'ms  p95=' + p95.toFixed(3) + 'ms  p99=' + p99.toFixed(3) + 'ms  ops/s=' + ops);
  return result;
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

// ---- Load fixtures ----
console.log('context-mem ERNE-Parity Benchmarks');
console.log('='.repeat(60));
console.log('Node: ' + process.version);
console.log('OS: ' + os.platform() + ' ' + os.arch() + ' (' + os.cpus()[0].model + ')');
console.log('RAM: ' + Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB');
console.log('Fixtures: ' + FIXTURES_DIR);
console.log('DB: ' + BENCH_DB);
console.log();

var fixtures = {
  reactDocs:         loadFixture('context7-react-docs.md'),
  nextjsDocs:        loadFixture('context7-nextjs-docs.md'),
  tailwindDocs:      loadFixture('context7-tailwind-docs.md'),
  supabaseEdge:      loadFixture('context7-supabase-edge.md'),
  playwrightSnap:    loadFixture('playwright-snapshot.txt'),
  playwrightNetwork: loadFixture('playwright-network.txt'),
  githubPrs:         loadFixture('github-prs.json'),
  githubIssues:      loadFixture('github-issues.json'),
  testOutput:        loadFixture('test-output.txt'),
  tscErrors:         loadFixture('tsc-errors.txt'),
  buildOutput:       loadFixture('build-output.txt'),
  mcpTools:          loadFixture('mcp-tools.json'),
  accessLog:         loadFixture('access.log'),
  gitLog:            loadFixture('git-log.txt'),
  analyticsCsv:      loadFixture('analytics.csv'),
};

// ---- Setup DB ----
var db = new Database(BENCH_DB);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -8000');
db.pragma('mmap_size = 67108864');
db.pragma('synchronous = NORMAL');
for (var m of migrations) { db.exec(m.up); }

// ---- Seed observations for search benchmarks ----
var insertStmt = db.prepare(
  'INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
var sampleTypes = ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'];
for (var i = 0; i < 5000; i++) {
  var t = sampleTypes[i % sampleTypes.length];
  var c = 'Sample observation ' + i + ' content for type ' + t + ' with keywords react navigation zustand expo build test error';
  insertStmt.run('SEED_' + i, t, c, 'summary ' + i + ' ' + t, '{"source":"bench"}', Date.now() + i, 'public', 'BENCH_SESSION', null);
}

// ========================================================================
// PART 1: Summarizer — Structured Data Processing (14 scenarios)
// Mirrors ERNE BENCHMARK.md Part 1 exactly
// ========================================================================

(async function() {

console.log('Part 1: Summarizer — Structured Data Processing');
console.log('='.repeat(60));

var MarkdownSummarizer = require('../../dist/plugins/summarizers/markdown-summarizer.js').MarkdownSummarizer;
var HtmlSummarizer = require('../../dist/plugins/summarizers/html-summarizer.js').HtmlSummarizer;
var TypescriptErrorSummarizer = require('../../dist/plugins/summarizers/typescript-error-summarizer.js').TypescriptErrorSummarizer;
var BuildOutputSummarizer = require('../../dist/plugins/summarizers/build-output-summarizer.js').BuildOutputSummarizer;
var GitLogSummarizer = require('../../dist/plugins/summarizers/git-log-summarizer.js').GitLogSummarizer;
var CsvSummarizer = require('../../dist/plugins/summarizers/csv-summarizer.js').CsvSummarizer;
var NetworkSummarizer = require('../../dist/plugins/summarizers/network-summarizer.js').NetworkSummarizer;
var TestOutputSummarizer = require('../../dist/plugins/summarizers/test-output-summarizer.js').TestOutputSummarizer;
var ErrorSummarizer = require('../../dist/plugins/summarizers/error-summarizer.js').ErrorSummarizer;
var JsonSummarizer = require('../../dist/plugins/summarizers/json-summarizer.js').JsonSummarizer;
var CodeSummarizer = require('../../dist/plugins/summarizers/code-summarizer.js').CodeSummarizer;
var LogSummarizer = require('../../dist/plugins/summarizers/log-summarizer.js').LogSummarizer;
var ShellSummarizer = require('../../dist/plugins/summarizers/shell-summarizer.js').ShellSummarizer;
var BinarySummarizer = require('../../dist/plugins/summarizers/binary-summarizer.js').BinarySummarizer;

// ERNE's exact 14 scenarios in same order as BENCHMARK.md
var scenarios = [
  { name: 'React useEffect docs',     source: 'Context7',    fixture: fixtures.reactDocs,         summarizer: new MarkdownSummarizer() },
  { name: 'Next.js App Router docs',  source: 'Context7',    fixture: fixtures.nextjsDocs,        summarizer: new MarkdownSummarizer() },
  { name: 'Tailwind CSS docs',        source: 'Context7',    fixture: fixtures.tailwindDocs,       summarizer: new MarkdownSummarizer() },
  { name: 'Page snapshot (HN)',       source: 'Playwright',  fixture: fixtures.playwrightSnap,     summarizer: new HtmlSummarizer() },
  { name: 'Network requests',         source: 'Playwright',  fixture: fixtures.playwrightNetwork,  summarizer: new NetworkSummarizer() },
  { name: 'PR list (vercel/next.js)', source: 'GitHub',      fixture: fixtures.githubPrs,          summarizer: new JsonSummarizer() },
  { name: 'Issues (facebook/react)',  source: 'GitHub',      fixture: fixtures.githubIssues,       summarizer: new JsonSummarizer() },
  { name: 'Test output (30 suites)',  source: 'vitest',      fixture: fixtures.testOutput,         summarizer: new TestOutputSummarizer() },
  { name: 'TypeScript errors (50)',   source: 'tsc',         fixture: fixtures.tscErrors,          summarizer: new TypescriptErrorSummarizer() },
  { name: 'Build output (100+ lines)',source: 'next build',  fixture: fixtures.buildOutput,        summarizer: new BuildOutputSummarizer() },
  { name: 'MCP tools (40 tools)',     source: 'MCP tools/list', fixture: fixtures.mcpTools,        summarizer: new JsonSummarizer() },
  { name: 'Access log (500 reqs)',    source: 'nginx',       fixture: fixtures.accessLog,          summarizer: new LogSummarizer() },
  { name: 'Git log (150+ commits)',   source: 'git',         fixture: fixtures.gitLog,             summarizer: new GitLogSummarizer() },
  { name: 'Analytics CSV (500 rows)', source: 'analytics',   fixture: fixtures.analyticsCsv,       summarizer: new CsvSummarizer() },
];

var part1Results = [];
var totalRaw = 0;
var totalContext = 0;

console.log();
console.log('| # | Scenario | Source | Raw Size | Context | Savings |');
console.log('|---|----------|--------|----------|---------|---------|');

for (var si = 0; si < scenarios.length; si++) {
  var sc = scenarios[si];
  var rawSize = sc.fixture.length;
  totalRaw += rawSize;

  var detected = sc.summarizer.detect(sc.fixture);
  var contextSize;
  var savings;

  if (!detected) {
    // Passthrough — no summarizer matched (e.g., small network requests)
    contextSize = rawSize;
    savings = 0;
  } else {
    var result = await sc.summarizer.summarize(sc.fixture, {});
    contextSize = result.summary.length;
    savings = result.savings_pct;
  }
  totalContext += contextSize;

  var marker = '';
  if (!detected) marker = '*';

  part1Results.push({
    name: sc.name, source: sc.source,
    rawSize: rawSize, contextSize: contextSize, savings: savings,
  });

  console.log('| ' + (si + 1) + ' | ' + sc.name + ' | ' + sc.source + ' | ' + fmtBytes(rawSize) + ' | ' + fmtBytes(contextSize) + ' | ' + savings + '%' + marker + ' |');
}

var overallSavings = Math.round(((totalRaw - totalContext) / totalRaw) * 100);
console.log();
console.log('Subtotal: ' + fmtBytes(totalRaw) + ' raw -> ' + fmtBytes(totalContext) + ' context (' + overallSavings + '% savings)');
console.log();

// ========================================================================
// PART 2: Index+Search — Knowledge Retrieval (6 scenarios)
// Mirrors ERNE BENCHMARK.md Part 2 exactly
// ========================================================================

console.log('Part 2: Index+Search — Knowledge Retrieval');
console.log('='.repeat(60));

var ContentStore = require('../../dist/plugins/storage/content-store.js').ContentStore;
var contentStore = new ContentStore({
  exec: function(sql, params) { if (params) { db.prepare(sql).run.apply(db.prepare(sql), params); } else { db.exec(sql); } },
  prepare: function(sql) { return db.prepare(sql); },
});

var searchScenarios = [
  { name: 'Supabase Edge Functions',  fixture: fixtures.supabaseEdge, source: 'context7-supabase', queries: ['edge function deploy', 'Deno serve handler', 'environment variables'] },
  { name: 'React useEffect docs',     fixture: fixtures.reactDocs,    source: 'context7-react',    queries: ['cleanup function', 'dependency array', 'async effects'] },
  { name: 'Next.js App Router docs',  fixture: fixtures.nextjsDocs,   source: 'context7-nextjs',   queries: ['file-based routing', 'loading state', 'server components'] },
  { name: 'Tailwind CSS docs',        fixture: fixtures.tailwindDocs,  source: 'context7-tailwind', queries: ['responsive design', 'dark mode', 'custom theme'] },
  { name: 'React hooks (re-search)',   fixture: fixtures.reactDocs,    source: 'context7-react',    queries: ['useState', 'useEffect lifecycle', 'custom hooks'] },
  { name: 'Next.js API routes',       fixture: fixtures.nextjsDocs,   source: 'context7-nextjs',   queries: ['API route handler', 'middleware', 'dynamic routes'] },
];

var part2Results = [];

console.log();
console.log('| # | Scenario | Raw Size | Search Result (3 queries) | Savings | Chunks |');
console.log('|---|----------|----------|---------------------------|---------|--------|');

for (var si = 0; si < searchScenarios.length; si++) {
  var sc = searchScenarios[si];
  var rawSize = sc.fixture.length;

  // Index
  contentStore.index(sc.fixture, sc.source);

  // Search with 3 queries
  var totalSearchBytes = 0;
  var totalChunks = 0;
  for (var q = 0; q < sc.queries.length; q++) {
    var res = contentStore.search(sc.queries[q], { limit: 3 });
    for (var r = 0; r < res.length; r++) {
      totalSearchBytes += res[r].content.length;
      totalChunks++;
    }
  }

  var savings = Math.round(((rawSize - totalSearchBytes) / rawSize) * 100);
  if (savings < 0) savings = 0;

  part2Results.push({
    name: sc.name, rawSize: rawSize,
    searchBytes: totalSearchBytes, savings: savings, chunks: totalChunks,
  });

  console.log('| ' + (si + 1) + ' | ' + sc.name + ' | ' + fmtBytes(rawSize) + ' | ' + fmtBytes(totalSearchBytes) + ' | ' + savings + '% | ' + totalChunks + ' |');
}

var p2TotalRaw = searchScenarios.reduce(function(s, sc) { return s + sc.fixture.length; }, 0);
var p2TotalSearch = part2Results.reduce(function(s, r) { return s + r.searchBytes; }, 0);
var p2Savings = Math.round(((p2TotalRaw - p2TotalSearch) / p2TotalRaw) * 100);
console.log();
console.log('Subtotal: ' + fmtBytes(p2TotalRaw) + ' raw -> ' + fmtBytes(p2TotalSearch) + ' context (' + p2Savings + '% savings)');
console.log();

// ========================================================================
// PART 3: Full Session Simulation
// Mirrors ERNE BENCHMARK.md Part 3 — same 8 steps
// ========================================================================

console.log('Part 3: Full Debugging Session Simulation');
console.log('='.repeat(60));

var sessionSteps = [
  // Summarize steps
  { action: 'summarize', label: 'Context7 docs (React)',   fixture: fixtures.reactDocs,       summarizer: new MarkdownSummarizer() },
  { action: 'summarize', label: 'Context7 docs (Next.js)', fixture: fixtures.nextjsDocs,       summarizer: new MarkdownSummarizer() },
  { action: 'summarize', label: 'Playwright snapshot',     fixture: fixtures.playwrightSnap,   summarizer: new HtmlSummarizer() },
  { action: 'summarize', label: 'GitHub issues',           fixture: fixtures.githubIssues,     summarizer: new JsonSummarizer() },
  { action: 'summarize', label: 'Test output',             fixture: fixtures.testOutput,       summarizer: new TestOutputSummarizer() },
  { action: 'summarize', label: 'Build output',            fixture: fixtures.buildOutput,      summarizer: new BuildOutputSummarizer() },
  // Search steps
  { action: 'search', label: 'Doc search (useEffect)',   fixture: fixtures.reactDocs,  source: 'context7-react',  query: 'useEffect cleanup' },
  { action: 'search', label: 'Doc search (server comp)', fixture: fixtures.nextjsDocs,  source: 'context7-nextjs', query: 'server component data' },
];

var sessionTotalRaw = 0;
var sessionTotalContext = 0;

console.log();
console.log('| Step | Tool Call | Without context-mem | With context-mem |');
console.log('|------|-----------|--------------------|--------------------|');

for (var i = 0; i < sessionSteps.length; i++) {
  var step = sessionSteps[i];
  var rawSize = step.fixture.length;
  sessionTotalRaw += rawSize;
  var contextSize;

  if (step.action === 'summarize') {
    if (step.summarizer.detect(step.fixture)) {
      var r = await step.summarizer.summarize(step.fixture, {});
      contextSize = r.summary.length;
    } else {
      contextSize = rawSize;
    }
  } else {
    // search
    contentStore.index(step.fixture, step.source);
    var searchResults = contentStore.search(step.query, { limit: 3 });
    contextSize = searchResults.reduce(function(s, r) { return s + r.content.length; }, 0);
  }

  sessionTotalContext += contextSize;
  console.log('| ' + (i + 1) + ' | ' + step.label + ' | ' + fmtBytes(rawSize) + ' | ' + fmtBytes(contextSize) + ' |');
}

var sessionSavings = Math.round(((sessionTotalRaw - sessionTotalContext) / sessionTotalRaw) * 100);
var sessionTokensRaw = Math.round(sessionTotalRaw / 4);
var sessionTokensCtx = Math.round(sessionTotalContext / 4);

console.log('| **Total** | | **' + fmtBytes(sessionTotalRaw) + '** | **' + fmtBytes(sessionTotalContext) + '** |');
console.log('| **Tokens** | | **~' + sessionTokensRaw.toLocaleString() + '** | **~' + sessionTokensCtx.toLocaleString() + '** |');
console.log();
console.log('Result: ' + sessionSavings + '% context savings — ' + Math.round(sessionTotalRaw / sessionTotalContext) + 'x compression');
console.log();

// ========================================================================
// PART 4: Search Performance
// ========================================================================

console.log('Part 4: Search Performance');
console.log('='.repeat(60));

var ftsSearch = db.prepare(
  'SELECT o.id, o.type, o.summary, bm25(obs_fts) as rank FROM obs_fts f JOIN observations o ON o.rowid = f.rowid WHERE obs_fts MATCH ? ORDER BY rank LIMIT 10'
);
bench('BM25 search', function(i) {
  var queries = ['TypeError', 'product', 'build', 'authentication', 'API response'];
  ftsSearch.all('"' + queries[i % queries.length] + '"');
}, 5000);

var trigramSearch = db.prepare(
  'SELECT o.id, o.type, o.summary FROM obs_trigram t JOIN observations o ON o.rowid = t.rowid WHERE obs_trigram MATCH ? LIMIT 10'
);
bench('trigram search', function(i) {
  var queries = ['TypeErr', 'prodct', 'bundel', 'authen', 'respons'];
  try { trigramSearch.all('"' + queries[i % queries.length] + '"'); } catch(e) {}
}, 5000);

// Levenshtein
var LevenshteinSearch = require('../../dist/plugins/search/levenshtein.js').LevenshteinSearch;
var levSearch = new LevenshteinSearch({
  exec: function(sql, params) { if (params) { db.prepare(sql).run.apply(db.prepare(sql), params); } else { db.exec(sql); } },
  prepare: function(sql) { return db.prepare(sql); },
});
bench('levenshtein search', function(i) {
  var queries = ['TypeErr', 'produckt', 'bundel', 'authen', 'respon'];
  levSearch.search(queries[i % queries.length], { limit: 5 });
}, 500);

var timelineQuery = db.prepare('SELECT id, type, summary, indexed_at FROM observations ORDER BY indexed_at DESC LIMIT ?');
bench('timeline (limit 50)', function() { timelineQuery.all(50); }, 5000);
bench('timeline (limit 200)', function() { timelineQuery.all(200); }, 2000);
bench('count by type', function() { db.prepare('SELECT type, COUNT(*) as c FROM observations GROUP BY type').all(); }, 5000);

console.log();

// ========================================================================
// PART 5: New Features Performance
// ========================================================================

console.log('Part 5: New Features Performance');
console.log('='.repeat(60));

// Knowledge Base
var KnowledgeBase = require('../../dist/plugins/knowledge/knowledge-base.js').KnowledgeBase;
var ulid = require('../../dist/core/utils.js').ulid;
var kb = new KnowledgeBase({
  exec: function(sql, params) { if (params) { db.prepare(sql).run.apply(db.prepare(sql), params); } else { db.exec(sql); } },
  prepare: function(sql) { return db.prepare(sql); },
});

bench('knowledge save', function(i) {
  kb.save({ category: 'pattern', title: 'Pattern ' + i, content: 'React component pattern with hooks and memoization for performance optimization scenario ' + i, tags: ['react', 'hooks'] });
}, 200);

bench('knowledge search (FTS5)', function(i) {
  var queries = ['hooks', 'memoization', 'component', 'optimization', 'pattern'];
  kb.search(queries[i % queries.length], { limit: 5 });
}, 1000);

// Budget
var BudgetManager = require('../../dist/core/budget.js').BudgetManager;
var budget = new BudgetManager({
  exec: function(sql, params) { if (params) { db.prepare(sql).run.apply(db.prepare(sql), params); } else { db.exec(sql); } },
  prepare: function(sql) { return db.prepare(sql); },
});
bench('budget check', function() { budget.check('BENCH_SESSION'); }, 5000);

// Events
var EventTracker = require('../../dist/core/events.js').EventTracker;
var events = new EventTracker({
  exec: function(sql, params) { if (params) { db.prepare(sql).run.apply(db.prepare(sql), params); } else { db.exec(sql); } },
  prepare: function(sql) { return db.prepare(sql); },
});
bench('event emit', function(i) {
  events.emit('BENCH_SESSION', 'file_read', { file: 'src/comp' + i + '.tsx' });
}, 500);
bench('event query', function() { events.query('BENCH_SESSION', { limit: 20 }); }, 2000);

// Session
var SessionManager = require('../../dist/core/session.js').SessionManager;
var session = new SessionManager({
  exec: function(sql, params) { if (params) { db.prepare(sql).run.apply(db.prepare(sql), params); } else { db.exec(sql); } },
  prepare: function(sql) { return db.prepare(sql); },
}, events);
var fakeStats = { session_id: 'BENCH', observations_stored: 100, total_content_bytes: 50000, total_summary_bytes: 5000, searches_performed: 10, discovery_tokens: 500, read_tokens: 200, tokens_saved: 45000, savings_percentage: 90 };
bench('snapshot save', function(i) { session.saveSnapshot('BENCH_' + i, fakeStats); }, 500);
bench('snapshot restore', function(i) { session.restoreSnapshot('BENCH_' + (i % 500)); }, 2000);

console.log();

// ========================================================================
// PART 6: Truncation Cascade
// ========================================================================

console.log('Part 6: Truncation Cascade');
console.log('='.repeat(60));

var truncate = require('../../dist/core/truncation.js').truncate;

var truncScenarios = [
  { name: 'T1: JSON schema', content: fixtures.githubIssues },
  { name: 'T2: Test output pattern', content: fixtures.testOutput },
  { name: 'T3: Head/Tail (large text)', content: fixtures.playwrightSnap },
  { name: 'T4: Binary content', content: String.fromCharCode.apply(null, Array.from({length: 2048}, function(_, i) { return i % 256; })) },
];

console.log();
console.log('| Tier | Input Size | Output Size | Savings |');
console.log('|------|-----------|-------------|---------|');

for (var ti = 0; ti < truncScenarios.length; ti++) {
  var tc = truncScenarios[ti];
  var tResult = truncate(tc.content);
  var tSavings = Math.round((1 - tResult.truncated_length / tResult.original_length) * 100);
  console.log('| ' + tc.name + ' | ' + fmtBytes(tResult.original_length) + ' | ' + fmtBytes(tResult.truncated_length) + ' | ' + tSavings + '% |');
}

console.log();

// ========================================================================
// PART 7: Database Metrics
// ========================================================================

console.log('Part 7: Database Metrics');
console.log('='.repeat(60));

var obsCount = db.prepare('SELECT COUNT(*) as c FROM observations').get().c;
var dbSize = fs.statSync(BENCH_DB).size;
var avgObsSize = Math.round(dbSize / obsCount);
var ftsSize = db.prepare('SELECT SUM(length(block)) as s FROM obs_fts_data').get();
var triSize = db.prepare('SELECT SUM(length(block)) as s FROM obs_trigram_data').get();

console.log('  Observations: ' + obsCount);
console.log('  DB size: ' + (dbSize / 1024 / 1024).toFixed(2) + ' MB');
console.log('  Avg per obs: ' + avgObsSize + ' bytes');
console.log('  WAL mode: enabled');
console.log('  FTS5 index: ' + ((ftsSize.s || 0) / 1024).toFixed(1) + ' KB');
console.log('  Trigram index: ' + ((triSize.s || 0) / 1024).toFixed(1) + ' KB');
console.log();

// ========================================================================
// Generate results.md
// ========================================================================

var md = '# context-mem ERNE-Parity Benchmarks\n\n';
md += '> Using ERNE\'s exact fixture files for apples-to-apples comparison.\n';
md += '> Generated on ' + new Date().toISOString().split('T')[0] + '\n\n';

md += '## Environment\n\n';
md += '| Metric | Value |\n|--------|-------|\n';
md += '| Node.js | ' + process.version + ' |\n';
md += '| OS | ' + os.platform() + ' ' + os.arch() + ' |\n';
md += '| CPU | ' + os.cpus()[0].model + ' |\n';
md += '| RAM | ' + Math.round(os.totalmem() / 1024 / 1024 / 1024) + ' GB |\n';
md += '| Total raw data tested | ' + fmtBytes(totalRaw) + ' |\n\n';

md += '## Part 1: Summarizer — Structured Data Processing (14 scenarios)\n\n';
md += '| Scenario | Source | Raw Size | Context | Savings |\n';
md += '|----------|--------|----------|---------|--------|\n';
for (var i = 0; i < part1Results.length; i++) {
  var r = part1Results[i];
  md += '| ' + r.name + ' | ' + r.source + ' | ' + fmtBytes(r.rawSize) + ' | ' + fmtBytes(r.contextSize) + ' | ' + r.savings + '% |\n';
}
md += '\n**Subtotal: ' + fmtBytes(totalRaw) + ' raw → ' + fmtBytes(totalContext) + ' context (' + overallSavings + '% savings)**\n\n';

md += '## Part 2: Index+Search — Knowledge Retrieval (6 scenarios)\n\n';
md += '| Scenario | Raw Size | Search Result (3 queries) | Savings | Chunks |\n';
md += '|----------|----------|---------------------------|---------|--------|\n';
for (var i = 0; i < part2Results.length; i++) {
  var r = part2Results[i];
  md += '| ' + r.name + ' | ' + fmtBytes(r.rawSize) + ' | ' + fmtBytes(r.searchBytes) + ' | ' + r.savings + '% | ' + r.chunks + ' |\n';
}
md += '\n**Subtotal: ' + fmtBytes(p2TotalRaw) + ' raw → ' + fmtBytes(p2TotalSearch) + ' context (' + p2Savings + '% savings)**\n\n';

md += '## Part 3: Full Session Simulation\n\n';
md += '| Metric | Without context-mem | With context-mem |\n';
md += '|--------|--------------------|-----------------|\n';
md += '| Total data | ' + fmtBytes(sessionTotalRaw) + ' | ' + fmtBytes(sessionTotalContext) + ' |\n';
md += '| Tokens | ~' + sessionTokensRaw.toLocaleString() + ' | ~' + sessionTokensCtx.toLocaleString() + ' |\n';
md += '| Savings | — | **' + sessionSavings + '%** |\n\n';

md += '## Part 4: Search Performance\n\n';
md += '| Operation | Avg | p50 | p95 | p99 | ops/s |\n';
md += '|-----------|-----|-----|-----|-----|-------|\n';
var searchNames = ['BM25 search', 'trigram search', 'levenshtein search', 'timeline (limit 50)', 'timeline (limit 200)', 'count by type'];
for (var i = 0; i < results.length; i++) {
  if (searchNames.indexOf(results[i].name) >= 0) {
    md += '| ' + results[i].name + ' | ' + results[i].avg + 'ms | ' + results[i].p50 + 'ms | ' + results[i].p95 + 'ms | ' + results[i].p99 + 'ms | ' + results[i].ops.toLocaleString() + ' |\n';
  }
}

md += '\n## Part 5: New Features Performance\n\n';
md += '| Feature | Operation | Avg | p50 | ops/s |\n';
md += '|---------|-----------|-----|-----|-------|\n';
var featureNames = ['knowledge save', 'knowledge search (FTS5)', 'budget check', 'event emit', 'event query', 'snapshot save', 'snapshot restore'];
for (var i = 0; i < results.length; i++) {
  if (featureNames.indexOf(results[i].name) >= 0) {
    md += '| | ' + results[i].name + ' | ' + results[i].avg + 'ms | ' + results[i].p50 + 'ms | ' + results[i].ops.toLocaleString() + ' |\n';
  }
}

md += '\n## Part 6: Truncation Cascade\n\n';
md += '| Tier | Input Size | Output Size | Savings |\n';
md += '|------|-----------|-------------|--------|\n';
for (var ti = 0; ti < truncScenarios.length; ti++) {
  var tc = truncScenarios[ti];
  var tr = truncate(tc.content);
  var ts = Math.round((1 - tr.truncated_length / tr.original_length) * 100);
  md += '| ' + tc.name + ' | ' + fmtBytes(tr.original_length) + ' | ' + fmtBytes(tr.truncated_length) + ' | ' + ts + '% |\n';
}

md += '\n## Part 7: Database Metrics\n\n';
md += '| Metric | Value |\n|--------|-------|\n';
md += '| Observations | ' + obsCount + ' |\n';
md += '| DB Size | ' + (dbSize / 1024 / 1024).toFixed(2) + ' MB |\n';
md += '| Avg per obs | ' + avgObsSize + ' bytes |\n';
md += '| FTS5 index | ' + ((ftsSize.s || 0) / 1024).toFixed(1) + ' KB |\n';
md += '| Trigram index | ' + ((triSize.s || 0) / 1024).toFixed(1) + ' KB |\n';

md += '\n## Comparison with ERNE\n\n';
md += '| Metric | ERNE | context-mem |\n';
md += '|--------|------|-------------|\n';
md += '| Summarizer savings | 100% | **' + overallSavings + '%** |\n';
md += '| Index+Search savings | 80% | **' + p2Savings + '%** |\n';
md += '| Full session savings | 99% | **' + sessionSavings + '%** |\n';
md += '| Content types detected | 14 | **14** |\n';
md += '| Search technology | FTS5 BM25 | FTS5 BM25 + Trigram + Levenshtein |\n';
md += '| Code preservation | Yes | Yes |\n';
md += '| Budget management | Yes | **Yes** |\n';
md += '| Session continuity | Yes | **Yes** |\n';
md += '| Knowledge base | No | **Yes** |\n';
md += '| Event tracking | No | **Yes** |\n';
md += '| Total raw data tested | 537.5 KB | **' + fmtBytes(totalRaw) + '** |\n';

var resultsPath = path.join(__dirname, 'results.md');
fs.writeFileSync(resultsPath, md);
console.log('Results saved to: ' + resultsPath);

// Cleanup
db.close();
fs.unlinkSync(BENCH_DB);
try { fs.unlinkSync(BENCH_DB + '-wal'); } catch(e) {}
try { fs.unlinkSync(BENCH_DB + '-shm'); } catch(e) {}
console.log('Benchmark DB cleaned up');

})();
