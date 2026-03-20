import type { RuntimePlugin, PluginConfig, ExecOpts, ExecResult } from '../../core/types.js';
import { spawnSafe } from './sandbox.js';

export class ShellRuntime implements RuntimePlugin {
  name = 'shell-runtime';
  version = '1.0.0';
  type = 'runtime' as const;
  language = 'shell';
  extensions = ['.sh', '.bash'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  async detect(): Promise<boolean> {
    return true;
  }

  async execute(code: string, opts: ExecOpts): Promise<ExecResult> {
    const timeout = opts.timeout ?? 10000;

    return spawnSafe({
      cmd: '/bin/sh',
      args: ['-c', code],
      timeout,
      env: opts.env,
    });
  }
}
