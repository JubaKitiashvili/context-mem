import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SUMMARIZER_PREFIX = 'context-mem-summarizer-';

export async function plugin(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'add':
      return pluginAdd(args.slice(1));
    case 'remove':
      return pluginRemove(args.slice(1));
    case 'list':
      return pluginList();
    default:
      console.log(`Usage:
  context-mem plugin add <package-name>      Install and register a summarizer plugin
  context-mem plugin remove <package-name>   Uninstall and unregister a plugin
  context-mem plugin list                    Show installed plugins with status`);
      break;
  }
}

function resolvePackageName(name: string): string {
  return name.startsWith(SUMMARIZER_PREFIX) ? name : `${SUMMARIZER_PREFIX}${name}`;
}

function readConfig(projectDir: string): Record<string, unknown> {
  const configPath = path.join(projectDir, '.context-mem.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = path.join(projectDir, '.context-mem.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function pluginAdd(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error('Usage: context-mem plugin add <package-name>');
    console.error('Example: context-mem plugin add context-mem-summarizer-k8s');
    process.exit(1);
    return;
  }

  const packageName = resolvePackageName(name);
  const projectDir = process.cwd();

  console.log(`Installing ${packageName}...`);
  try {
    execSync(`npm install ${packageName}`, { cwd: projectDir, stdio: 'pipe' });
  } catch (err) {
    console.error(`Failed to install ${packageName}: ${(err as Error).message}`);
    process.exit(1);
  }

  // Register in .context-mem.json
  const config = readConfig(projectDir);
  if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
  }
  const plugins = config.plugins as Record<string, unknown>;
  if (!plugins.external_summarizers || typeof plugins.external_summarizers !== 'object') {
    plugins.external_summarizers = {};
  }
  const external = plugins.external_summarizers as Record<string, unknown>;
  external[packageName] = { enabled: true };
  writeConfig(projectDir, config);

  console.log(`Registered ${packageName} in .context-mem.json`);
  console.log(`Done. ${packageName} is now active.`);
}

function pluginRemove(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error('Usage: context-mem plugin remove <package-name>');
    console.error('Example: context-mem plugin remove context-mem-summarizer-k8s');
    process.exit(1);
    return;
  }

  const packageName = resolvePackageName(name);
  const projectDir = process.cwd();

  console.log(`Uninstalling ${packageName}...`);
  try {
    execSync(`npm uninstall ${packageName}`, { cwd: projectDir, stdio: 'pipe' });
  } catch (err) {
    console.error(`Failed to uninstall ${packageName}: ${(err as Error).message}`);
    process.exit(1);
  }

  // Unregister from .context-mem.json
  const config = readConfig(projectDir);
  const plugins = config.plugins as Record<string, unknown> | undefined;
  if (plugins) {
    const external = plugins.external_summarizers as Record<string, unknown> | undefined;
    if (external && packageName in external) {
      delete external[packageName];
      writeConfig(projectDir, config);
      console.log(`Unregistered ${packageName} from .context-mem.json`);
    }
  }

  console.log(`Done. ${packageName} has been removed.`);
}

function pluginList(): void {
  const projectDir = process.cwd();
  const config = readConfig(projectDir);

  // Gather plugins from config
  const plugins = config.plugins as Record<string, unknown> | undefined;
  const external = (plugins?.external_summarizers ?? {}) as Record<
    string,
    { enabled?: boolean; priority?: number }
  >;

  // Also scan package.json dependencies for any context-mem-summarizer-* packages
  const pkgPath = path.join(projectDir, 'package.json');
  const installedPlugins = new Set<string>();
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps: Record<string, string> = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith(SUMMARIZER_PREFIX)) {
          installedPlugins.add(dep);
        }
      }
    } catch {
      // ignore
    }
  }

  // Merge: anything in config or installed
  const allPlugins = new Set([...Object.keys(external), ...installedPlugins]);

  if (allPlugins.size === 0) {
    console.log('No plugins installed.');
    console.log('');
    console.log('Install one with: context-mem plugin add <package-name>');
    return;
  }

  console.log('Installed plugins:');
  console.log('');
  for (const name of allPlugins) {
    const conf = external[name];
    const installed = installedPlugins.has(name);
    const enabled = conf?.enabled !== false;
    const priority = conf?.priority ?? 'default';
    const status = !installed
      ? 'not installed'
      : enabled
        ? 'enabled'
        : 'disabled';
    console.log(`  ${name}  [${status}]  priority: ${priority}`);
  }
}
