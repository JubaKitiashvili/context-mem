import type { AgentInfo } from '../../core/types.js';
import { type ToolKernel, type ToolDefinition } from './shared.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const agentToolDefinitions: ToolDefinition[] = [
  // Multi-Agent coordination tools
  {
    name: 'agent_register',
    description: 'Register the current session as a named agent for multi-agent coordination.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name (e.g., auth-agent, test-runner)' },
        task: { type: 'string', description: 'Current task description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'agent_status',
    description: 'List all active agents with their tasks and claimed files.',
    inputSchema: {
      type: 'object',
      properties: {
        include_stale: { type: 'boolean', description: 'Include agents with stale heartbeats' },
      },
      required: [],
    },
  },
  {
    name: 'claim_files',
    description: 'Claim files for the current agent. Returns conflicts if already claimed by another agent.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to claim' },
      },
      required: ['files'],
    },
  },
  {
    name: 'agent_broadcast',
    description: 'Broadcast a message to all active agents via the event system.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to broadcast to all agents' },
        priority: { type: 'number', enum: [1, 2, 3, 4], description: 'Message priority' },
      },
      required: ['message'],
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleAgentRegister(
  params: { name: string; task?: string },
  kernel: ToolKernel,
): Promise<{ id: string; name: string } | { error: string }> {
  if (!kernel.agentRegistry) {
    return { error: 'Agent registry is not initialized' };
  }
  if (!params.name || typeof params.name !== 'string' || !params.name.trim()) {
    return { error: 'name is required and must be a non-empty string' };
  }

  const agent = kernel.agentRegistry.register(params.name.trim(), params.task?.trim());
  return { id: agent.id, name: agent.name };
}

export async function handleAgentStatus(
  params: { include_stale?: boolean },
  kernel: ToolKernel,
): Promise<{ agents: AgentInfo[] } | { error: string }> {
  if (!kernel.agentRegistry) {
    return { error: 'Agent registry is not initialized' };
  }

  const agents = kernel.agentRegistry.getActive(params.include_stale ?? false);
  return { agents };
}

export async function handleClaimFiles(
  params: { files: string[] },
  kernel: ToolKernel,
): Promise<{ claimed: string[]; conflicts: Array<{ file: string; agent: string }> } | { error: string }> {
  if (!kernel.agentRegistry) {
    return { error: 'Agent registry is not initialized' };
  }
  if (!Array.isArray(params.files) || params.files.length === 0) {
    return { error: 'files is required and must be a non-empty array of strings' };
  }
  // Validate each file is a non-empty string
  for (const f of params.files) {
    if (typeof f !== 'string' || !f.trim()) {
      return { error: 'Each file must be a non-empty string' };
    }
  }

  // Ensure agent is registered before claiming
  const active = kernel.agentRegistry.getActive(true);
  if (!active.find(a => a.id === kernel.agentRegistry!.getId())) {
    return { error: 'Agent must be registered with agent_register before claiming files' };
  }

  const result = kernel.agentRegistry.claimFiles(params.files.map(f => f.trim()));
  return result;
}

export async function handleAgentBroadcast(
  params: { message: string; priority?: number },
  kernel: ToolKernel,
): Promise<{ event_id: string } | { error: string }> {
  if (!kernel.agentRegistry) {
    return { error: 'Agent registry is not initialized' };
  }
  if (!params.message || typeof params.message !== 'string' || !params.message.trim()) {
    return { error: 'message is required and must be a non-empty string' };
  }
  if (params.priority !== undefined && ![1, 2, 3, 4].includes(params.priority)) {
    return { error: 'priority must be 1, 2, 3, or 4' };
  }

  const priority = (params.priority ?? 2) as 1 | 2 | 3 | 4;

  // Ensure agent is registered before broadcasting
  const active = kernel.agentRegistry.getActive(true);
  if (!active.find(a => a.id === kernel.agentRegistry!.getId())) {
    return { error: 'Agent must be registered with agent_register before broadcasting' };
  }

  // Use eventTracker.emit() to broadcast as an agent_broadcast event
  const event = kernel.eventTracker.emit(
    kernel.sessionId,
    'agent_broadcast',
    { message: params.message.trim(), agent_id: kernel.agentRegistry.getId(), priority },
    kernel.agentRegistry.getId(),
  );

  return { event_id: event.id };
}
