import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolKernel } from './tools.js';
import {
  toolDefinitions,
  handleObserve,
  handleSummarize,
  handleSearch,
  handleTimeline,
  handleGet,
  handleStats,
  handleConfigure,
  handleExecute,
  handleIndexContent,
  handleSearchContent,
  handleSaveKnowledge,
  handleSearchKnowledge,
  handleBudgetStatus,
  handleBudgetConfigure,
  handleRestoreSession,
  handleEmitEvent,
  handleQueryEvents,
} from './tools.js';

export function createMcpServer(kernel: ToolKernel): Server {
  const server = new Server(
    { name: 'context-mem', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    try {
      let result: unknown;

      switch (name) {
        case 'observe':
          result = await handleObserve(params as Parameters<typeof handleObserve>[0], kernel);
          break;
        case 'summarize':
          result = await handleSummarize(params as Parameters<typeof handleSummarize>[0], kernel);
          break;
        case 'search':
          result = await handleSearch(params as Parameters<typeof handleSearch>[0], kernel);
          break;
        case 'timeline':
          result = await handleTimeline(params as Parameters<typeof handleTimeline>[0], kernel);
          break;
        case 'get':
          result = await handleGet(params as Parameters<typeof handleGet>[0], kernel);
          break;
        case 'stats':
          result = await handleStats(params as Parameters<typeof handleStats>[0], kernel);
          break;
        case 'configure':
          result = await handleConfigure(params as Parameters<typeof handleConfigure>[0], kernel);
          break;
        case 'execute':
          result = await handleExecute(params as Parameters<typeof handleExecute>[0], kernel);
          break;
        case 'index_content':
          result = await handleIndexContent(params as Parameters<typeof handleIndexContent>[0], kernel);
          break;
        case 'search_content':
          result = await handleSearchContent(params as Parameters<typeof handleSearchContent>[0], kernel);
          break;
        case 'save_knowledge':
          result = await handleSaveKnowledge(params as Parameters<typeof handleSaveKnowledge>[0], kernel);
          break;
        case 'search_knowledge':
          result = await handleSearchKnowledge(params as Parameters<typeof handleSearchKnowledge>[0], kernel);
          break;
        case 'budget_status':
          result = await handleBudgetStatus(params as Parameters<typeof handleBudgetStatus>[0], kernel);
          break;
        case 'budget_configure':
          result = await handleBudgetConfigure(params as Parameters<typeof handleBudgetConfigure>[0], kernel);
          break;
        case 'restore_session':
          result = await handleRestoreSession(params as Parameters<typeof handleRestoreSession>[0], kernel);
          break;
        case 'emit_event':
          result = await handleEmitEvent(params as Parameters<typeof handleEmitEvent>[0], kernel);
          break;
        case 'query_events':
          result = await handleQueryEvents(params as Parameters<typeof handleQueryEvents>[0], kernel);
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      // If the handler returns a pre-formatted MCP content response, pass through directly
      if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>) && Array.isArray((result as Record<string, unknown>).content)) {
        return result as { content: Array<{ type: string; text: string }> };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(kernel: ToolKernel): Promise<void> {
  const server = createMcpServer(kernel);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
