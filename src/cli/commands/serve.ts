import { Kernel } from '../../core/kernel.js';
import { createMcpServer } from '../../mcp-server/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { ToolKernel } from '../../mcp-server/tools.js';
import { registerInstance, deregisterInstance } from '../../core/instance-registry.js';

/** Lightweight first-run setup that runs automatically on serve */
function firstRunSetup(projectDir: string): void {
  const markerPath = path.join(projectDir, '.context-mem', '.initialized');

  // Skip if already done
  if (fs.existsSync(markerPath)) return;

  // 1. Ensure .gitignore excludes .context-mem/
  const gitignorePath = path.join(projectDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.context-mem')) {
      fs.appendFileSync(gitignorePath, '\n# context-mem\n.context-mem/\n');
      console.error('context-mem: Added .context-mem/ to .gitignore');
    }
  }

  // 2. Auto-detect editors and create rules files
  const rulesSetup = autoDetectAndSetupRules(projectDir);
  if (rulesSetup.length > 0) {
    console.error(`context-mem: Auto-configured rules for ${rulesSetup.join(', ')}`);
  }

  // 3. Write marker so we don't repeat
  const dir = path.dirname(markerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath, new Date().toISOString() + '\n');

  console.error('context-mem: First-run setup complete. Run `context-mem init` for full configuration.');
}

interface QuickEditorRule {
  name: string;
  detectDir?: string;
  detectGlobal?: string;
  rulesPath: string;
  rulesContent: string;
  /** If true, append to existing file instead of creating new */
  appendToExisting?: boolean;
}

const CONTEXT_MEM_RULES = `# context-mem Integration

context-mem is active in this project. It compresses tool outputs via 14 content-aware summarizers (99% token savings) and serves optimized context through MCP.

## Automatic Behaviors

- **Session start**: Call \`restore_session\` to recover prior context
- **After large outputs** (file reads, terminal output, search results): Call \`observe\` with the content to compress and store it
- **Before re-reading files**: Call \`search\` first — the answer may already be in context-mem
- **When learning project patterns**: Call \`save_knowledge\` to persist decisions, error fixes, API patterns
- **Periodically**: Call \`budget_status\` to check token usage

## Available MCP Tools

- \`observe\` — store and compress content (auto-summarized)
- \`search\` / \`get\` / \`timeline\` — retrieve stored context
- \`stats\` — view compression statistics
- \`save_knowledge\` / \`search_knowledge\` — persistent knowledge base
- \`budget_status\` / \`budget_configure\` — token budget management
- \`emit_event\` / \`query_events\` — event tracking
- \`restore_session\` — session continuity
`;

const QUICK_RULES: QuickEditorRule[] = [
  {
    name: 'Cursor',
    detectDir: '.cursor',
    detectGlobal: path.join(os.homedir(), '.cursor'),
    rulesPath: '.cursor/rules/context-mem.mdc',
    rulesContent: `---\ndescription: context-mem — automatic context optimization for token savings\nglobs:\nalwaysApply: true\n---\n\n${CONTEXT_MEM_RULES}`,
  },
  {
    name: 'Windsurf',
    detectDir: '.windsurf',
    detectGlobal: path.join(os.homedir(), '.windsurf'),
    rulesPath: '.windsurf/rules/context-mem.md',
    rulesContent: CONTEXT_MEM_RULES,
  },
  {
    name: 'Copilot',
    detectDir: '.vscode',
    rulesPath: '.github/copilot-instructions.md',
    rulesContent: CONTEXT_MEM_RULES,
    appendToExisting: true,
  },
  {
    name: 'Cline',
    detectGlobal: path.join(os.homedir(), '.cline'),
    rulesPath: '.clinerules/context-mem.md',
    rulesContent: CONTEXT_MEM_RULES,
  },
  {
    name: 'Roo Code',
    detectGlobal: path.join(os.homedir(), '.roo-code'),
    rulesPath: '.roo/rules/context-mem.md',
    rulesContent: CONTEXT_MEM_RULES,
  },
];

function autoDetectAndSetupRules(projectDir: string): string[] {
  const configured: string[] = [];

  // Directory-based rules (separate files — no conflict)
  for (const rule of QUICK_RULES) {
    const detected =
      (rule.detectDir && fs.existsSync(path.join(projectDir, rule.detectDir))) ||
      (rule.detectGlobal && fs.existsSync(rule.detectGlobal));
    if (!detected) continue;

    const fullPath = path.join(projectDir, rule.rulesPath);

    // Skip if already exists and contains context-mem
    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, 'utf8');
      if (existing.includes('context-mem')) continue;
      if (rule.appendToExisting) {
        fs.appendFileSync(fullPath, '\n\n' + rule.rulesContent);
        configured.push(rule.name);
        continue;
      }
      continue; // Don't overwrite non-context-mem files
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, rule.rulesContent);
    configured.push(rule.name);
  }

  // Markdown append rules (CLAUDE.md, GEMINI.md)
  for (const file of ['CLAUDE.md', 'GEMINI.md']) {
    const fullPath = path.join(projectDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const existing = fs.readFileSync(fullPath, 'utf8');
    if (existing.includes('# context-mem Integration')) continue;
    fs.appendFileSync(fullPath, '\n\n' + CONTEXT_MEM_RULES);
    configured.push(file.replace('.md', ''));
  }

  return configured;
}

export async function serve(_args: string[]): Promise<void> {
  const projectDir = process.cwd();

  // Lightweight first-run setup (gitignore + rules)
  try {
    firstRunSetup(projectDir);
  } catch {
    // Non-fatal — don't block serve if setup fails
  }

  const kernel = new Kernel(projectDir);

  try {
    await kernel.start();
  } catch (err) {
    console.error(`context-mem: Failed to start kernel — ${(err as Error).message}`);
    console.error('Run `context-mem init` to set up the project, or `context-mem doctor` to diagnose.');
    process.exit(1);
  }

  const toolKernel: ToolKernel = {
    pipeline: kernel.pipeline,
    search: kernel.getSearchFusion(),
    storage: kernel.getStorage(),
    registry: kernel.registry,
    sessionId: kernel.session.session_id,
    config: kernel.getConfig(),
    budgetManager: kernel.getBudgetManager(),
    eventTracker: kernel.getEventTracker(),
    sessionManager: kernel.getSessionManager(),
    contentStore: kernel.getContentStore(),
    knowledgeBase: kernel.getKnowledgeBase(),
  };

  const server = createMcpServer(toolKernel);
  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
  } catch (err) {
    console.error(`context-mem: Failed to connect MCP transport — ${(err as Error).message}`);
    await kernel.stop();
    process.exit(1);
  }

  console.error('context-mem: MCP server started (stdio)');

  // Register in global instance registry
  const dbRelPath = kernel.getConfig()?.db_path || '.context-mem/store.db';
  registerInstance(projectDir, dbRelPath);

  // Auto-start dashboard (singleton — only first instance starts it)
  let dashboardProcess: ChildProcess | null = null;
  const noDashboard = _args.includes('--no-dashboard');
  if (!noDashboard) {
    dashboardProcess = await startDashboard(projectDir);
  }

  // Graceful shutdown
  const shutdown = async () => {
    deregisterInstance(projectDir);
    if (dashboardProcess) dashboardProcess.kill('SIGTERM');
    await kernel.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', () => deregisterInstance(projectDir));
}

async function startDashboard(projectDir: string): Promise<ChildProcess | null> {
  // Check if dashboard is already running (singleton)
  try {
    const res = await fetch('http://localhost:51893/api/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      console.error('context-mem: Dashboard already running at http://localhost:51893');
      return null;
    }
  } catch {
    // Not running — start it
  }

  // __dirname = dist/cli/commands/ → go up 3 levels to project root
  const serverScript = path.join(__dirname, '..', '..', '..', 'dashboard', 'server.js');
  if (!fs.existsSync(serverScript)) return null;

  const child = spawn('node', [serverScript, '--port', '51893', '--no-open', '--multi'], {
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  child.on('error', () => {}); // Prevent unhandled error if spawn fails

  console.error('context-mem: Dashboard available at http://localhost:51893');
  return child;
}
