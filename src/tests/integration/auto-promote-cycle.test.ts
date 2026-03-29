import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { GlobalKnowledgeStore } from '../../core/global-store.js';
import { Dreamer } from '../../core/dreamer.js';
import { createTestDb } from '../helpers.js';

describe('auto-promote full cycle', () => {
  it('search → track → scan → promote → verify → skip', async () => {
    const storage = await createTestDb();
    const kb = new KnowledgeBase(storage);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-cycle-'));
    const globalStore = new GlobalKnowledgeStore(undefined, path.join(tmpDir, 'global.db'));
    globalStore.open();
    const dreamer = new Dreamer(kb, storage, { cycleMs: 60_000, globalStore });

    // 1. Save knowledge
    const entry = kb.save({
      category: 'pattern',
      title: 'Always validate JWT audience claim',
      content: 'JWT tokens must have audience (aud) claim validated to prevent token confusion attacks',
      tags: ['security', 'jwt'],
      shareable: true,
      source_type: 'explicit',
    });

    // 2. Search from 3 different sessions (triggers session access recording)
    kb.search('JWT audience', { limit: 5 }, 'sess-day1');
    kb.search('JWT validation', { limit: 5 }, 'sess-day2');
    kb.search('JWT aud claim', { limit: 5 }, 'sess-day3');

    // 3. Verify session_access_log has 3 entries
    const salCount = storage.prepare(
      'SELECT COUNT(DISTINCT session_id) as cnt FROM session_access_log WHERE knowledge_id = ?'
    ).get(entry.id) as { cnt: number };
    assert.equal(salCount.cnt, 3, 'should have 3 distinct session accesses');

    // 4. Run promotionScan
    const candidates = await dreamer.promotionScan();
    assert.ok(candidates.length >= 1, 'should find promotion candidate');
    assert.ok(candidates.some(c => c.id === entry.id));

    // 5. Execute promotion
    for (const candidate of candidates) {
      const localEntry = kb.getById(candidate.id);
      if (localEntry && localEntry.shareable) {
        globalStore.promote(localEntry, 'test-project');
        storage.exec('UPDATE knowledge SET auto_promoted = 1 WHERE id = ?', [candidate.id]);
      }
    }

    // 6. Verify in global store
    const globalResults = globalStore.search('JWT audience');
    assert.ok(globalResults.length >= 1, 'should exist in global store');

    // 7. Second scan should skip
    const secondScan = await dreamer.promotionScan();
    assert.ok(!secondScan.some(c => c.id === entry.id), 'should skip already promoted');

    dreamer.stop();
    globalStore.close();
    await storage.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
