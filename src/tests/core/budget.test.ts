import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetManager } from '../../core/budget.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('BudgetManager', () => {
  let storage: BetterSqlite3Storage;
  let budget: BudgetManager;

  beforeEach(async () => {
    storage = await createTestDb();
    budget = new BudgetManager(storage);
  });

  afterEach(async () => { await storage.close(); });

  // --- getConfig defaults ---

  it('returns sensible default config when nothing is configured', () => {
    const config = budget.getConfig();
    assert.ok(config.session_limit > 0);
    assert.ok(['warn', 'aggressive_truncation', 'hard_stop'].includes(config.overflow_strategy));
  });

  // --- configure ---

  it('configure persists session_limit', () => {
    budget.configure({ session_limit: 50_000 });
    const config = budget.getConfig();
    assert.equal(config.session_limit, 50_000);
  });

  it('configure persists overflow_strategy warn', () => {
    budget.configure({ overflow_strategy: 'warn' });
    assert.equal(budget.getConfig().overflow_strategy, 'warn');
  });

  it('configure persists overflow_strategy aggressive_truncation', () => {
    budget.configure({ overflow_strategy: 'aggressive_truncation' });
    assert.equal(budget.getConfig().overflow_strategy, 'aggressive_truncation');
  });

  it('configure persists overflow_strategy hard_stop', () => {
    budget.configure({ overflow_strategy: 'hard_stop' });
    assert.equal(budget.getConfig().overflow_strategy, 'hard_stop');
  });

  it('configure persists agent_limits', () => {
    budget.configure({ agent_limits: { agentA: 10_000, agentB: 20_000 } });
    const config = budget.getConfig();
    assert.deepEqual(config.agent_limits, { agentA: 10_000, agentB: 20_000 });
  });

  it('configure merges partial updates without overwriting unset fields', () => {
    budget.configure({ session_limit: 75_000 });
    budget.configure({ overflow_strategy: 'hard_stop' });
    const config = budget.getConfig();
    assert.equal(config.session_limit, 75_000);
    assert.equal(config.overflow_strategy, 'hard_stop');
  });

  // --- check / getStatus (zero usage) ---

  it('check returns used=0 when no tokens recorded', () => {
    const status = budget.check('session-new');
    assert.equal(status.used, 0);
    assert.ok(status.limit > 0);
    assert.equal(status.percentage, 0);
    assert.equal(status.throttled, false);
    assert.equal(status.blocked, false);
  });

  it('getStatus delegates to check', () => {
    const a = budget.check('s1');
    const b = budget.getStatus('s1');
    assert.deepEqual(a, b);
  });

  // --- check with tokens recorded ---

  it('check reflects recorded token usage', () => {
    budget.configure({ session_limit: 10_000 });
    // Inject token_stats directly (5000 tokens)
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 5000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.equal(status.used, 5000);
    assert.equal(status.percentage, 50);
    assert.equal(status.throttled, false);
  });

  it('check sets throttled=true at 80% usage', () => {
    budget.configure({ session_limit: 10_000 });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 8000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.equal(status.throttled, true);
  });

  it('check emits WARNING signal at 80% for warn strategy', () => {
    budget.configure({ session_limit: 10_000, overflow_strategy: 'warn' });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 8500, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.ok(status.signal?.includes('WARNING'));
  });

  it('check emits CRITICAL signal at 90% usage', () => {
    budget.configure({ session_limit: 10_000 });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 9000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.ok(status.signal?.includes('CRITICAL'));
  });

  it('check emits context-used signal at 60%', () => {
    budget.configure({ session_limit: 10_000 });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 6000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.ok(status.signal?.includes('60%'));
  });

  it('check blocked=false for warn strategy at 100%', () => {
    budget.configure({ session_limit: 10_000, overflow_strategy: 'warn' });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 10000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.equal(status.blocked, false);
  });

  it('check blocked=false for aggressive_truncation strategy at 100%', () => {
    budget.configure({ session_limit: 10_000, overflow_strategy: 'aggressive_truncation' });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 10000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.equal(status.blocked, false);
  });

  it('check blocked=true for hard_stop strategy at 100%', () => {
    budget.configure({ session_limit: 10_000, overflow_strategy: 'hard_stop' });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess', 'tool:Read', 10000, 0, Date.now()]
    );
    const status = budget.check('sess');
    assert.equal(status.blocked, true);
  });

  it('check is per-session (sessions do not share usage)', () => {
    budget.configure({ session_limit: 10_000 });
    storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      ['sess-a', 'tool:Read', 9000, 0, Date.now()]
    );
    const statusB = budget.check('sess-b');
    assert.equal(statusB.used, 0);
  });

  // --- estimateToolTokens ---

  it('estimates Read tool: inputBytes / 4', () => {
    assert.equal(budget.estimateToolTokens('Read', 4000, 0), 1000);
  });

  it('estimates Write tool: inputBytes / 4', () => {
    assert.equal(budget.estimateToolTokens('Write', 800, 0), 200);
  });

  it('estimates WebFetch tool: inputBytes / 4', () => {
    assert.equal(budget.estimateToolTokens('WebFetch', 2000, 0), 500);
  });

  it('estimates Edit tool: (inputBytes + outputBytes) / 4', () => {
    assert.equal(budget.estimateToolTokens('Edit', 400, 600), 250);
  });

  it('estimates Bash tool: (inputBytes + outputBytes) / 4', () => {
    assert.equal(budget.estimateToolTokens('Bash', 100, 2000), 525);
  });

  it('estimates Grep tool: (inputBytes + outputBytes) / 4', () => {
    assert.equal(budget.estimateToolTokens('Grep', 200, 600), 200);
  });

  it('estimates Glob tool: (inputBytes + outputBytes) / 4', () => {
    assert.equal(budget.estimateToolTokens('Glob', 400, 400), 200);
  });

  it('estimates WebSearch tool: (inputBytes + outputBytes) / 4', () => {
    assert.equal(budget.estimateToolTokens('WebSearch', 200, 800), 250);
  });

  it('estimates Agent tool: inputBytes / 4 (ignores outputBytes)', () => {
    assert.equal(budget.estimateToolTokens('Agent', 2000, 5000), 500);
  });

  it('estimates unknown tool: (inputBytes + outputBytes) / 4', () => {
    assert.equal(budget.estimateToolTokens('Unknown', 200, 200), 100);
  });

  it('uses ceiling for fractional token estimates', () => {
    // 7 bytes / 4 = 1.75 → ceil to 2
    assert.equal(budget.estimateToolTokens('Read', 7, 0), 2);
  });

  // --- recordToolUsage ---

  it('recordToolUsage inserts a token_stats row', () => {
    budget.recordToolUsage('sess-x', 'Read', 4000, 0);
    const row = storage.prepare(
      'SELECT SUM(tokens_in) AS total FROM token_stats WHERE session_id = ?'
    ).get('sess-x') as { total: number };
    assert.equal(row.total, 1000);
  });

  it('recordToolUsage accumulates multiple calls', () => {
    budget.recordToolUsage('sess-x', 'Read', 4000, 0); // 1000 tokens
    budget.recordToolUsage('sess-x', 'Bash', 400, 400); // 200 tokens
    const row = storage.prepare(
      'SELECT SUM(tokens_in) AS total FROM token_stats WHERE session_id = ?'
    ).get('sess-x') as { total: number };
    assert.equal(row.total, 1200);
  });

  // --- getTokenEstimate ---

  it('getTokenEstimate returns used=0 for unknown session', () => {
    const est = budget.getTokenEstimate('no-such-session');
    assert.equal(est.used, 0);
    assert.equal(est.limit, 1_000_000);
    assert.equal(est.percentage, 0);
  });

  it('getTokenEstimate reflects recorded usage', () => {
    budget.recordToolUsage('sess-y', 'Read', 4000, 0);
    const est = budget.getTokenEstimate('sess-y');
    assert.equal(est.used, 1000);
    assert.equal(est.limit, 1_000_000);
    assert.ok(est.percentage >= 0);
  });

  // --- compacted flag ---

  it('wasCompacted returns false by default', () => {
    assert.equal(budget.wasCompacted('session-new'), false);
  });

  it('markCompacted sets the flag', () => {
    budget.markCompacted('sess-z');
    assert.equal(budget.wasCompacted('sess-z'), true);
  });

  it('clearCompacted removes the flag', () => {
    budget.markCompacted('sess-z');
    budget.clearCompacted('sess-z');
    assert.equal(budget.wasCompacted('sess-z'), false);
  });

  it('compacted flag is per-session', () => {
    budget.markCompacted('sess-a');
    assert.equal(budget.wasCompacted('sess-b'), false);
  });
});
