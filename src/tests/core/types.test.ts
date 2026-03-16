import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Type-level tests — verify interfaces compile correctly
describe('core types', () => {
  it('Plugin interface has required fields', async () => {
    const types = await import('../../core/types.js');
    assert.equal(typeof types.isPlugin, 'function');
    assert.equal(typeof types.OBSERVATION_TYPES, 'object');
    assert.equal(typeof types.PLUGIN_TYPES, 'object');
  });

  it('OBSERVATION_TYPES contains all valid types', async () => {
    const { OBSERVATION_TYPES } = await import('../../core/types.js');
    assert.ok(OBSERVATION_TYPES.includes('code'));
    assert.ok(OBSERVATION_TYPES.includes('error'));
    assert.ok(OBSERVATION_TYPES.includes('log'));
    assert.ok(OBSERVATION_TYPES.includes('test'));
    assert.ok(OBSERVATION_TYPES.includes('commit'));
    assert.ok(OBSERVATION_TYPES.includes('decision'));
    assert.ok(OBSERVATION_TYPES.includes('context'));
  });
});
