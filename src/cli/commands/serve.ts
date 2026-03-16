import { Kernel } from '../../core/kernel.js';
import { createMcpServer } from '../../mcp-server/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolKernel } from '../../mcp-server/tools.js';
import { SearchFusion } from '../../plugins/search/fusion.js';
import type { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import type { SearchPlugin } from '../../core/types.js';

export async function serve(_args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const kernel = new Kernel(projectDir);
  await kernel.start();

  // Build the ToolKernel adapter using public Kernel APIs
  const storage = kernel.registry.get('storage') as BetterSqlite3Storage;
  const searchPlugins = kernel.registry.getAll('search') as SearchPlugin[];
  const searchFusion = new SearchFusion(searchPlugins);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kernelAny = kernel as any;
  const toolKernel: ToolKernel = {
    pipeline: kernel.pipeline,
    search: searchFusion,
    storage,
    registry: kernel.registry,
    sessionId: kernel.session.session_id,
    config: kernelAny.config,
  };

  const server = createMcpServer(toolKernel);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('context-mem: MCP server started (stdio)');

  // Keep alive
  process.on('SIGTERM', async () => { await kernel.stop(); process.exit(0); });
  process.on('SIGINT', async () => { await kernel.stop(); process.exit(0); });
}
