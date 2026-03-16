import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PluginRegistry } from '../../core/plugin-registry.js';
import type { Plugin, PluginConfig } from '../../core/types.js';

function makePlugin(name: string, type: string = 'summarizer'): Plugin {
  return {
    name, version: '1.0.0', type: type as Plugin['type'],
    init: async (_config: PluginConfig) => {},
    destroy: async () => {},
  };
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => { registry = new PluginRegistry(); });

  it('registers and retrieves a plugin', async () => {
    const plugin = makePlugin('test-plugin', 'summarizer');
    await registry.register(plugin);
    const retrieved = registry.get('summarizer', 'test-plugin');
    assert.equal(retrieved?.name, 'test-plugin');
  });

  it('getAll returns all plugins of a type', async () => {
    await registry.register(makePlugin('a', 'summarizer'));
    await registry.register(makePlugin('b', 'summarizer'));
    await registry.register(makePlugin('c', 'search'));
    assert.equal(registry.getAll('summarizer').length, 2);
    assert.equal(registry.getAll('search').length, 1);
  });

  it('rejects duplicate plugin names', async () => {
    await registry.register(makePlugin('dup'));
    await assert.rejects(() => registry.register(makePlugin('dup')));
  });

  it('unregister calls destroy and removes plugin', async () => {
    let destroyed = false;
    const plugin = { ...makePlugin('rm'), destroy: async () => { destroyed = true; } };
    await registry.register(plugin);
    await registry.unregister('rm');
    assert.equal(destroyed, true);
    assert.equal(registry.get('summarizer', 'rm'), undefined);
  });

  it('shutdown destroys all plugins in reverse order', async () => {
    const order: string[] = [];
    const mkPlugin = (name: string) => ({
      ...makePlugin(name), destroy: async () => { order.push(name); },
    });
    await registry.register(mkPlugin('first'));
    await registry.register(mkPlugin('second'));
    await registry.register(mkPlugin('third'));
    await registry.shutdown();
    assert.deepEqual(order, ['third', 'second', 'first']);
  });

  it('skips registration if init() throws', async () => {
    const bad = { ...makePlugin('bad'), init: async () => { throw new Error('fail'); } };
    await registry.register(bad);
    assert.equal(registry.get('summarizer', 'bad'), undefined);
  });
});
