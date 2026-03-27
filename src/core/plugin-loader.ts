import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { SummarizerPlugin, ContextMemConfig } from './types.js';

const SUMMARIZER_PREFIX = 'context-mem-summarizer-';

export class PluginLoader {
  /**
   * Discovers and loads external summarizer plugins from a project's node_modules.
   *
   * Looks for npm packages whose name starts with `context-mem-summarizer-` in the
   * project's package.json dependencies/devDependencies. Validates that each package
   * exports `detect()` and `summarize()` methods. Respects config enabled/disabled
   * per plugin and applies priority overrides.
   */
  loadSummarizers(
    projectDir: string,
    config?: ContextMemConfig,
  ): SummarizerPlugin[] {
    const pkgPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return [];

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      return [];
    }

    const deps: Record<string, string> = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };

    const externalConfig = config?.plugins?.external_summarizers ?? {};

    const plugins: SummarizerPlugin[] = [];
    for (const name of Object.keys(deps)) {
      if (!name.startsWith(SUMMARIZER_PREFIX)) continue;

      // Check if explicitly disabled in config
      const pluginConf = externalConfig[name];
      if (pluginConf && pluginConf.enabled === false) continue;

      try {
        const require_ = createRequire(path.join(projectDir, 'package.json'));
        const mod = require_(name);
        const plugin = mod.default || mod;

        if (typeof plugin.detect !== 'function' || typeof plugin.summarize !== 'function') {
          continue; // Skip packages without required methods
        }

        // Apply priority override from config
        if (pluginConf?.priority !== undefined) {
          plugin.priority = pluginConf.priority;
        }

        plugins.push(plugin as SummarizerPlugin);
      } catch {
        // Skip broken/missing plugins silently
      }
    }

    // Sort by priority (lower = first). Default priority is 500 if not set.
    plugins.sort((a, b) => (a.priority ?? 500) - (b.priority ?? 500));

    return plugins;
  }
}
