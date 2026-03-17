/**
 * context-mem ContextEngine plugin for OpenClaw.
 *
 * Provides 99% token savings via 14 content-aware summarizers,
 * 3-layer hybrid search, knowledge base, and budget management.
 *
 * Install:
 *   openclaw plugins install @context-mem/openclaw-plugin
 *
 * Config (openclaw.json):
 *   { "plugins": { "slots": { "contextEngine": "context-mem" } } }
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { ContextMemEngine } from './engine.js';

const plugin = {
  id: 'context-mem',
  name: 'context-mem Context Engine',
  description: 'Context optimization — 99% token savings via 14 content-aware summarizers, 3-layer search, knowledge base',

  configSchema: {
    parse(value: unknown) {
      const defaults = { enabled: true, dashboardPort: 51893 };
      if (!value || typeof value !== 'object') return defaults;
      return { ...defaults, ...(value as Record<string, unknown>) };
    },
  },

  register(api: OpenClawPluginApi) {
    api.registerContextEngine('context-mem', () => new ContextMemEngine(api));

    // Register MCP tools as OpenClaw tools
    api.registerTool(
      (ctx: any) => ({
        name: 'context_mem_search',
        description: 'Search context-mem observations and knowledge base',
        parameters: { query: { type: 'string', description: 'Search query' } },
        async execute({ query }: { query: string }) {
          const engine = ctx.getContextEngine() as ContextMemEngine;
          return engine.searchObservations(query);
        },
      }),
      { name: 'context_mem_search' },
    );

    api.registerTool(
      (ctx: any) => ({
        name: 'context_mem_stats',
        description: 'Show context-mem token savings statistics',
        parameters: {},
        async execute() {
          const engine = ctx.getContextEngine() as ContextMemEngine;
          return engine.getStats();
        },
      }),
      { name: 'context_mem_stats' },
    );

    api.logger.info('[context-mem] Plugin registered');
  },
};

export default plugin;
