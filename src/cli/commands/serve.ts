import { Kernel } from '../../core/kernel.js';
import { createMcpServer } from '../../mcp-server/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolKernel } from '../../mcp-server/tools.js';

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

  // Graceful shutdown
  const shutdown = async () => { await kernel.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
