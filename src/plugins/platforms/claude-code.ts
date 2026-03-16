import fs from 'node:fs';
import path from 'node:path';
import type { PlatformAdapter, PluginConfig, HookConfig, MCPServerConfig, ToolNameMap } from '../../core/types.js';

export class ClaudeCodeAdapter implements PlatformAdapter {
  name = 'claude-code-adapter';
  version = '1.0.0';
  type = 'platform' as const;
  platform = 'claude-code';

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detectPlatform(): boolean {
    // 1. Env var (most reliable)
    if (process.env.CLAUDE_CODE_ENTRYPOINT) return true;
    // 2. .claude directory in project
    try {
      return fs.existsSync(path.join(process.cwd(), '.claude'));
    } catch {
      return false;
    }
  }

  getHookFormat(): HookConfig {
    return {
      type: 'subprocess',
      hook_script: 'hooks/context-mem-hook.js',
      settings_path: path.join(process.env.HOME || '~', '.claude', 'settings.json'),
    };
  }

  getToolNames(): ToolNameMap {
    return {
      observe: 'context_mem_observe',
      summarize: 'context_mem_summarize',
      search: 'context_mem_search',
      timeline: 'context_mem_timeline',
      get: 'context_mem_get',
      stats: 'context_mem_stats',
      configure: 'context_mem_configure',
      execute: 'context_mem_execute',
    };
  }

  wrapMCPServer(): MCPServerConfig {
    return { port: 0, transport: 'stdio' };
  }
}
