import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assembleWakeUp } from '../../core/wake-up.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { createTestDb } from '../helpers.js';

describe('Wake-Up Primer', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);

    // Seed project profile
    storage.exec('UPDATE project_profile SET content = ? WHERE id = 1', ['A TypeScript MCP server for AI context management.']);

    // Seed knowledge entries with varied importance
    await kb.save({ category: 'decision', title: 'Use PostgreSQL', content: 'We chose PostgreSQL for better JSON support and reliability', tags: ['database'], source_type: 'explicit' });
    await kb.save({ category: 'pattern', title: 'Always use strict mode', content: 'Enable TypeScript strict mode in all projects for safety', tags: ['typescript'], source_type: 'explicit' });
    await kb.save({ category: 'api', title: 'REST endpoint /api/v1/users', content: 'GET returns user list, POST creates user', tags: ['api'], source_type: 'observed' });

    // Set valid_from on knowledge entries
    storage.exec('UPDATE knowledge SET valid_from = ?', [Date.now()]);
  });

  after(async () => { await storage.close(); });

  it('returns all 4 layers', () => {
    const payload = assembleWakeUp(storage);
    assert.ok('l0_profile' in payload);
    assert.ok('l1_critical' in payload);
    assert.ok('l2_recent' in payload);
    assert.ok('l3_entities' in payload);
    assert.ok('total_tokens' in payload);
  });

  it('L0 reads project profile', () => {
    const payload = assembleWakeUp(storage);
    assert.ok(payload.l0_profile.includes('TypeScript MCP server'), 'L0 should contain project profile');
  });

  it('L1 ranks knowledge entries by combined score', () => {
    const payload = assembleWakeUp(storage);
    assert.ok(payload.l1_critical.length > 0, 'L1 should have content');
    // Should contain at least one knowledge entry title
    assert.ok(
      payload.l1_critical.includes('PostgreSQL') || payload.l1_critical.includes('strict mode') || payload.l1_critical.includes('REST'),
      'L1 should include knowledge entry content',
    );
  });

  it('L1 respects token budget', () => {
    const payload = assembleWakeUp(storage, { total_budget_tokens: 100 });
    // With 100 total tokens, L1 gets ~40 tokens — should be short
    assert.ok(payload.total_tokens <= 150, `total should be under budget, got ${payload.total_tokens}`);
  });

  it('total payload is within budget', () => {
    const payload = assembleWakeUp(storage, { total_budget_tokens: 700 });
    assert.ok(payload.total_tokens <= 750, `should be near budget, got ${payload.total_tokens}`);
  });

  it('empty DB returns minimal payload', async () => {
    const emptyStorage = await createTestDb();
    const payload = assembleWakeUp(emptyStorage);
    assert.equal(payload.l0_profile, '');
    assert.equal(payload.l1_critical, '');
    assert.ok(payload.total_tokens <= 10);
    await emptyStorage.close();
  });

  it('high-importance entries appear in L1', async () => {
    // Boost one entry's relevance score
    const entry = await kb.save({
      category: 'decision',
      title: 'Critical security decision',
      content: 'All endpoints must use authentication tokens',
      tags: ['security'],
      source_type: 'explicit',
    });
    storage.exec('UPDATE knowledge SET relevance_score = 2.0, access_count = 50, valid_from = ? WHERE id = ?', [Date.now(), entry.id]);

    const payload = assembleWakeUp(storage);
    assert.ok(payload.l1_critical.includes('security') || payload.l1_critical.includes('authentication'),
      'high-importance entry should appear in L1');
  });

  it('uses custom token budget', () => {
    const small = assembleWakeUp(storage, { total_budget_tokens: 50 });
    const large = assembleWakeUp(storage, { total_budget_tokens: 2000 });
    assert.ok(large.total_tokens >= small.total_tokens, 'larger budget should produce more content');
  });
});
