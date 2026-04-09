/**
 * Tests for Total Recall CLI commands: why, story, import-convos
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';
import { buildTrail } from '../../core/decision-trail.js';
import { generateNarrative } from '../../core/narrative-generator.js';
import { importConversations } from '../../core/conversation-import.js';
import { Pipeline } from '../../core/pipeline.js';
import { PluginRegistry } from '../../core/plugin-registry.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';

describe('CLI: why command (decision trail)', () => {
  let storage: BetterSqlite3Storage;

  before(async () => {
    storage = await createTestDb();
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier, session_id)
       VALUES ('dec-cli', 'decision', 'We decided to use Redis for caching', 'Use Redis', '{"significance_flags":["DECISION"]}', ${Date.now()}, 0.9, 1, 'verbatim', 's1')`
    );
  });

  after(async () => { await storage.close(); });

  it('buildTrail finds decision by keyword', () => {
    const trail = buildTrail(storage, 'Redis');
    assert.ok(trail, 'should find trail for Redis');
    assert.ok(trail!.decision.includes('Redis'));
  });

  it('buildTrail returns null for unknown query', () => {
    const trail = buildTrail(storage, 'nonexistent_xyz_999');
    assert.equal(trail, null);
  });
});

describe('CLI: story command (narrative generation)', () => {
  let storage: BetterSqlite3Storage;

  before(async () => {
    storage = await createTestDb();
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier)
       VALUES ('narr-cli', 'decision', 'Switch to httpOnly cookies', 'httpOnly cookies', '{}', ${Date.now()}, 0.9, 1, 'verbatim')`
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier)
       VALUES ('code-cli', 'code', 'Updated auth middleware', 'Auth update', '{}', ${Date.now()}, 0.5, 0, 'verbatim')`
    );
  });

  after(async () => { await storage.close(); });

  it('generates PR format', () => {
    const text = generateNarrative(storage, { format: 'pr' });
    assert.ok(text.includes('## Summary'));
    assert.ok(text.includes('## Test Plan'));
  });

  it('generates standup format', () => {
    const text = generateNarrative(storage, { format: 'standup' });
    assert.ok(text.includes('**Done:**'));
  });

  it('generates ADR format', () => {
    const text = generateNarrative(storage, { format: 'adr' });
    assert.ok(text.includes('## Decision'));
  });

  it('generates onboarding format', () => {
    const text = generateNarrative(storage, { format: 'onboarding' });
    assert.ok(text.includes('# Project Overview'));
  });
});

describe('CLI: import-convos command (conversation import)', () => {
  let storage: BetterSqlite3Storage;
  let pipeline: Pipeline;

  before(async () => {
    storage = await createTestDb();
    const registry = new PluginRegistry();
    const privacy = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    pipeline = new Pipeline(registry, storage, privacy, 'import-session');
  });

  after(async () => { await storage.close(); });

  it('imports Claude Code JSONL format', async () => {
    const content = '{"role":"user","content":"What is TypeScript?"}\n{"role":"assistant","content":"TypeScript is a typed JavaScript."}';
    const result = await importConversations(content, pipeline, { format: 'claude-code' });
    assert.equal(result.format, 'claude-code');
    assert.ok(result.imported >= 1, 'should import at least 1 exchange');
  });

  it('imports plaintext format', async () => {
    const content = 'Human: Hello world\n\nAssistant: Hi there, how can I help?';
    const result = await importConversations(content, pipeline, { format: 'plaintext' });
    assert.equal(result.format, 'plaintext');
    assert.ok(result.imported >= 1);
  });

  it('handles empty content gracefully', async () => {
    const result = await importConversations('', pipeline);
    assert.ok(result.errors.length > 0 || result.imported === 0);
  });

  it('deduplicates re-imported content via SHA256 hash', async () => {
    const content = '{"role":"user","content":"Unique dedup test message xyz"}\n{"role":"assistant","content":"Response to dedup test"}';
    const first = await importConversations(content, pipeline, { format: 'claude-code' });
    assert.ok(first.imported >= 1);
    // Pipeline dedup returns existing observation silently (no error, no new row)
    // Verify no new rows were created by checking observation count
    const countBefore = (storage.prepare('SELECT COUNT(*) as c FROM observations').get() as { c: number }).c;
    await importConversations(content, pipeline, { format: 'claude-code' });
    const countAfter = (storage.prepare('SELECT COUNT(*) as c FROM observations').get() as { c: number }).c;
    assert.equal(countAfter, countBefore, 'no new observations should be created on re-import');
  });
});
