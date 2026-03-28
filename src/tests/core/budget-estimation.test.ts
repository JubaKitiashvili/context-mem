import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BudgetManager } from '../../core/budget.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('BudgetManager — token estimation', () => {
  let storage: BetterSqlite3Storage;
  let budget: BudgetManager;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'budget-test-'));
    storage = new BetterSqlite3Storage();
    await storage.open(join(tmpDir, 'test.db'));
    budget = new BudgetManager(storage);
  });

  afterEach(async () => {
    await storage.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('estimates tokens for Read tool', () => {
    const tokens = budget.estimateToolTokens('Read', 4000, 0);
    expect(tokens).toBe(1000);
  });

  it('estimates tokens for Edit tool (old + new)', () => {
    const tokens = budget.estimateToolTokens('Edit', 400, 600);
    expect(tokens).toBe(250);
  });

  it('estimates tokens for Bash tool', () => {
    const tokens = budget.estimateToolTokens('Bash', 100, 2000);
    expect(tokens).toBe(525);
  });

  it('estimates tokens for Agent tool (input only)', () => {
    const tokens = budget.estimateToolTokens('Agent', 2000, 5000);
    expect(tokens).toBe(500);
  });

  it('records tool usage and tracks cumulative estimate', () => {
    budget.recordToolUsage('test-session', 'Read', 8000, 0);
    budget.recordToolUsage('test-session', 'Edit', 200, 300);
    const estimate = budget.getTokenEstimate('test-session');
    expect(estimate.used).toBeGreaterThan(0);
    expect(estimate.limit).toBe(1_000_000);
    expect(estimate.percentage).toBeGreaterThanOrEqual(0);
  });

  it('detects compaction flag', () => {
    expect(budget.wasCompacted('test-session')).toBe(false);
    budget.markCompacted('test-session');
    expect(budget.wasCompacted('test-session')).toBe(true);
    budget.clearCompacted('test-session');
    expect(budget.wasCompacted('test-session')).toBe(false);
  });
});
