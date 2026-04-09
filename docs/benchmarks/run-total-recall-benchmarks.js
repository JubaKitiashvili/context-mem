#!/usr/bin/env node
'use strict';

/**
 * Total Recall Benchmark Suite
 *
 * Tests performance of v3.0 features:
 * 1. Importance Classification throughput
 * 2. Entity Extraction throughput
 * 3. Topic Detection throughput
 * 4. Adaptive Compression (tier calculation + compression)
 * 5. Verbatim Recall (FTS5 content search)
 * 6. Wake-Up Primer assembly
 * 7. Decision Trail reconstruction
 * 8. Narrative Generation
 * 9. Pressure Prediction
 * 10. Conversation Parsing
 *
 * Usage: node docs/benchmarks/run-total-recall-benchmarks.js
 */

var path = require('path');
var os = require('os');
var fs = require('fs');

var projectRoot = path.resolve(__dirname, '..', '..');
process.chdir(projectRoot);

var Database = require('better-sqlite3');
var migrations = require('../../dist/plugins/storage/migrations.js').migrations;

var BENCH_DB = path.join(os.tmpdir(), 'total-recall-bench-' + Date.now() + '.db');
var results = [];

// ---- Helpers ----
function bench(name, fn, iterations) {
  if (iterations === undefined) iterations = 1000;
  // Warmup
  for (var i = 0; i < Math.min(10, iterations); i++) fn(i);
  var times = [];
  var start = performance.now();
  for (var i = 0; i < iterations; i++) {
    var t0 = performance.now();
    fn(i);
    times.push(performance.now() - t0);
  }
  var elapsed = performance.now() - start;
  times.sort(function(a, b) { return a - b; });
  var avg = elapsed / iterations;
  var p50 = times[Math.floor(times.length * 0.5)];
  var p95 = times[Math.floor(times.length * 0.95)];
  var p99 = times[Math.floor(times.length * 0.99)];
  var opsPerSec = Math.round(1000 / avg);
  results.push({ name: name, avg: avg, p50: p50, p95: p95, p99: p99, ops: opsPerSec, iterations: iterations });
  console.log('  ' + name + ': ' + avg.toFixed(3) + 'ms avg (' + opsPerSec.toLocaleString() + ' ops/s) [p50=' + p50.toFixed(3) + ' p95=' + p95.toFixed(3) + ' p99=' + p99.toFixed(3) + ']');
}

function setupDb() {
  var db = new Database(BENCH_DB);
  db.pragma('journal_mode = WAL');
  for (var m of migrations) { db.exec(m.up); }
  return db;
}

function seedData(db, count) {
  var types = ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'];
  var contents = [
    'We decided to use PostgreSQL for the database layer because of better JSON support and reliability',
    'Error: connection refused to database at port 5432 — critical vulnerability in auth module',
    'Fixed by updating the connection pool configuration and adding retry logic with exponential backoff',
    'Shipped the new authentication service to production with JWT token rotation',
    'The React component UserProfileCard renders user data from the REST API endpoint',
    'Created a new project using TypeScript strict mode with ESLint and Prettier configured',
    'Bug: failing regression test in the payment module after switching from Stripe to PayPal',
  ];
  var stmt = db.prepare(`INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (var i = 0; i < count; i++) {
    var content = contents[i % contents.length] + ' (observation #' + i + ')';
    var type = types[i % types.length];
    var importance = Math.random() * 0.8 + 0.2;
    var pinned = type === 'decision' ? 1 : 0;
    stmt.run('obs-' + i, type, content, content.slice(0, 100), JSON.stringify({
      source: 'bench', tokens_original: content.length, tokens_summarized: 100,
      privacy_level: 'public', significance_flags: type === 'decision' ? ['DECISION'] : ['PROBLEM'],
      entities: ['PostgreSQL', 'React', 'TypeScript'],
    }), Date.now() - (count - i) * 86400000, importance, pinned, 'verbatim', 'bench-session');
  }
  // Seed knowledge
  var kStmt = db.prepare(`INSERT INTO knowledge (id, category, title, content, tags, created_at, relevance_score, access_count, valid_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (var i = 0; i < 20; i++) {
    kStmt.run('k-' + i, 'decision', 'Decision #' + i, 'Knowledge content for decision ' + i, '[]', Date.now() - i * 86400000, 1.0 + Math.random(), i * 2, Date.now() - i * 86400000);
  }
  // Seed entities
  var eStmt = db.prepare('INSERT INTO entities (id, name, entity_type, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  ['PostgreSQL', 'React', 'TypeScript', 'Docker', 'Redis'].forEach(function(name, i) {
    eStmt.run('e-' + i, name, 'library', '{}', Date.now(), Date.now());
  });
  // Seed topics
  var tStmt = db.prepare('INSERT INTO topics (id, name, observation_count, last_seen) VALUES (?, ?, ?, ?)');
  ['database', 'auth', 'frontend', 'deployment', 'testing'].forEach(function(name, i) {
    tStmt.run('t-' + i, name, 10 + i * 5, Date.now());
  });
  // Link observations to topics
  var otStmt = db.prepare('INSERT OR IGNORE INTO observation_topics (observation_id, topic_id, confidence) VALUES (?, ?, ?)');
  for (var i = 0; i < Math.min(count, 50); i++) {
    otStmt.run('obs-' + i, 't-' + (i % 5), 0.8);
  }
}

// ---- Run Benchmarks ----
console.log('\n=== Total Recall Benchmark Suite ===\n');

var db = setupDb();
seedData(db, 500);
console.log('Seeded 500 observations, 20 knowledge entries, 5 entities, 5 topics\n');

// 1. Importance Classification
console.log('1. Importance Classification');
var classifyImportance = require('../../dist/core/importance-classifier.js').classifyImportance;
var testContent = 'We decided to use PostgreSQL for the database because of critical performance requirements and always needing reliability';
bench('classifyImportance (decision text)', function() { classifyImportance(testContent, 'decision', { entities: ['PostgreSQL'] }); }, 10000);
bench('classifyImportance (simple log)', function() { classifyImportance('INFO: request processed', 'log'); }, 10000);

// 2. Entity Extraction
console.log('\n2. Entity Extraction');
var extractEntities = require('../../dist/core/entity-extractor.js').extractEntities;
var entityContent = 'John Smith fixed #42 by updating src/auth/login.ts to use React v18.2.0 with Docker and PostgreSQL';
bench('extractEntities (mixed content)', function() { extractEntities(entityContent); }, 5000);
bench('extractEntities (short text)', function() { extractEntities('simple text'); }, 10000);

// 3. Topic Detection
console.log('\n3. Topic Detection');
var detectTopics = require('../../dist/core/topic-detector.js').detectTopics;
bench('detectTopics (multi-topic)', function() { detectTopics('Deploy Docker container with API endpoint and fix security vulnerability'); }, 10000);

// 4. Adaptive Compression
console.log('\n4. Adaptive Compression');
var getTargetTier = require('../../dist/core/adaptive-compressor.js').getTargetTier;
var compressToTier = require('../../dist/core/adaptive-compressor.js').compressToTier;
var longContent = 'First paragraph about architecture decisions. We decided to use microservices. This was a critical choice.\n\nSecond paragraph about implementation. The deployment was completed successfully. We shipped the feature.\n\nThird paragraph about testing and monitoring.';
bench('getTargetTier', function() { getTargetTier(Date.now() - 15 * 86400000, 0.7, false); }, 10000);
bench('compressToTier (light)', function() { compressToTier(longContent, null, 'light'); }, 5000);
bench('compressToTier (distilled)', function() { compressToTier(longContent, 'Summary text', 'distilled'); }, 5000);

// 5. Verbatim Recall (FTS5)
console.log('\n5. Verbatim Recall (FTS5 content search)');
bench('content FTS search', function() { db.prepare("SELECT rowid FROM obs_content_fts WHERE obs_content_fts MATCH '\"PostgreSQL\"' LIMIT 10").all(); }, 5000);
bench('content FTS + join', function() { db.prepare("SELECT o.id, o.content FROM obs_content_fts JOIN observations o ON o.rowid = obs_content_fts.rowid WHERE obs_content_fts MATCH '\"PostgreSQL\"' LIMIT 5").all(); }, 5000);

// 6. Wake-Up Primer
console.log('\n6. Wake-Up Primer Assembly');
var assembleWakeUp = require('../../dist/core/wake-up.js').assembleWakeUp;
bench('assembleWakeUp (full)', function() { assembleWakeUp(db); }, 500);

// 7. Pressure Prediction
console.log('\n7. Pressure Prediction');
bench('pressure query (top 10)', function() {
  db.prepare('SELECT id, importance_score, access_count, indexed_at FROM observations WHERE pinned = 0 ORDER BY importance_score ASC LIMIT 50').all();
}, 2000);

// 8. Topic Query
console.log('\n8. Topic Queries');
bench('list topics', function() { db.prepare('SELECT id, name, observation_count FROM topics ORDER BY observation_count DESC LIMIT 20').all(); }, 5000);
bench('topic observations', function() {
  db.prepare(`SELECT o.id, o.importance_score FROM observation_topics ot
    JOIN observations o ON o.id = ot.observation_id WHERE ot.topic_id = 't-0' LIMIT 20`).all();
}, 5000);

// 9. Conversation Parsing
console.log('\n9. Conversation Parsing');
var parseClaudeCode = require('../../dist/core/conversation-parsers/claude-code-parser.js').parseClaudeCode;
var parseChatGPT = require('../../dist/core/conversation-parsers/chatgpt-parser.js').parseChatGPT;
var jsonlInput = '{"role":"user","content":"Hello"}\n{"role":"assistant","content":"Hi there"}\n{"role":"user","content":"How are you?"}\n{"role":"assistant","content":"I am fine"}';
bench('parseClaudeCode (4 messages)', function() { parseClaudeCode(jsonlInput); }, 5000);
var chatgptInput = JSON.stringify([{ title: 'Test', mapping: {
  a: { message: { author: { role: 'user' }, content: { parts: ['Hello'] } } },
  b: { message: { author: { role: 'assistant' }, content: { parts: ['World'] } } },
}}]);
bench('parseChatGPT (2 messages)', function() { parseChatGPT(chatgptInput); }, 5000);

// 10. Narrative Generation
console.log('\n10. Narrative Generation');
var generateNarrative = require('../../dist/core/narrative-generator.js').generateNarrative;
bench('generateNarrative (PR)', function() { generateNarrative(db, { format: 'pr' }); }, 1000);
bench('generateNarrative (standup)', function() { generateNarrative(db, { format: 'standup' }); }, 1000);

// Cleanup
db.close();
try { fs.unlinkSync(BENCH_DB); } catch {}

// Summary
console.log('\n=== Summary ===\n');
console.log('| Benchmark | Avg (ms) | Ops/sec | P95 (ms) |');
console.log('|-----------|----------|---------|----------|');
for (var r of results) {
  console.log('| ' + r.name + ' | ' + r.avg.toFixed(3) + ' | ' + r.ops.toLocaleString() + ' | ' + r.p95.toFixed(3) + ' |');
}
console.log('\nAll benchmarks complete.\n');
