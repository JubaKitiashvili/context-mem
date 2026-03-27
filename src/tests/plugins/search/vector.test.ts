import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { VectorSearch } from '../../../plugins/search/vector.js';
import { Embedder } from '../../../plugins/search/embedder.js';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';
import { createTestDb, insertTestObservations } from '../../helpers.js';

describe('VectorSearch', () => {
  let storage: BetterSqlite3Storage;
  let search: VectorSearch;

  beforeEach(async () => {
    storage = await createTestDb();
    search = new VectorSearch(storage);
    await search.init({});
    Embedder._reset();
  });

  afterEach(async () => {
    await storage.close();
    Embedder._reset();
  });

  it('has correct plugin metadata', () => {
    assert.equal(search.name, 'vector-search');
    assert.equal(search.type, 'search');
    assert.equal(search.strategy, 'vector');
    assert.equal(search.priority, 0);
  });

  it('shouldFallback always returns true', () => {
    assert.equal(search.shouldFallback([]), true);
    assert.equal(search.shouldFallback([{} as any]), true);
    assert.equal(search.shouldFallback([{} as any, {} as any]), true);
  });

  it('returns empty when embedder is unavailable', async () => {
    // @huggingface/transformers is not installed in test env
    const results = await search.search('authentication problem', {});
    assert.equal(results.length, 0);
  });

  it('returns empty when no observations have embeddings', async () => {
    insertTestObservations(storage, [
      { id: '1', type: 'error', content: 'some error', summary: 'error summary' },
    ]);
    const results = await search.search('error', {});
    assert.equal(results.length, 0);
  });
});

describe('Embedder utilities', () => {
  it('toBuffer/fromBuffer roundtrip preserves data', () => {
    const original = new Float32Array([0.1, 0.2, 0.3, -0.5, 1.0, 0.0]);
    const buf = Embedder.toBuffer(original);
    const restored = Embedder.fromBuffer(buf);

    assert.equal(restored.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 1e-6, `index ${i}: ${restored[i]} !== ${original[i]}`);
    }
  });

  it('toBuffer produces correct byte length', () => {
    const embedding = new Float32Array(384);
    const buf = Embedder.toBuffer(embedding);
    assert.equal(buf.length, 384 * 4); // 1536 bytes
  });

  it('cosineSimilarity: identical vectors → 1.0', () => {
    const a = new Float32Array([1, 2, 3]);
    assert.ok(Math.abs(Embedder.cosineSimilarity(a, a) - 1.0) < 1e-6);
  });

  it('cosineSimilarity: orthogonal vectors → 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    assert.ok(Math.abs(Embedder.cosineSimilarity(a, b)) < 1e-6);
  });

  it('cosineSimilarity: opposite vectors → -1', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    assert.ok(Math.abs(Embedder.cosineSimilarity(a, b) - (-1.0)) < 1e-6);
  });

  it('cosineSimilarity: different lengths → 0', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    assert.equal(Embedder.cosineSimilarity(a, b), 0);
  });

  it('cosineSimilarity: zero vector → 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    assert.equal(Embedder.cosineSimilarity(a, b), 0);
  });

  it('isAvailable returns a boolean', async () => {
    Embedder._reset();
    const available = await Embedder.isAvailable();
    assert.equal(typeof available, 'boolean');
  });

  it('embed returns Float32Array or null depending on availability', async () => {
    Embedder._reset();
    const result = await Embedder.embed('test text');
    assert.ok(result === null || result instanceof Float32Array);
  });
});
