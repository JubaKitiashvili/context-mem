import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, mergeConfig } from '../../core/config.js';
import { DEFAULT_CONFIG } from '../../core/types.js';

describe('config', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadConfig('/nonexistent/path');
    assert.deepEqual(config, DEFAULT_CONFIG);
  });

  it('merges partial config with defaults', () => {
    const partial = { port: 9999, privacy: { strip_tags: false } };
    const merged = mergeConfig(partial);
    assert.equal(merged.port, 9999);
    assert.equal(merged.privacy.strip_tags, false);
    assert.equal(merged.storage, DEFAULT_CONFIG.storage);
    assert.deepEqual(merged.plugins, DEFAULT_CONFIG.plugins);
  });

  it('replaces arrays wholesale (does not append)', () => {
    const partial = { plugins: { summarizers: ['code'] } };
    const merged = mergeConfig(partial);
    assert.deepEqual(merged.plugins.summarizers, ['code']);
  });
});
