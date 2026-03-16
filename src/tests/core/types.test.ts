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

describe('isPlugin type guard', () => {
  it('returns true for a valid plugin object', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const valid = {
      name: 'my-plugin',
      version: '1.0.0',
      type: 'storage',
      init: async () => {},
      destroy: async () => {},
    };
    assert.equal(isPlugin(valid), true);
  });

  it('returns false when name is missing', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const obj = { version: '1.0.0', type: 'storage', init: async () => {}, destroy: async () => {} };
    assert.equal(isPlugin(obj), false);
  });

  it('returns false when version is missing', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const obj = { name: 'p', type: 'storage', init: async () => {}, destroy: async () => {} };
    assert.equal(isPlugin(obj), false);
  });

  it('returns false when type is missing', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const obj = { name: 'p', version: '1.0.0', init: async () => {}, destroy: async () => {} };
    assert.equal(isPlugin(obj), false);
  });

  it('returns false when type is not in PLUGIN_TYPES', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const obj = { name: 'p', version: '1.0.0', type: 'invalid-type', init: async () => {}, destroy: async () => {} };
    assert.equal(isPlugin(obj), false);
  });

  it('returns true for each valid PLUGIN_TYPE value', async () => {
    const { isPlugin, PLUGIN_TYPES } = await import('../../core/types.js');
    for (const type of PLUGIN_TYPES) {
      const obj = { name: 'p', version: '1.0.0', type, init: async () => {}, destroy: async () => {} };
      assert.equal(isPlugin(obj), true, `expected true for type "${type}"`);
    }
  });

  it('returns false for null', async () => {
    const { isPlugin } = await import('../../core/types.js');
    assert.equal(isPlugin(null), false);
  });

  it('returns false for undefined', async () => {
    const { isPlugin } = await import('../../core/types.js');
    assert.equal(isPlugin(undefined), false);
  });

  it('returns false for a string primitive', async () => {
    const { isPlugin } = await import('../../core/types.js');
    assert.equal(isPlugin('not-a-plugin'), false);
  });

  it('returns false for a number primitive', async () => {
    const { isPlugin } = await import('../../core/types.js');
    assert.equal(isPlugin(42), false);
  });

  it('returns false when init is not a function', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const obj = { name: 'p', version: '1.0.0', type: 'storage', init: 'not-a-fn', destroy: async () => {} };
    assert.equal(isPlugin(obj), false);
  });

  it('returns false when destroy is not a function', async () => {
    const { isPlugin } = await import('../../core/types.js');
    const obj = { name: 'p', version: '1.0.0', type: 'storage', init: async () => {}, destroy: null };
    assert.equal(isPlugin(obj), false);
  });

  it('returns false for an empty object', async () => {
    const { isPlugin } = await import('../../core/types.js');
    assert.equal(isPlugin({}), false);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has the expected shape and default values', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');

    assert.equal(DEFAULT_CONFIG.storage, 'auto');
    assert.equal(DEFAULT_CONFIG.token_economics, true);
    assert.equal(DEFAULT_CONFIG.port, 3457);
    assert.equal(DEFAULT_CONFIG.db_path, '.context-mem/store.db');
  });

  it('plugins block contains expected summarizers', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const { summarizers } = DEFAULT_CONFIG.plugins;
    assert.ok(Array.isArray(summarizers));
    for (const s of ['shell', 'json', 'error', 'log', 'code']) {
      assert.ok(summarizers.includes(s), `expected summarizers to include "${s}"`);
    }
  });

  it('plugins block contains expected search strategies', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const { search } = DEFAULT_CONFIG.plugins;
    assert.ok(Array.isArray(search));
    assert.ok(search.includes('bm25'));
    assert.ok(search.includes('trigram'));
  });

  it('plugins block contains expected runtimes', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const { runtimes } = DEFAULT_CONFIG.plugins;
    assert.ok(Array.isArray(runtimes));
    assert.ok(runtimes.includes('javascript'));
    assert.ok(runtimes.includes('python'));
  });

  it('privacy defaults to strip_tags true and empty redact_patterns', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    assert.equal(DEFAULT_CONFIG.privacy.strip_tags, true);
    assert.deepEqual(DEFAULT_CONFIG.privacy.redact_patterns, []);
  });

  it('lifecycle has sensible defaults', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const { lifecycle } = DEFAULT_CONFIG;
    assert.equal(lifecycle.ttl_days, 30);
    assert.equal(lifecycle.max_db_size_mb, 500);
    assert.equal(lifecycle.max_observations, 50000);
    assert.equal(lifecycle.cleanup_schedule, 'on_startup');
  });

  it('lifecycle preserve_types includes decision and commit', async () => {
    const { DEFAULT_CONFIG } = await import('../../core/types.js');
    const { preserve_types } = DEFAULT_CONFIG.lifecycle;
    assert.ok(Array.isArray(preserve_types));
    assert.ok(preserve_types.includes('decision'));
    assert.ok(preserve_types.includes('commit'));
  });
});
