import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../../core/pipeline.js';
import { PluginRegistry } from '../../core/plugin-registry.js';
import { PrivacyEngine } from '../../plugins/privacy/privacy-engine.js';
import type { SummarizerPlugin, SummaryResult, SummarizeOpts, PluginConfig } from '../../core/types.js';
import { createTestDb } from '../helpers.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';

function makePrivacy(opts: { strip_tags?: boolean; redact_patterns?: string[] } = {}): PrivacyEngine {
  return new PrivacyEngine({
    strip_tags: opts.strip_tags ?? true,
    redact_patterns: opts.redact_patterns ?? [],
  });
}

function makeMockSummarizer(name: string, detectFn: (c: string) => boolean, summaryText: string): SummarizerPlugin {
  return {
    name,
    version: '1.0.0',
    type: 'summarizer',
    contentTypes: ['text'],
    init: async (_config: PluginConfig) => {},
    destroy: async () => {},
    detect: detectFn,
    summarize: async (_content: string, _opts: SummarizeOpts): Promise<SummaryResult> => ({
      summary: summaryText,
      tokens_original: 100,
      tokens_summarized: 10,
      savings_pct: 90,
      content_type: 'text',
    }),
  };
}

describe('Pipeline', () => {
  describe('observe stores observation in database', () => {
    let storage: BetterSqlite3Storage;
    let pipeline: Pipeline;

    before(async () => {
      storage = await createTestDb();
      const registry = new PluginRegistry();
      const privacy = makePrivacy();
      pipeline = new Pipeline(registry, storage, privacy, 'session-1');
    });

    after(async () => { await storage.close(); });

    it('stores observation row in observations table', async () => {
      const obs = await pipeline.observe('hello world', 'context', 'test-source');
      const row = storage.prepare('SELECT * FROM observations WHERE id = ?').get(obs.id) as Record<string, unknown> | undefined;
      assert.ok(row, 'row should exist');
      assert.equal(row.content, 'hello world');
      assert.equal(row.type, 'context');
    });
  });

  describe('observe uses matching summarizer', () => {
    let storage: BetterSqlite3Storage;
    let pipeline: Pipeline;

    before(async () => {
      storage = await createTestDb();
      const registry = new PluginRegistry();
      const summarizer = makeMockSummarizer('mock-summarizer', (c) => c.includes('TRIGGER'), 'summarized result');
      await registry.register(summarizer);
      const privacy = makePrivacy();
      pipeline = new Pipeline(registry, storage, privacy, 'session-2');
    });

    after(async () => { await storage.close(); });

    it('stores the summary when summarizer detects content', async () => {
      const obs = await pipeline.observe('TRIGGER some content here', 'context', 'test');
      assert.equal(obs.summary, 'summarized result');
      const row = storage.prepare('SELECT summary FROM observations WHERE id = ?').get(obs.id) as Record<string, unknown> | undefined;
      assert.equal(row?.summary, 'summarized result');
    });
  });

  describe('observe without matching summarizer stores raw', () => {
    let storage: BetterSqlite3Storage;
    let pipeline: Pipeline;

    before(async () => {
      storage = await createTestDb();
      const registry = new PluginRegistry();
      // Summarizer that never detects
      const summarizer = makeMockSummarizer('non-matching', () => false, 'should not appear');
      await registry.register(summarizer);
      const privacy = makePrivacy();
      pipeline = new Pipeline(registry, storage, privacy, 'session-3');
    });

    after(async () => { await storage.close(); });

    it('stores observation without summary when no summarizer matches', async () => {
      const content = 'plain content no summarizer matches';
      const obs = await pipeline.observe(content, 'log', 'test');
      assert.equal(obs.summary, undefined);
      const row = storage.prepare('SELECT content, summary FROM observations WHERE id = ?').get(obs.id) as Record<string, unknown> | undefined;
      assert.equal(row?.content, content);
      assert.equal(row?.summary, null);
    });
  });

  describe('observe with privacy stripping', () => {
    let storage: BetterSqlite3Storage;
    let pipeline: Pipeline;

    before(async () => {
      storage = await createTestDb();
      const registry = new PluginRegistry();
      const privacy = makePrivacy({ strip_tags: true });
      pipeline = new Pipeline(registry, storage, privacy, 'session-4');
    });

    after(async () => { await storage.close(); });

    it('strips private tags and sets privacy_level to private', async () => {
      const content = 'public part <private>secret stuff</private> more public';
      const obs = await pipeline.observe(content, 'context', 'test');
      assert.ok(!obs.content.includes('<private>'), 'private tags should be stripped');
      assert.ok(!obs.content.includes('secret stuff'), 'private content should be removed');
      assert.equal(obs.metadata.privacy_level, 'private');
      const row = storage.prepare('SELECT privacy_level, content FROM observations WHERE id = ?').get(obs.id) as Record<string, unknown> | undefined;
      assert.equal(row?.privacy_level, 'private');
    });
  });

  describe('observe tracks token economics', () => {
    let storage: BetterSqlite3Storage;
    let pipeline: Pipeline;

    before(async () => {
      storage = await createTestDb();
      const registry = new PluginRegistry();
      const privacy = makePrivacy();
      pipeline = new Pipeline(registry, storage, privacy, 'session-5');
    });

    after(async () => { await storage.close(); });

    it('creates a store entry in token_stats after observe', async () => {
      await pipeline.observe('track tokens for this', 'context', 'test');
      const rows = storage.prepare("SELECT * FROM token_stats WHERE session_id = ? AND event_type = 'store'").all('session-5') as unknown[];
      assert.ok(rows.length > 0, 'token_stats should have a store entry');
    });
  });
});
