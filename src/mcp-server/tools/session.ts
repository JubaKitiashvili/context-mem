import type { EventPriority, ErrorSeverity, ErrorCategory, ErrorLogEntry, ErrorLogSummary } from '../../core/types.js';
import { ERROR_CATEGORIES } from '../../core/types.js';
import { TimeTraveler } from '../../core/time-travel.js';
import type { TimeSnapshot, TimeDelta } from '../../core/time-travel.js';
import { type ToolKernel, type ToolDefinition, validateLimit, validateTimestamp } from './shared.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const sessionToolDefinitions: ToolDefinition[] = [
  // Profile tools
  {
    name: 'update_profile',
    description: 'Update the project quick profile — a 3-5 line summary shown at every session start. Auto-generates from knowledge if no content provided.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Profile content (3-5 lines). If omitted, auto-generates from knowledge base.' },
      },
      required: [],
    },
  },
  // Budget tools
  {
    name: 'budget_status',
    description: 'Get current budget usage and status for the session.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'budget_configure',
    description: 'Configure budget settings (session limit, overflow strategy).',
    inputSchema: {
      type: 'object',
      properties: {
        session_limit: { type: 'number', description: 'Token budget limit for session' },
        overflow_strategy: { type: 'string', enum: ['aggressive_truncation', 'warn', 'hard_stop'], description: 'What to do when budget is exceeded' },
      },
      required: [],
    },
  },
  // Session tools
  {
    name: 'restore_session',
    description: 'Restore a previous session snapshot by session ID.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to restore' },
      },
      required: [],
    },
  },
  // Event tools
  {
    name: 'emit_event',
    description: 'Emit a context event with priority and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: { type: 'string', description: 'Event type (e.g. task_start, error, file_modify, decision)' },
        data: { type: 'object', description: 'Event data/metadata' },
        agent: { type: 'string', description: 'Agent identifier' },
      },
      required: ['event_type'],
    },
  },
  {
    name: 'query_events',
    description: 'Query context events with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: { type: 'string', description: 'Filter by event type' },
        priority: { type: 'number', description: 'Filter by max priority (1=critical, 4=low)' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
        from: { type: 'number', description: 'Start timestamp' },
        to: { type: 'number', description: 'End timestamp' },
      },
      required: [],
    },
  },
  // Time-Travel Debugging
  {
    name: 'time_travel',
    description: 'View or compare the project state at any point in time. Shows observations, knowledge, and events as of a target date.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO date or relative ("3 days ago", "last week", "yesterday")' },
        scope: { type: 'string', enum: ['knowledge', 'observations', 'events', 'all'], description: 'What to show (default: all)' },
        compare: { type: 'boolean', description: 'Compare then vs now (show delta)' },
      },
      required: ['date'],
    },
  },
  // Total Recall — Conversation Import
  {
    name: 'import_conversations',
    description: 'Import external conversation exports (Claude, ChatGPT, Slack, plaintext) into context memory.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Conversation content to import' },
        format: { type: 'string', enum: ['auto', 'claude-code', 'claude-ai', 'chatgpt', 'slack', 'plaintext'], description: 'Format hint (default: auto-detect)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_topics',
    description: 'List all detected topics with observation counts.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
  {
    name: 'find_tunnels',
    description: 'Find topics that appear in 2+ projects (cross-project knowledge bridges).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Diagnostics
  {
    name: 'diagnostics',
    description: 'Query internal error log. Shows what context-mem subsystems have failed at (embedder, entity extraction, topic storage, dreamer, etc.). Useful for doctor-style debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number', description: 'Unix ms — only include entries at or after. Default: last hour.' },
        severity: {
          type: 'string',
          enum: ['info', 'warn', 'error', 'critical'],
          description: 'Filter by severity. Omit for all severities.',
        },
        category: {
          type: 'string',
          description: 'Filter by category (embedder, entity, topic, summarizer, pipeline, dreamer, knowledge-graph, etc.).',
        },
        limit: { type: 'number', minimum: 1, maximum: 500, description: 'Max results. Default 50.' },
        mode: {
          type: 'string',
          enum: ['summary', 'list'],
          description: 'summary (default) groups by category+message; list returns raw rows.',
        },
      },
    },
  },
  // Session Handoff
  {
    name: 'handoff_session',
    description: 'Generate session handoff — saves state and returns continuation prompt for a new session. Use when context is running low or before ending a session.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the handoff is happening' },
        target: {
          type: 'string',
          enum: ['return', 'file'],
          description: 'Where to send the continuation prompt. "return" (default) returns it in the response. "file" saves to .context-mem/handoff.md',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: ReadonlyArray<ErrorSeverity> = ['info', 'warn', 'error', 'critical'];

function validateDiagSeverity(v: unknown): ErrorSeverity | undefined {
  if (typeof v !== 'string') return undefined;
  return VALID_SEVERITIES.includes(v as ErrorSeverity) ? (v as ErrorSeverity) : undefined;
}

function validateDiagCategory(v: unknown): ErrorCategory | undefined {
  if (typeof v !== 'string') return undefined;
  return (ERROR_CATEGORIES as readonly string[]).includes(v) ? (v as ErrorCategory) : undefined;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleUpdateProfile(
  params: { content?: string },
  kernel: ToolKernel,
): Promise<{ profile: string; source: string }> {
  if (params.content && params.content.trim()) {
    const profileContent = params.content.trim();
    kernel.knowledgeBase.saveProfile(profileContent);
    return { profile: profileContent, source: 'manual' };
  }

  const generated = kernel.knowledgeBase.generateProfile();
  if (generated) {
    kernel.knowledgeBase.saveProfile(generated);
    return { profile: generated, source: 'auto-generated' };
  }

  // Nothing to generate — return existing profile or empty
  const existing = kernel.knowledgeBase.getProfile();
  if (existing) {
    return { profile: existing.content, source: 'existing (no knowledge to auto-generate)' };
  }

  return { profile: '', source: 'empty (no knowledge yet)' };
}

export async function handleBudgetStatus(
  _params: Record<string, never>,
  kernel: ToolKernel,
): Promise<{ used: number; limit: number; percentage: number; strategy: string; throttled: boolean; blocked: boolean; signal?: string }> {
  return kernel.budgetManager.getStatus(kernel.sessionId);
}

export async function handleBudgetConfigure(
  params: { session_limit?: number; overflow_strategy?: string },
  kernel: ToolKernel,
): Promise<{ updated: boolean } | { error: string }> {
  const config: Record<string, unknown> = {};
  if (params.session_limit !== undefined) {
    if (typeof params.session_limit !== 'number' || params.session_limit <= 0 || !Number.isFinite(params.session_limit)) {
      return { error: 'session_limit must be a positive number' };
    }
    config.session_limit = params.session_limit;
  }
  if (params.overflow_strategy !== undefined) {
    const valid = ['aggressive_truncation', 'warn', 'hard_stop'];
    if (!valid.includes(params.overflow_strategy)) {
      return { error: `overflow_strategy must be one of: ${valid.join(', ')}` };
    }
    config.overflow_strategy = params.overflow_strategy;
  }

  kernel.budgetManager.configure(config as Partial<import('../../core/types.js').BudgetConfig>);
  return { updated: true };
}

export async function handleRestoreSession(
  params: { session_id?: string },
  kernel: ToolKernel,
): Promise<{ content: Array<{ type: string; text: string }> } | { error: string }> {
  const sessionId = (params.session_id as string) || kernel.sessionId;

  const result = await kernel.sessionManager.restoreSnapshot(sessionId);
  if (!result) {
    return { content: [{ type: 'text', text: 'No saved session found. Starting fresh.' }] };
  }

  let guide = `## Session Restored${result.condensed ? ' (condensed — session > 24h old)' : ''}\n\n`;

  const snapshot = result.snapshot as Record<string, string>;
  const CATEGORY_LABELS: Record<string, string> = {
    files: 'Active Files',
    tasks: 'Pending Tasks',
    rules: 'Rules Loaded',
    decisions: 'Recent Decisions',
    errors: 'Recent Errors',
    cwd: 'Working Directory',
    git: 'Git Activity',
    env: 'Environment',
    plan: 'Active Plan',
    mcp_tools: 'Tool Usage',
    intent: 'Session Intent',
    knowledge: 'Knowledge Saved',
    stats: 'Token Stats',
    search_history: 'Recent Searches',
    correlations: 'Correlation Groups',
    changes: 'Recent Changes',
  };

  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    if (snapshot[key]) {
      guide += `### ${label}\n${snapshot[key]}\n\n`;
    }
  }

  guide += '---\nUse `search` to find specific past observations. Use `timeline` with `anchor` for chronological context.\n';

  return { content: [{ type: 'text', text: guide }] };
}

export async function handleEmitEvent(
  params: { event_type: string; data?: Record<string, unknown>; agent?: string },
  kernel: ToolKernel,
): Promise<{ id: string; event_type: string; priority: number }> {
  if (!params.event_type || typeof params.event_type !== 'string' || !params.event_type.trim()) {
    return { id: '', event_type: '', priority: 0, error: 'event_type is required and must be a non-empty string' } as any;
  }
  const event = kernel.eventTracker.emit(
    kernel.sessionId,
    params.event_type,
    params.data || {},
    params.agent,
  );

  // Track file_modify events for feedback engine
  if (params.event_type === 'file_modify' && kernel.feedbackEngine) {
    try {
      kernel.feedbackEngine.checkUsefulness(params.data || {});
    } catch { /* non-critical */ }
  }

  return { id: event.id, event_type: event.event_type, priority: event.priority };
}

export async function handleQueryEvents(
  params: { event_type?: string; priority?: number; limit?: number; from?: number; to?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; event_type: string; priority: number; data: Record<string, unknown>; timestamp: number }>> {
  if (params.priority !== undefined && ![1, 2, 3, 4].includes(params.priority as number)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'priority must be 1, 2, 3, or 4' }) }], isError: true } as any;
  }

  const events = kernel.eventTracker.query(kernel.sessionId, {
    event_type: params.event_type,
    priority: params.priority as EventPriority | undefined,
    limit: validateLimit(params.limit ?? 50),
    from: validateTimestamp(params.from),
    to: validateTimestamp(params.to),
  });

  return events.map(e => ({
    id: e.id,
    event_type: e.event_type,
    priority: e.priority,
    data: e.data,
    timestamp: e.timestamp,
  }));
}

export async function handleTimeTravel(
  params: { date: string; scope?: string; compare?: boolean },
  kernel: ToolKernel,
): Promise<TimeSnapshot | TimeDelta | { error: string }> {
  if (!params.date || typeof params.date !== 'string' || !params.date.trim()) {
    return { error: 'date is required and must be a non-empty string' };
  }

  const scope = params.scope ?? 'all';
  if (!['knowledge', 'observations', 'events', 'all'].includes(scope)) {
    return { error: 'scope must be one of: knowledge, observations, events, all' };
  }

  const traveler = new TimeTraveler(kernel.storage);

  let targetDate: number;
  try {
    targetDate = traveler.parseDate(params.date);
  } catch {
    return { error: `Cannot parse date: "${params.date}"` };
  }

  if (params.compare) {
    return traveler.compare(targetDate);
  }

  return traveler.snapshot(targetDate, scope);
}

export async function handleImportConversations(
  params: { content: string; format?: string },
  kernel: ToolKernel,
): Promise<{ imported: number; skipped: number; format: string; errors: string[] } | { error: string }> {
  if (!params.content || typeof params.content !== 'string' || !params.content.trim()) {
    return { error: 'content is required' };
  }

  const { importConversations } = await import('../../core/conversation-import.js');
  return importConversations(params.content, kernel.pipeline, {
    format: (params.format as 'auto' | 'claude-code' | 'claude-ai' | 'chatgpt' | 'slack' | 'plaintext') || 'auto',
  });
}

export async function handleListTopics(
  params: { limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; name: string; observation_count: number; last_seen: number | null }>> {
  const limit = validateLimit(params.limit ?? 20);
  try {
    const rows = kernel.storage.prepare(
      'SELECT id, name, observation_count, last_seen FROM topics ORDER BY observation_count DESC, last_seen DESC LIMIT ?'
    ).all(limit) as Array<{ id: string; name: string; observation_count: number; last_seen: number | null }>;
    return rows;
  } catch {
    return [];
  }
}

export async function handleFindTunnels(
  _params: Record<string, unknown>,
  kernel: ToolKernel,
): Promise<Array<{ topic: string; projects: string[] }>> {
  if (!kernel.globalStore) return [];
  try {
    // Find topic names that appear in local DB
    const localTopics = kernel.storage.prepare('SELECT name FROM topics WHERE observation_count > 0').all() as Array<{ name: string }>;
    const tunnels: Array<{ topic: string; projects: string[] }> = [];

    for (const lt of localTopics) {
      // Check if this topic exists in global store (cross-project)
      const globalResults = kernel.globalStore.search(lt.name, { limit: 5 });
      if (globalResults.length > 0) {
        const projects = new Set<string>();
        projects.add(kernel.projectDir);
        for (const gr of globalResults) {
          const entry = gr as unknown as Record<string, unknown>;
          if (entry.source_project) {
            projects.add(entry.source_project as string);
          }
        }
        if (projects.size >= 2) {
          tunnels.push({ topic: lt.name, projects: [...projects] });
        }
      }
    }
    return tunnels;
  } catch {
    return [];
  }
}

export async function handleDiagnostics(
  params: {
    since?: number;
    severity?: ErrorSeverity;
    category?: ErrorCategory;
    limit?: number;
    mode?: 'summary' | 'list';
  },
  kernel: ToolKernel,
): Promise<{ mode: 'summary' | 'list'; rows: ErrorLogSummary[] | ErrorLogEntry[] }> {
  if (!kernel.errorLogger) {
    return { mode: 'summary', rows: [] };
  }

  const mode = params.mode === 'list' ? 'list' : 'summary';
  const since = typeof params.since === 'number' && params.since >= 0 ? params.since : Date.now() - 3600_000;
  const limit = Math.max(1, Math.min(500, Number(params.limit ?? 50)));
  const severity = validateDiagSeverity(params.severity);
  const category = validateDiagCategory(params.category);

  if (mode === 'list') {
    return {
      mode,
      rows: kernel.errorLogger.query({ since, severity, category, limit }),
    };
  }

  const rows = kernel.errorLogger.summary({ since, limit });
  const filtered = rows.filter(r => {
    if (severity && r.severity !== severity) return false;
    if (category && r.category !== category) return false;
    return true;
  });
  return { mode, rows: filtered };
}

export async function handleHandoffSession(
  params: { reason?: string; target?: string },
  kernel: ToolKernel,
): Promise<{
  continuation_prompt: string;
  chain_id: string;
  snapshot_id: string;
  token_estimate: { used: number; limit: number; percentage: number };
}> {
  // Save snapshot
  const stats = {
    session_id: kernel.sessionId,
    observations_stored: 0,
    total_content_bytes: 0,
    total_summary_bytes: 0,
    searches_performed: 0,
    discovery_tokens: 0,
    stored_tokens: 0,
    tokens_saved: 0,
    savings_percentage: 0,
  };

  try {
    const row = kernel.storage
      .prepare("SELECT COUNT(*) as cnt FROM token_stats WHERE session_id = ?")
      .get(kernel.sessionId) as { cnt: number } | undefined;
    stats.observations_stored = row?.cnt ?? 0;
  } catch {
    // non-critical
  }

  kernel.sessionManager.saveSnapshot(kernel.sessionId, stats);

  // Create or update chain entry
  const projectPath = kernel.projectDir;
  let chainEntry = kernel.sessionManager.getLatestChainEntry(projectPath);

  if (!chainEntry || chainEntry.session_id !== kernel.sessionId) {
    chainEntry = kernel.sessionManager.createChainEntry(
      kernel.sessionId,
      projectPath,
      chainEntry?.session_id ?? null,
      'manual',
    );
  }

  // Update with summary
  const reason = params.reason || 'Manual handoff';
  kernel.sessionManager.updateChainEntry(kernel.sessionId, { summary: reason });

  // Flush feedback engine — save usefulness data before session ends
  if (kernel.feedbackEngine) {
    try { kernel.feedbackEngine.flushFeedback(); } catch { /* non-critical */ }
  }

  // Generate continuation prompt
  const prompt = kernel.sessionManager.generateContinuationPrompt(kernel.sessionId);

  // Handle target
  const target = params.target || 'return';
  if (target === 'file') {
    const fs = await import('fs');
    const path = await import('path');
    const handoffPath = path.join(kernel.projectDir, '.context-mem', 'handoff.md');
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(handoffPath, prompt);
  }

  // Get token estimate
  const tokenEstimate = kernel.budgetManager.getTokenEstimate(kernel.sessionId);

  return {
    continuation_prompt: prompt,
    chain_id: chainEntry.chain_id,
    snapshot_id: kernel.sessionId,
    token_estimate: tokenEstimate,
  };
}
