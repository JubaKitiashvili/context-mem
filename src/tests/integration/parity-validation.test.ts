import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Kernel } from '../../core/kernel.js';
import { truncate, MAX_PASSTHROUGH } from '../../core/truncation.js';
import {
  handleObserve,
  handleSummarize,
  handleSearch,
  handleTimeline,
  handleGet,
  handleStats,
  handleIndexContent,
  handleSearchContent,
  handleSaveKnowledge,
  handleSearchKnowledge,
  handleBudgetStatus,
  handleBudgetConfigure,
  handleRestoreSession,
  handleEmitEvent,
  handleQueryEvents,
} from '../../mcp-server/tools.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import type { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStorage(kernel: Kernel): BetterSqlite3Storage {
  return (kernel as unknown as { storage: BetterSqlite3Storage }).storage;
}

function buildToolKernel(kernel: Kernel): ToolKernel {
  return {
    pipeline: kernel.pipeline,
    search: kernel.getSearchFusion(),
    storage: kernel.getStorage(),
    registry: kernel.registry,
    sessionId: kernel['session'].session_id,
    config: kernel.getConfig(),
    budgetManager: kernel.getBudgetManager(),
    eventTracker: kernel.getEventTracker(),
    sessionManager: kernel.getSessionManager(),
    contentStore: kernel.getContentStore(),
    knowledgeBase: kernel.getKnowledgeBase(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Parity Validation — All New Features', () => {
  let kernel: Kernel;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-parity-'));
    kernel = new Kernel(tmpDir);
    await kernel.start();
  });

  afterEach(async () => {
    if (kernel) await kernel.stop();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // =========================================================================
  // 1. SHA256 Deduplication
  // =========================================================================
  describe('1. SHA256 Deduplication', () => {
    it('insert same content twice returns same ID', async () => {
      const content = 'const add = (a: number, b: number): number => a + b;';
      const obs1 = await kernel.pipeline.observe(content, 'code', 'Read');
      const obs2 = await kernel.pipeline.observe(content, 'code', 'Read');

      assert.equal(obs1.id, obs2.id, 'Same content must produce the same observation ID');
      assert.equal(obs1.content_hash, obs2.content_hash, 'Content hashes must match');

      // Verify only one row in the DB
      const storage = getStorage(kernel);
      const row = storage.prepare('SELECT COUNT(*) as n FROM observations WHERE content_hash = ?').get(obs1.content_hash!) as { n: number };
      assert.equal(row.n, 1, 'Only one row should exist for duplicated content');
    });

    it('different content produces different IDs', async () => {
      const obs1 = await kernel.pipeline.observe('function alpha() {}', 'code', 'Read');
      const obs2 = await kernel.pipeline.observe('function beta() {}', 'code', 'Read');
      assert.notEqual(obs1.id, obs2.id);
      assert.notEqual(obs1.content_hash, obs2.content_hash);
    });
  });

  // =========================================================================
  // 2. Truncation Cascade
  // =========================================================================
  describe('2. Truncation Cascade', () => {
    it('Tier 1 — JSON schema extraction', () => {
      const bigJson = JSON.stringify({
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i, name: `User ${i}`, email: `user${i}@test.com`,
        })),
      });
      // Ensure it exceeds passthrough
      assert.ok(bigJson.length > MAX_PASSTHROUGH, 'JSON should exceed passthrough limit');
      const result = truncate(bigJson);
      assert.equal(result.tier, 1, 'Should use Tier 1 JSON schema extraction');
      assert.ok(result.content.includes('[JSON schema]'), 'Should contain JSON schema marker');
      assert.ok(result.truncated_length < result.original_length, 'Should be smaller than original');
    });

    it('Tier 2 — pattern matching (test output)', () => {
      const testOutput = Array.from({ length: 300 }, (_, i) =>
        `PASS tests/module-${i}.test.ts`
      ).join('\n') + '\nTests: 300 passed, 300 total\nTest Suites: 300 passed, 300 total';
      assert.ok(testOutput.length > MAX_PASSTHROUGH);
      const result = truncate(testOutput);
      assert.equal(result.tier, 2, 'Should use Tier 2 pattern matching');
      assert.ok(result.content.includes('Test output summary') || result.content.includes('PASS') || result.content.includes('Tests:'));
    });

    it('Tier 3 — head/tail slicing for plain text', () => {
      const longText = Array.from({ length: 2000 }, (_, i) =>
        `Line ${i}: This is a plain text line with some content that is not JSON or a test output.`
      ).join('\n');
      assert.ok(longText.length > MAX_PASSTHROUGH);
      const result = truncate(longText);
      assert.equal(result.tier, 3, 'Should use Tier 3 head/tail');
      assert.ok(result.content.includes('omitted'), 'Should indicate omitted content');
    });

    it('Tier 4 — binary content hashing', () => {
      // Create binary-like content
      const chars: string[] = [];
      for (let i = 0; i < 3000; i++) {
        chars.push(String.fromCharCode(i % 256));
      }
      const binaryContent = chars.join('');
      const result = truncate(binaryContent);
      assert.equal(result.tier, 4, 'Should use Tier 4 binary hashing');
      assert.ok(result.content.includes('Binary content') || result.content.includes('sha256:'));
    });
  });

  // =========================================================================
  // 3. All 9 New Summarizers
  // =========================================================================
  describe('3. New Summarizers — detection and compression', () => {
    it('Markdown — multi-heading document', async () => {
      const md = [
        '# Getting Started',
        '',
        'Welcome to the project.',
        '',
        '## Installation',
        '',
        'Run `npm install` to install dependencies.',
        '',
        '## Configuration',
        '',
        'Edit `.env` to set up environment variables.',
        '',
        '### Database',
        '',
        'Set `DATABASE_URL` to your connection string.',
        '',
        '## Usage',
        '',
        'Run `npm start` to launch the server.',
      ].join('\n');

      const obs = await kernel.pipeline.observe(md, 'context', 'Read');
      assert.ok(obs.summary, 'Markdown should be summarized');
      assert.ok(obs.summary!.includes('Getting Started'), 'Should extract the title');
      assert.ok(obs.summary!.includes('headings'), 'Should mention heading structure');
    });

    it('HTML — full page with title, headings, forms', async () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>My Dashboard</title></head>
<body>
  <h1>Dashboard</h1>
  <nav><a href="/">Home</a> <a href="/settings">Settings</a></nav>
  <h2>Statistics</h2>
  <p>Some stats go here.</p>
  <h2>Settings</h2>
  <form action="/save"><input name="theme" /><button>Save</button></form>
  <h3>Advanced</h3>
  <p>Advanced settings panel.</p>
</body>
</html>`;

      const obs = await kernel.pipeline.observe(html, 'context', 'Read');
      assert.ok(obs.summary, 'HTML should be summarized');
      assert.ok(obs.summary!.includes('My Dashboard'), 'Should extract <title>');
      assert.ok(obs.summary!.includes('Forms: 1'), 'Should count forms');
    });

    it('TypeScript errors — error TS2345 format', async () => {
      const tsErrors = [
        'src/auth.ts(12,5): error TS2345: Argument of type string is not assignable to parameter of type number.',
        'src/auth.ts(25,10): error TS2322: Type boolean is not assignable to type string.',
        'src/utils.ts(8,3): error TS2345: Argument of type string is not assignable to parameter of type number.',
        'src/api.ts(100,1): error TS7006: Parameter req implicitly has an any type.',
        'src/api.ts(101,1): error TS7006: Parameter res implicitly has an any type.',
      ].join('\n');

      const obs = await kernel.pipeline.observe(tsErrors, 'error', 'Bash');
      assert.ok(obs.summary, 'TypeScript errors should be summarized');
      assert.ok(obs.summary!.includes('TypeScript Errors'), 'Should have TS errors header');
      assert.ok(obs.summary!.includes('TS2345'), 'Should list error codes');
    });

    it('Build output — webpack/vite style', async () => {
      const buildOutput = `vite v5.0.0 Building for production...
Compiling TypeScript files...
Route /api/users
Route /api/posts
Route /api/auth
Bundle size: main.js - 245.3 kB
Bundle size: vendor.js - 512.1 kB
warning: Some modules are unused
warning: Tree-shaking detected dead code
Done in 12.5s`;

      const obs = await kernel.pipeline.observe(buildOutput, 'log', 'Bash');
      assert.ok(obs.summary, 'Build output should be summarized');
      assert.ok(obs.summary!.includes('Build Output'), 'Should have build output header');
      assert.ok(obs.summary!.includes('Warnings: 2') || obs.summary!.includes('warning'), 'Should count warnings');
    });

    it('Git log — full format with commit hashes', async () => {
      const gitLog = `commit a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
Author: Alice Developer <alice@dev.com>
Date:   Mon Jan 15 10:30:00 2024 +0000

    feat: add user authentication module

commit b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
Author: Bob Engineer <bob@dev.com>
Date:   Sun Jan 14 15:45:00 2024 +0000

    fix: resolve race condition in token refresh

commit c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
Author: Alice Developer <alice@dev.com>
Date:   Sat Jan 13 09:00:00 2024 +0000

    refactor: extract database layer into separate module`;

      const obs = await kernel.pipeline.observe(gitLog, 'commit', 'Bash');
      assert.ok(obs.summary, 'Git log should be summarized');
      assert.ok(obs.summary!.includes('Commits: 3'), 'Should count commits');
      assert.ok(obs.summary!.includes('Authors: 2'), 'Should count unique authors');
      assert.ok(obs.summary!.includes('feat'), 'Should detect commit types');
    });

    it('CSV — 5+ rows with consistent commas', async () => {
      const csv = [
        'id,name,email,role,status',
        '1,Alice,alice@test.com,admin,active',
        '2,Bob,bob@test.com,user,active',
        '3,Carol,carol@test.com,user,inactive',
        '4,Dave,dave@test.com,admin,active',
        '5,Eve,eve@test.com,user,active',
        '6,Frank,frank@test.com,user,inactive',
      ].join('\n');

      const obs = await kernel.pipeline.observe(csv, 'context', 'Read');
      assert.ok(obs.summary, 'CSV should be summarized');
      assert.ok(obs.summary!.includes('CSV'), 'Should identify as CSV');
      assert.ok(obs.summary!.includes('7 rows') || obs.summary!.includes('columns'), 'Should mention dimensions');
    });

    it('Network — HTTP method + status code lines', async () => {
      const networkLog = [
        'GET /api/users 200 45ms',
        'POST /api/login 200 120ms',
        'GET /api/posts 200 33ms',
        'DELETE /api/posts/5 204 18ms',
        'GET /api/admin 403 5ms',
        'POST /api/upload 500 2500ms',
        'PUT /api/users/1 200 85ms',
        'PATCH /api/settings 200 60ms',
        'GET /api/health 200 3ms',
        'GET /api/metrics 200 12ms',
        'POST /api/webhooks 201 55ms',
        'GET /api/search 200 250ms',
      ].join('\n');

      const obs = await kernel.pipeline.observe(networkLog, 'log', 'Bash');
      assert.ok(obs.summary, 'Network log should be summarized');
      assert.ok(obs.summary!.includes('Network'), 'Should identify as network');
      assert.ok(obs.summary!.includes('GET'), 'Should list methods');
    });

    it('Test output — Jest-style pass/fail', async () => {
      const testOutput = `PASS tests/auth.test.ts
  Auth Service
    ✓ should login (15 ms)
    ✓ should logout (8 ms)
    ✕ should refresh expired token (12 ms)
FAIL tests/db.test.ts
  DB Service
    ✓ should connect (5 ms)
    ✕ should handle timeout (100 ms)

Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 3 passed, 5 total
Time:        2.345 s`;

      const obs = await kernel.pipeline.observe(testOutput, 'test', 'Bash');
      assert.ok(obs.summary, 'Test output should be summarized');
      assert.ok(obs.summary!.includes('Test Results'), 'Should have test results header');
      assert.ok(obs.summary!.includes('Passed: 3'), 'Should count passed');
      assert.ok(obs.summary!.includes('Failed: 2'), 'Should count failed');
    });

    it('Binary — non-printable chars detected', async () => {
      // Create a string with >10% non-printable characters
      const chars: string[] = [];
      for (let i = 0; i < 200; i++) {
        if (i % 3 === 0) {
          // Non-printable (control chars excluding tab/newline/CR)
          chars.push(String.fromCharCode(i % 8)); // 0-7 range
        } else {
          chars.push('A');
        }
      }
      const binaryContent = chars.join('');

      const obs = await kernel.pipeline.observe(binaryContent, 'context', 'Bash');
      assert.ok(obs.summary, 'Binary content should be summarized');
      assert.ok(obs.summary!.includes('binary') || obs.summary!.includes('sha256'), 'Should identify as binary');
    });
  });

  // =========================================================================
  // 4. Content Store
  // =========================================================================
  describe('4. Content Store — index, search, code chunks', () => {
    it('index a markdown document, search for heading, get code chunk', () => {
      const markdown = `# API Reference

This document describes the API.

## Authentication

Use Bearer tokens for authentication.

\`\`\`typescript
const token = await auth.getToken(user);
headers.set('Authorization', \`Bearer \${token}\`);
\`\`\`

## Endpoints

### GET /users

Returns a list of all users.

\`\`\`typescript
const users = await fetch('/api/users');
\`\`\`
`;

      const sourceId = kernel.contentStore.index(markdown, 'docs/api.md');
      assert.ok(sourceId > 0, 'Should return a positive source ID');

      // Search for "Authentication"
      const results = kernel.contentStore.search('Authentication');
      assert.ok(results.length >= 1, 'Should find authentication section');
      assert.ok(
        results.some(r => r.heading === 'Authentication' || (r.content && r.content.includes('Bearer'))),
        'Should find authentication content',
      );

      // Search for code-related content
      const codeResults = kernel.contentStore.search('getToken');
      assert.ok(codeResults.length >= 1, 'Should find code chunk with getToken');
      assert.ok(
        codeResults.some(r => r.has_code || r.content.includes('getToken')),
        'Should return the code chunk',
      );

      // Re-indexing same source is idempotent
      const sourceId2 = kernel.contentStore.index(markdown, 'docs/api.md');
      assert.equal(sourceId, sourceId2, 'Re-indexing same source should return same ID');
    });
  });

  // =========================================================================
  // 5. Levenshtein Search
  // =========================================================================
  describe('5. Levenshtein Search — typo tolerance', () => {
    it('find observations despite typos in query', async () => {
      await kernel.pipeline.observe(
        'The authentication service validates JWT tokens and manages user sessions.',
        'code', 'Read',
      );
      await kernel.pipeline.observe(
        'Database migration runner handles schema versioning and rollbacks.',
        'code', 'Read',
      );

      // Search with a typo: "authenication" instead of "authentication"
      const results = await kernel.search('authenication service');
      assert.ok(results.length >= 1, 'Levenshtein should find results despite typo');
      assert.ok(
        results[0].snippet.toLowerCase().includes('authentication') ||
        results[0].snippet.toLowerCase().includes('jwt'),
        'Should find the authentication observation',
      );
    });
  });

  // =========================================================================
  // 6. Knowledge Base
  // =========================================================================
  describe('6. Knowledge Base — save, search (FTS5 + scan), access, prune', () => {
    it('save and search via FTS5', () => {
      const entry = kernel.knowledgeBase.save({
        category: 'pattern',
        title: 'Repository Pattern',
        content: 'Use the repository pattern to abstract database access. This decouples business logic from storage implementation.',
        tags: ['architecture', 'database'],
      });

      assert.ok(entry.id, 'Should create knowledge entry');
      assert.equal(entry.category, 'pattern');

      const results = kernel.knowledgeBase.search('repository pattern database');
      assert.ok(results.length >= 1, 'FTS5 search should find the entry');
      assert.equal(results[0].title, 'Repository Pattern');
    });

    it('scan fallback for queries FTS5 misses', () => {
      kernel.knowledgeBase.save({
        category: 'api',
        title: 'Stripe Webhook Setup',
        content: 'Configure Stripe webhooks at /api/webhooks/stripe endpoint.',
        tags: ['stripe', 'payments'],
      });

      // Single short word that may not produce FTS5 results
      const results = kernel.knowledgeBase.search('stripe');
      assert.ok(results.length >= 1, 'Should find via FTS5 or scan fallback');
    });

    it('access increments access_count', () => {
      const entry = kernel.knowledgeBase.save({
        category: 'decision',
        title: 'Use Zustand for state',
        content: 'Decided to use Zustand over Redux for simpler boilerplate.',
        tags: ['state-management'],
      });

      // Access twice
      kernel.knowledgeBase.access(entry.id);
      kernel.knowledgeBase.access(entry.id);

      const accessed = kernel.knowledgeBase.access(entry.id);
      assert.ok(accessed, 'Should find the entry');
      // access_count starts at 0, incremented by search (1) + 3 accesses = might vary
      assert.ok(accessed!.access_count >= 2, 'Access count should be at least 2');
    });

    it('prune archives old low-relevance entries', () => {
      const storage = getStorage(kernel);
      const ninetyOneDaysAgo = Date.now() - (91 * 24 * 60 * 60 * 1000);

      // Insert an old entry with 0 access count directly
      storage.exec(
        'INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['old-entry-1', 'pattern', 'Old Pattern', 'This is very old and never accessed.', '[]', 1, 1.0, 0, ninetyOneDaysAgo, 0],
      );

      const pruned = kernel.knowledgeBase.prune();
      assert.ok(pruned >= 1, 'Should prune at least the old unused entry');

      // Verify it's archived
      const row = storage.prepare('SELECT archived FROM knowledge WHERE id = ?').get('old-entry-1') as { archived: number };
      assert.equal(row.archived, 1, 'Old entry should be archived');
    });
  });

  // =========================================================================
  // 7. Budget Manager
  // =========================================================================
  describe('7. Budget Manager — configure, status, throttle at 80%', () => {
    it('configure and check status', () => {
      kernel.budgetManager.configure({ session_limit: 1000, overflow_strategy: 'warn' });

      const config = kernel.budgetManager.getConfig();
      assert.equal(config.session_limit, 1000);
      assert.equal(config.overflow_strategy, 'warn');
    });

    it('throttled at 80% usage', async () => {
      // Set a very low budget limit
      kernel.budgetManager.configure({ session_limit: 100 });

      // Observe enough content to exceed 80% of the limit
      // Each observation records tokens_in to token_stats — we need to push usage above 80
      const storage = getStorage(kernel);
      const sessionId = kernel['session'].session_id;

      // Manually insert token usage to simulate reaching 80%
      storage.exec(
        'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'store', 85, 20, Date.now()],
      );

      const status = kernel.budgetManager.getStatus(sessionId);
      assert.ok(status.percentage >= 80, `Should be at or above 80%, got ${status.percentage}%`);
      assert.ok(status.throttled, 'Should be throttled at 80%');
      assert.ok(!status.blocked, 'Should not be blocked yet (< 100%)');
    });

    it('blocked at 100% usage with hard_stop strategy', async () => {
      kernel.budgetManager.configure({ session_limit: 100, overflow_strategy: 'hard_stop' });

      const storage = getStorage(kernel);
      const sessionId = kernel['session'].session_id;

      storage.exec(
        'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'store', 110, 20, Date.now()],
      );

      const status = kernel.budgetManager.getStatus(sessionId);
      assert.ok(status.percentage >= 100, `Should be at or above 100%, got ${status.percentage}%`);
      assert.ok(status.blocked, 'Should be blocked at 100% with hard_stop');

      // Verify warn strategy does NOT block at 100%
      kernel.budgetManager.configure({ session_limit: 100, overflow_strategy: 'warn' });
      const warnStatus = kernel.budgetManager.getStatus(sessionId);
      assert.ok(!warnStatus.blocked, 'warn strategy should not block at 100%');

      // Verify aggressive_truncation strategy does NOT block at 100%
      kernel.budgetManager.configure({ session_limit: 100, overflow_strategy: 'aggressive_truncation' });
      const aggStatus = kernel.budgetManager.getStatus(sessionId);
      assert.ok(!aggStatus.blocked, 'aggressive_truncation should not block at 100%');
    });
  });

  // =========================================================================
  // 8. Event Tracker
  // =========================================================================
  describe('8. Event Tracker — emit, query by priority, detect error-fix', () => {
    it('emit events at different priorities and query by priority', () => {
      const sessionId = kernel['session'].session_id;

      // Emit events of various types (priorities are assigned automatically)
      const taskEvent = kernel.eventTracker.emit(sessionId, 'task_start', { task: 'build' });
      const errorEvent = kernel.eventTracker.emit(sessionId, 'error', { message: 'ENOMEM' });
      const fileEvent = kernel.eventTracker.emit(sessionId, 'file_modify', { file: 'src/app.ts' });
      const searchEvent = kernel.eventTracker.emit(sessionId, 'search', { query: 'test' });

      assert.equal(taskEvent.priority, 1, 'task_start should be priority 1');
      assert.equal(errorEvent.priority, 1, 'error should be priority 1');
      assert.equal(fileEvent.priority, 2, 'file_modify should be priority 2');
      assert.equal(searchEvent.priority, 4, 'search should be priority 4');

      // Query only critical events (priority <= 1)
      const critical = kernel.eventTracker.query(sessionId, { priority: 1 });
      assert.ok(critical.length >= 2, 'Should find at least task_start and error');
      assert.ok(critical.every(e => e.priority <= 1), 'All results should be priority 1');

      // Query all events
      const all = kernel.eventTracker.query(sessionId);
      assert.ok(all.length >= 4, 'Should find all 4 events');
    });

    it('detect error-fix pattern', () => {
      const sessionId = kernel['session'].session_id;

      // Emit error followed by file_modify (simulating a fix)
      kernel.eventTracker.emit(sessionId, 'error', { message: 'TypeError: undefined is not a function' });
      kernel.eventTracker.emit(sessionId, 'file_modify', { file: 'src/handler.ts' });

      const fixes = kernel.eventTracker.detectErrorFix(sessionId);
      assert.ok(fixes.length >= 1, 'Should detect at least one error-fix pair');
      assert.equal(fixes[0].file, 'src/handler.ts', 'Fix should reference the modified file');
    });
  });

  // =========================================================================
  // 9. Session Manager
  // =========================================================================
  describe('9. Session Manager — save, restore, condensed mode', () => {
    it('save snapshot and restore it', async () => {
      // Observe some data first
      await kernel.pipeline.observe('Important decision: use PostgreSQL for primary storage', 'decision', 'Read');

      const sessionId = kernel['session'].session_id;
      const stats = await kernel.stats();

      kernel.sessionManager.saveSnapshot(sessionId, stats);

      const restored = kernel.sessionManager.restoreSnapshot(sessionId);
      assert.ok(restored, 'Should restore the snapshot');
      assert.equal(restored!.condensed, false, 'Recent snapshot should not be condensed');
      // Snapshot now uses category-based keys (15 categories with P1/P2/P3 priorities)
      // The decisions category should be present since we observed a decision
      assert.ok(restored!.snapshot.decisions, 'Snapshot should contain decisions category');
    });

    it('old snapshots are condensed', () => {
      const sessionId = 'old-session-test';
      const storage = getStorage(kernel);

      // Insert an old snapshot (8 days ago — beyond 7-day STALE_THRESHOLD)
      const twoDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
      const snapshotData = JSON.stringify({
        session_id: sessionId,
        stats: { observations: 10, tokens_saved: 500 },
        decisions: ['Use React Native'],
        errors: [],
        events: [],
        task: 'build mobile app',
      });

      storage.exec(
        'INSERT INTO snapshots (session_id, snapshot, created_at) VALUES (?, ?, ?)',
        [sessionId, snapshotData, twoDaysAgo],
      );

      const restored = kernel.sessionManager.restoreSnapshot(sessionId);
      assert.ok(restored, 'Should restore the old snapshot');
      assert.equal(restored!.condensed, true, 'Old snapshot should be condensed');
      assert.ok(restored!.snapshot.condensed, 'Snapshot should have condensed flag');
      assert.equal(restored!.snapshot.original_session, sessionId, 'Should reference original session');
    });
  });

  // =========================================================================
  // 10. MCP Tool Integration — call each handler directly
  // =========================================================================
  describe('10. MCP Tool Integration — all 9 new tool handlers', () => {
    it('handleObserve — stores and returns observation', async () => {
      const tk = buildToolKernel(kernel);
      const result = await handleObserve({ content: 'MCP tool observe test', type: 'context' }, tk);
      assert.ok(!('error' in result), 'Should not error');
      assert.ok((result as { id: string }).id, 'Should return an ID');
    });

    it('handleSummarize — summarizes markdown without storing', async () => {
      const tk = buildToolKernel(kernel);
      const md = '# Title\n\nSome content.\n\n## Section\n\nMore content.';
      const result = await handleSummarize({ content: md }, tk);
      assert.ok(!('error' in result), 'Should not error');
      assert.ok((result as { summary: string }).summary.includes('Title'), 'Should summarize markdown');
    });

    it('handleSearch — finds stored observations', async () => {
      const tk = buildToolKernel(kernel);
      await handleObserve({ content: 'Searching for integration test results in the pipeline module', type: 'context' }, tk);

      const results = await handleSearch({ query: 'integration test pipeline' }, tk);
      assert.ok(results.length >= 1, 'Should find the observation');
    });

    it('handleTimeline — returns observations in order', async () => {
      const tk = buildToolKernel(kernel);
      await handleObserve({ content: 'Timeline entry one for chronological ordering test', type: 'log' }, tk);
      await handleObserve({ content: 'Timeline entry two for chronological ordering test', type: 'log' }, tk);

      const timeline = await handleTimeline({ limit: 10 }, tk);
      assert.ok(timeline.length >= 2, 'Should return at least 2 entries');
      // Reverse chronological: first entry should be the newest
      if (timeline.length >= 2) {
        assert.ok(timeline[0].timestamp >= timeline[1].timestamp, 'Should be reverse-chronological');
      }
    });

    it('handleGet — retrieves stored observation by ID', async () => {
      const tk = buildToolKernel(kernel);
      const obs = await handleObserve({ content: 'Specific observation to retrieve by ID later', type: 'context' }, tk);
      const id = (obs as { id: string }).id;

      const detail = await handleGet({ id }, tk);
      assert.ok(!('error' in detail), 'Should not error');
      assert.ok((detail as { content: string }).content.includes('retrieve by ID'), 'Should return correct content');
    });

    it('handleStats — returns token economics', async () => {
      const tk = buildToolKernel(kernel);
      await handleObserve({ content: 'Stat tracking test observation for token economics', type: 'code' }, tk);

      const stats = await handleStats({} as Record<string, never>, tk);
      assert.ok(stats.session_id, 'Should return session_id');
      assert.ok(stats.observations_stored >= 1, 'Should count at least 1 observation');
    });

    it('handleIndexContent + handleSearchContent — content store tools', async () => {
      const tk = buildToolKernel(kernel);
      const indexResult = await handleIndexContent({
        content: '# API Docs\n\n## Users Endpoint\n\nReturns user data.\n\n## Posts Endpoint\n\nReturns post data.',
        source: 'api-docs.md',
      }, tk);

      assert.ok(!('error' in indexResult), 'Index should not error');
      assert.ok((indexResult as { source_id: number }).source_id > 0, 'Should return source_id');

      const searchResult = await handleSearchContent({ query: 'Users Endpoint' }, tk);
      assert.ok(searchResult.length >= 1, 'Should find the indexed content');
    });

    it('handleSaveKnowledge + handleSearchKnowledge — knowledge base tools', async () => {
      const tk = buildToolKernel(kernel);
      const saved = await handleSaveKnowledge({
        category: 'pattern',
        title: 'Singleton Pattern',
        content: 'Use singleton for database connection pools to avoid connection exhaustion.',
        tags: ['design-patterns', 'database'],
      }, tk);

      assert.ok(!('error' in saved), 'Save should not error');
      assert.ok((saved as { id: string }).id, 'Should return ID');

      const found = await handleSearchKnowledge({ query: 'singleton database connection' }, tk);
      assert.ok(!('error' in found), 'Search should not error');
      const results = found as Array<{ id: string; title: string }>;
      assert.ok(results.length >= 1, 'Should find the knowledge entry');
      assert.equal(results[0].title, 'Singleton Pattern');
    });

    it('handleBudgetStatus + handleBudgetConfigure — budget tools', async () => {
      const tk = buildToolKernel(kernel);

      const configResult = await handleBudgetConfigure({ session_limit: 50000, overflow_strategy: 'hard_stop' }, tk);
      assert.ok(!('error' in configResult), 'Configure should not error');
      assert.ok((configResult as { updated: boolean }).updated, 'Should confirm update');

      const status = await handleBudgetStatus({} as Record<string, never>, tk);
      assert.equal(status.limit, 50000, 'Limit should be updated');
      assert.equal(status.strategy, 'hard_stop', 'Strategy should be updated');
    });

    it('handleEmitEvent + handleQueryEvents — event tools', async () => {
      const tk = buildToolKernel(kernel);

      const emitted = await handleEmitEvent({ event_type: 'task_start', data: { task: 'deploy' }, agent: 'ci-bot' }, tk);
      assert.ok(emitted.id, 'Should return event ID');
      assert.equal(emitted.event_type, 'task_start');
      assert.equal(emitted.priority, 1);

      const events = await handleQueryEvents({ event_type: 'task_start' }, tk);
      assert.ok(events.length >= 1, 'Should find the emitted event');
      assert.equal(events[0].data.task, 'deploy');
    });

    it('handleRestoreSession — session tool', async () => {
      const tk = buildToolKernel(kernel);

      // First save a snapshot (observe something, then save)
      await handleObserve({ content: 'Session restore test data', type: 'context' }, tk);
      const stats = await handleStats({} as Record<string, never>, tk);
      kernel.sessionManager.saveSnapshot(tk.sessionId, stats);

      const restored = await handleRestoreSession({ session_id: tk.sessionId }, tk);
      assert.ok(!('error' in restored), 'Should not error');
      const content = (restored as { content: Array<{ type: string; text: string }> }).content;
      assert.ok(content, 'Should return content array');
      assert.ok(content[0].text.includes('Session Restored'), 'Should contain session restored header');
    });
  });
});
