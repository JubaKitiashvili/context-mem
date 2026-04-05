import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { GlobalKnowledgeStore } from '../../core/global-store.js';
import { Dreamer } from '../../core/dreamer.js';
import { createTestDb } from '../helpers.js';

describe('auto-promote execution', () => {
  it('promotes candidates to global store and marks auto_promoted', async () => {
    const storage = await createTestDb();
    const kb = new KnowledgeBase(storage);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-global-'));
    const globalDbPath = path.join(tmpDir, 'global.db');
    const globalStore = new GlobalKnowledgeStore(undefined, globalDbPath);
    globalStore.open();
    const dreamer = new Dreamer(kb, storage, { cycleMs: 60_000 });

    // Save a shareable entry
    const entry = await kb.save({
      category: 'pattern',
      title: 'Error boundary pattern',
      content: 'Wrap React components in error boundaries for resilience',
      tags: ['react', 'error-handling'],
      shareable: true,
      source_type: 'explicit',
    });

    // Simulate 3 session accesses
    for (let i = 1; i <= 3; i++) {
      storage.exec(
        'INSERT INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
        [entry.id, `sess-${i}`, Date.now() - (3 - i) * 10000]
      );
    }

    // Run promotion scan
    const candidates = await dreamer.promotionScan();
    assert.ok(candidates.length >= 1, 'should find at least 1 candidate');

    // Execute promotion
    for (const candidate of candidates) {
      const localEntry = kb.getById(candidate.id);
      if (localEntry && localEntry.shareable) {
        globalStore.promote(localEntry, 'test-project');
        storage.exec('UPDATE knowledge SET auto_promoted = 1 WHERE id = ?', [candidate.id]);
      }
    }

    // Verify in global store
    const globalResults = globalStore.search('error boundary');
    assert.ok(globalResults.length >= 1, 'should be in global store');
    assert.equal(globalResults[0].source_project, 'test-project');

    // Verify auto_promoted flag
    const flagged = storage.prepare('SELECT auto_promoted FROM knowledge WHERE id = ?').get(entry.id) as { auto_promoted: number };
    assert.equal(flagged.auto_promoted, 1);

    // Verify second scan skips
    const secondScan = await dreamer.promotionScan();
    assert.ok(!secondScan.some(c => c.id === entry.id), 'should not appear in second scan');

    dreamer.stop();
    globalStore.close();
    await storage.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
