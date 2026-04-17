import { type ToolKernel, type ToolDefinition } from './shared.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const narrativeToolDefinitions: ToolDefinition[] = [
  // Total Recall — Generate Story
  {
    name: 'generate_story',
    description: 'Generate a human-readable narrative from session data. Formats: pr (pull request), standup, adr (architecture decision record), onboarding.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['pr', 'standup', 'adr', 'onboarding'], description: 'Output format' },
        session_id: { type: 'string', description: 'Filter by session ID' },
        topic: { type: 'string', description: 'Filter by topic' },
        from: { type: 'number', description: 'Start timestamp for time range' },
        to: { type: 'number', description: 'End timestamp for time range' },
      },
      required: ['format'],
    },
  },
  // Total Recall — Decision Trail
  {
    name: 'explain_decision',
    description: 'Reconstruct the evidence chain behind a code change or decision. Returns the trail of events that led to a decision.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'File path or topic to explain' },
      },
      required: ['query'],
    },
  },
  // Total Recall — Predict Loss
  {
    name: 'predict_loss',
    description: 'Predict which memory entries are at highest risk of being forgotten or archived. Users can pin important entries to protect them.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of at-risk entries to return (default: 10)' },
      },
    },
  },
  // Total Recall — Wake-Up Primer
  {
    name: 'wake_up',
    description: 'Generate a scored session primer with 4-layer context: project profile, critical knowledge, recent decisions, and top entities.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_tokens: { type: 'number', description: 'Total token budget for the primer (default: 700)' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Total Recall — Generate Story handler
export async function handleGenerateStory(
  params: { format: string; session_id?: string; topic?: string; from?: number; to?: number },
  kernel: ToolKernel,
): Promise<{ narrative: string; format: string } | { error: string }> {
  const validFormats = ['pr', 'standup', 'adr', 'onboarding'];
  if (!validFormats.includes(params.format)) {
    return { error: `Invalid format. Must be one of: ${validFormats.join(', ')}` };
  }
  const { generateNarrative } = await import('../../core/narrative-generator.js');
  const narrative = generateNarrative(kernel.storage, {
    format: params.format as 'pr' | 'standup' | 'adr' | 'onboarding',
    sessionId: params.session_id,
    topic: params.topic,
    timeRange: params.from && params.to ? { from: params.from, to: params.to } : undefined,
  });
  return { narrative, format: params.format };
}

// Total Recall — Decision Trail handler
export async function handleExplainDecision(
  params: { query: string },
  kernel: ToolKernel,
): Promise<unknown> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { error: 'query is required' };
  }
  const { buildTrail } = await import('../../core/decision-trail.js');
  const trail = buildTrail(kernel.storage, params.query.trim());
  if (!trail) return { error: `No decision trail found for "${params.query}"` };
  return trail;
}

// Total Recall — Predict Loss handler
export async function handlePredictLoss(
  params: { limit?: number },
  kernel: ToolKernel,
): Promise<unknown> {
  const { predictLoss } = await import('../../core/pressure-predictor.js');
  return predictLoss(kernel.storage, params.limit ?? 10);
}

// Total Recall — Wake-Up Primer handler
export async function handleWakeUp(
  params: { budget_tokens?: number },
  kernel: ToolKernel,
): Promise<{ l0_profile: string; l1_critical: string; l2_recent: string; l3_entities: string; total_tokens: number }> {
  const { assembleWakeUp } = await import('../../core/wake-up.js');
  return assembleWakeUp(kernel.storage, { total_budget_tokens: params.budget_tokens });
}
