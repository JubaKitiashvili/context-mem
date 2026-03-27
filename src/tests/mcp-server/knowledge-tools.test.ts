/**
 * Tests for handleUpdateProfile and handleSaveKnowledge contradiction flow.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../../core/pipeline.js';
import { PluginRegistry } from '../../core/plugin-registry.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { SearchFusion } from '../../plugins/search/fusion.js';
import { BM25Search } from '../../plugins/search/bm25.js';
import { DEFAULT_CONFIG } from '../../core/types.js';
import { handleSaveKnowledge, handleUpdateProfile } from '../../mcp-server/tools.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import type { ContradictionWarning } from '../../core/types.js';
import { createTestDb } from '../helpers.js';

async function buildKernel(storage: BetterSqlite3Storage, sessionId: string): Promise<ToolKernel> {
  const registry = new PluginRegistry();
  const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
  const pipeline = new Pipeline(registry, storage, privacy, sessionId);
  const bm25 = new BM25Search(storage);
  await registry.register(bm25);
  const search = new SearchFusion([bm25]);
  const config = structuredClone(DEFAULT_CONFIG);

  const { BudgetManager } = await import('../../core/budget.js');
  const { EventTracker } = await import('../../core/events.js');
  const { SessionManager } = await import('../../core/session.js');
  const { ContentStore } = await import('../../plugins/storage/content-store.js');
  const { KnowledgeBase } = await import('../../plugins/knowledge/knowledge-base.js');
  const budgetManager = new BudgetManager(storage);
  const eventTracker = new EventTracker(storage);
  const sessionManager = new SessionManager(storage, eventTracker);
  const contentStore = new ContentStore(storage);
  const knowledgeBase = new KnowledgeBase(storage);

  return { pipeline, search, storage, registry, sessionId, config, budgetManager, eventTracker, sessionManager, contentStore, knowledgeBase };
}

// ---------------------------------------------------------------------------
// handleUpdateProfile tests
// ---------------------------------------------------------------------------

describe('handleUpdateProfile', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'profile-test-session');
  });

  after(async () => { await storage.close(); });

  it('returns auto-generated profile when no content provided', async () => {
    const result = await handleUpdateProfile({}, kernel);
    assert.ok('profile' in result, 'should return a profile field');
    assert.ok('source' in result, 'should return a source field');
    // With no knowledge entries, source should indicate empty or auto-generated
    assert.ok(
      result.source === 'auto-generated' || result.source.includes('empty') || result.source.includes('no knowledge'),
      `source should indicate auto-generated or empty, got "${result.source}"`,
    );
  });

  it('saves manual profile content', async () => {
    const content = 'This project uses React with TypeScript and PostgreSQL.';
    const result = await handleUpdateProfile({ content }, kernel);
    assert.equal(result.profile, content, 'profile should match provided content');
    assert.equal(result.source, 'manual', 'source should be manual');
  });

  it('returns existing profile on subsequent call', async () => {
    const content = 'Updated project profile with new tech stack info.';
    // Save a profile first
    await handleUpdateProfile({ content }, kernel);

    // Call again with empty params — should return existing or auto-generated
    const result = await handleUpdateProfile({}, kernel);
    assert.ok(result.profile.length > 0, 'profile should not be empty after a save');
  });
});

// ---------------------------------------------------------------------------
// handleSaveKnowledge contradiction tests
// ---------------------------------------------------------------------------

describe('handleSaveKnowledge — contradiction flow', () => {
  let storage: BetterSqlite3Storage;
  let kernel: ToolKernel;

  before(async () => {
    storage = await createTestDb();
    kernel = await buildKernel(storage, 'contradiction-test-session');
  });

  after(async () => { await storage.close(); });

  it('detects contradiction with existing entry', async () => {
    // Save the first entry
    const first = await handleSaveKnowledge({
      category: 'decision',
      title: 'Frontend framework choice',
      content: 'Use React for frontend development',
      tags: ['frontend'],
    }, kernel);
    assert.ok('id' in first, 'first save should succeed');

    // Save a contradicting entry with overlapping title
    const second = await handleSaveKnowledge({
      category: 'decision',
      title: 'Frontend framework choice',
      content: 'Use Vue for frontend development',
      tags: ['frontend'],
    }, kernel);

    assert.ok('blocked' in second, 'second save should be blocked due to contradiction');
    const blocked = second as { blocked: boolean; contradictions: ContradictionWarning[]; message: string };
    assert.equal(blocked.blocked, true, 'blocked should be true');
    assert.ok(blocked.contradictions.length > 0, 'should have at least one contradiction warning');
    assert.ok(blocked.message.includes('force'), 'message should mention force option');
  });

  it('allows force save despite contradiction', async () => {
    // The first entry from the previous test is still in the DB.
    // Force-save a contradicting entry.
    const forced = await handleSaveKnowledge({
      category: 'decision',
      title: 'Frontend framework choice',
      content: 'Use Svelte for frontend development',
      tags: ['frontend'],
      force: true,
    }, kernel);

    assert.ok('id' in forced, 'forced save should succeed and return an id');
    const saved = forced as { id: string; category: string; title: string; source_type: string; contradictions: ContradictionWarning[] };
    assert.ok(saved.id, 'should have a non-empty id');
    assert.equal(saved.category, 'decision');
    assert.ok(saved.contradictions.length > 0, 'should still report contradictions even when forced');
  });

  it('no contradiction for unrelated entries', async () => {
    // Save an entry about infrastructure — unrelated to frontend framework
    const result = await handleSaveKnowledge({
      category: 'decision',
      title: 'Cloud provider selection',
      content: 'Deploy to AWS using ECS for container orchestration',
      tags: ['infrastructure', 'aws'],
    }, kernel);

    assert.ok('id' in result, 'unrelated save should succeed without being blocked');
    assert.ok(!('blocked' in result), 'should not be blocked');
    const saved = result as { id: string; contradictions: ContradictionWarning[] };
    assert.equal(saved.contradictions.length, 0, 'should have no contradiction warnings');
  });
});
