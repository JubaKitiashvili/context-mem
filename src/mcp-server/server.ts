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
  handleUpdateProfile,
  handlePromoteKnowledge,
  handleGlobalSearch,
  handleGraphQuery,
  handleAddRelationship,
  handleGraphNeighbors,
  handleAgentRegister,
  handleAgentStatus,
  handleClaimFiles,
  handleAgentBroadcast,
  handleTimeTravel,
  handleAsk,
} from './tools.js';

export function createMcpServer(kernel: ToolKernel): Server {
  const server = new Server(
    { name: 'context-mem', version: '2.0.4' },
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
        case 'update_profile':
          result = await handleUpdateProfile(params as Parameters<typeof handleUpdateProfile>[0], kernel);
          break;
        case 'promote_knowledge':
          result = await handlePromoteKnowledge(params as Parameters<typeof handlePromoteKnowledge>[0], kernel);
          break;
        case 'global_search':
          result = await handleGlobalSearch(params as Parameters<typeof handleGlobalSearch>[0], kernel);
          break;
        case 'graph_query':
          result = await handleGraphQuery(params as Parameters<typeof handleGraphQuery>[0], kernel);
          break;
        case 'add_relationship':
          result = await handleAddRelationship(params as Parameters<typeof handleAddRelationship>[0], kernel);
          break;
        case 'graph_neighbors':
          result = await handleGraphNeighbors(params as Parameters<typeof handleGraphNeighbors>[0], kernel);
          break;
        case 'agent_register':
          result = await handleAgentRegister(params as Parameters<typeof handleAgentRegister>[0], kernel);
          break;
        case 'agent_status':
          result = await handleAgentStatus(params as Parameters<typeof handleAgentStatus>[0], kernel);
          break;
        case 'claim_files':
          result = await handleClaimFiles(params as Parameters<typeof handleClaimFiles>[0], kernel);
          break;
        case 'agent_broadcast':
          result = await handleAgentBroadcast(params as Parameters<typeof handleAgentBroadcast>[0], kernel);
          break;
        case 'time_travel':
          result = await handleTimeTravel(params as Parameters<typeof handleTimeTravel>[0], kernel);
          break;
        case 'ask':
          result = await handleAsk(params as Parameters<typeof handleAsk>[0], kernel);
          break;
        default:
          console.error(`context-mem: Unknown MCP tool requested: ${name}`);
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }], isError: true };
      }

      // If the handler returns a pre-formatted MCP content response, pass through directly
      if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>) && Array.isArray((result as Record<string, unknown>).content)) {
        return result as { content: Array<{ type: string; text: string }> };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      const sanitized = msg.replace(/\/(?:Users|home|var|tmp|opt|root|private)\/[\w\-\/.]+/g, '[path]');
      return { content: [{ type: 'text', text: JSON.stringify({ error: sanitized }) }], isError: true };
    }
  });

  return server;
}

export async function startMcpServer(kernel: ToolKernel): Promise<void> {
  const server = createMcpServer(kernel);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
