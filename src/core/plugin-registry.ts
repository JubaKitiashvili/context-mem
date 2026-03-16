import type { Plugin, PluginConfig, PluginType } from './types.js';

export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private registrationOrder: string[] = [];

  async register(plugin: Plugin, config: PluginConfig = {}): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    try {
      await plugin.init(config);
    } catch (err) {
      console.warn(`Plugin "${plugin.name}" init failed, skipping:`, (err as Error).message);
      return;
    }
    this.plugins.set(plugin.name, plugin);
    this.registrationOrder.push(plugin.name);
  }

  get<T extends Plugin = Plugin>(type: PluginType | string, name?: string): T | undefined {
    if (name) {
      const plugin = this.plugins.get(name);
      if (plugin && plugin.type === type) return plugin as T;
      return undefined;
    }
    for (const plugin of this.plugins.values()) {
      if (plugin.type === type) return plugin as T;
    }
    return undefined;
  }

  getAll(type: PluginType | string): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.type === type);
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    await plugin.destroy();
    this.plugins.delete(name);
    this.registrationOrder = this.registrationOrder.filter(n => n !== name);
  }

  async shutdown(): Promise<void> {
    const reversed = [...this.registrationOrder].reverse();
    for (const name of reversed) {
      const plugin = this.plugins.get(name);
      if (plugin) {
        try { await plugin.destroy(); } catch { /* ignore destroy errors on shutdown */ }
      }
    }
    this.plugins.clear();
    this.registrationOrder = [];
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  get size(): number {
    return this.plugins.size;
  }
}
