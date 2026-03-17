import { Kernel } from '../../core/kernel.js';
import { createMcpServer } from '../../mcp-server/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { ToolKernel } from '../../mcp-server/tools.js';
import { registerInstance, deregisterInstance } from '../../core/instance-registry.js';

export async function serve(_args: string[]): Promise<void> {
  const projectDir = process.cwd();
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
  // When editor closes stdin, shut down cleanly
  process.stdin.on('close', shutdown);
}

async function startDashboard(projectDir: string): Promise<ChildProcess | null> {
  // Check if dashboard is already running (singleton)
  try {
    const res = await fetch('http://localhost:51893/api/health');
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

  console.error('context-mem: Dashboard available at http://localhost:51893');
  return child;
}
