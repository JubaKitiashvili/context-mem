import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { createTestDb } from '../helpers.js';

describe('confidence scoring', () => {
  it('explicit entries score higher than observed', async () => {
    const storage = await createTestDb();
    const kb = new KnowledgeBase(storage);

    const explicit = await kb.save({
      category: 'pattern', title: 'Explicit entry', content: 'Content',
      tags: [], shareable: true, source_type: 'explicit',
    });
    const observed = await kb.save({
      category: 'pattern', title: 'Observed entry', content: 'Content',
      tags: [], shareable: true, source_type: 'observed',
    });

    const explicitConf = kb.computeConfidence(explicit);
    const observedConf = kb.computeConfidence(observed);

    assert.ok(explicitConf > observedConf, `explicit (${explicitConf}) should be > observed (${observedConf})`);
    await storage.close();
  });

  it('frequently accessed entries score higher', async () => {
    const storage = await createTestDb();
    const kb = new KnowledgeBase(storage);

    const entry = await kb.save({
      category: 'pattern', title: 'Popular entry', content: 'Content',
      tags: [], shareable: true, source_type: 'explicit',
    });

    const beforeAccess = kb.computeConfidence(entry);

    // Simulate 10 accesses
    storage.exec('UPDATE knowledge SET access_count = 10 WHERE id = ?', [entry.id]);
    const updated = kb.getById(entry.id)!;
    const afterAccess = kb.computeConfidence(updated);

    assert.ok(afterAccess > beforeAccess, `after access (${afterAccess}) should be > before (${beforeAccess})`);
    await storage.close();
  });

  it('returns value between 0 and 1', async () => {
    const storage = await createTestDb();
    const kb = new KnowledgeBase(storage);

    const entry = await kb.save({
      category: 'pattern', title: 'Test', content: 'Content',
      tags: [], shareable: true, source_type: 'explicit',
    });

    const conf = kb.computeConfidence(entry);
    assert.ok(conf >= 0 && conf <= 1, `confidence ${conf} should be between 0 and 1`);
    await storage.close();
  });
});
