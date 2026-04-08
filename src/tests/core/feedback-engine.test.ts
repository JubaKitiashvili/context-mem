import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackEngine } from '../../core/feedback-engine.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';

describe('Feedback Engine', () => {
  let storage: BetterSqlite3Storage;
  let engine: FeedbackEngine;

  before(async () => {
    storage = await createTestDb();
    engine = new FeedbackEngine(storage);

    // Seed observations with file paths in metadata
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['obs-file-1', 'code', 'Pipeline code', JSON.stringify({ source: 'test', tokens_original: 10, tokens_summarized: 5, privacy_level: 'public', file_path: 'src/core/pipeline.ts' }), Date.now()],
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['obs-file-2', 'error', 'Auth error', JSON.stringify({ source: 'test', tokens_original: 10, tokens_summarized: 5, privacy_level: 'public', file_path: 'src/auth/login.ts', files_modified: ['src/auth/token.ts'] }), Date.now()],
    );
    storage.exec(
      `INSERT INTO observations (id, type, content, metadata, indexed_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['obs-no-file', 'context', 'General note', JSON.stringify({ source: 'test', tokens_original: 10, tokens_summarized: 5, privacy_level: 'public' }), Date.now()],
    );
  });

  after(async () => { await storage.close(); });

  it('trackSearchResults records result IDs', () => {
    engine.trackSearchResults(['obs-file-1', 'obs-file-2']);
    assert.equal(engine.getTrackedCount(), 2);
  });

  it('checkUsefulness marks relevant result when file_modify matches', () => {
    // Modify pipeline.ts — should match obs-file-1
    engine.checkUsefulness({ file: 'src/core/pipeline.ts' });
    assert.equal(engine.getUsefulCount(), 1);
  });

  it('checkUsefulness does not mark unrelated file_modify', () => {
    // Modify an unrelated file — should not increase useful count
    engine.checkUsefulness({ file: 'src/unrelated/module.ts' });
    assert.equal(engine.getUsefulCount(), 1); // still 1 from previous test
  });

  it('checkUsefulness matches files_modified from metadata too', () => {
    // Modify token.ts — should match obs-file-2's files_modified
    engine.checkUsefulness({ file: 'src/auth/token.ts' });
    assert.equal(engine.getUsefulCount(), 2);
  });

  it('flushFeedback updates last_useful_at', () => {
    const result = engine.flushFeedback();
    assert.ok(result.updated_observations >= 1, 'should update at least 1 observation');

    // Verify the column was set
    const row = storage.prepare('SELECT last_useful_at FROM observations WHERE id = ?').get('obs-file-1') as { last_useful_at: number | null };
    assert.ok(row.last_useful_at !== null, 'last_useful_at should be set after flush');
  });

  it('flush clears tracking state', () => {
    assert.equal(engine.getTrackedCount(), 0, 'tracked should be cleared');
    assert.equal(engine.getUsefulCount(), 0, 'useful should be cleared');
  });
});
