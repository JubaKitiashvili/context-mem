import type { Pipeline } from '../core/pipeline.js';
import type { SearchFusion } from '../plugins/search/fusion.js';
import type { BetterSqlite3Storage } from '../plugins/storage/better-sqlite3.js';
import type {
  SummarizerPlugin,
  RuntimePlugin,
  ObservationType,
  TokenEconomics,
  SearchResult,
  KnowledgeCategory,
  SourceType,
  ContradictionWarning,
  EventPriority,
  Entity,
  EntityType,
  Relationship,
  RelationshipType,
  GraphResult,
  AgentInfo,
} from '../core/types.js';
import { OBSERVATION_TYPES, ENTITY_TYPES, RELATIONSHIP_TYPES } from '../core/types.js';
import type { KnowledgeGraph } from '../core/knowledge-graph.js';
import type { PluginRegistry } from '../core/plugin-registry.js';
import type { ContextMemConfig } from '../core/types.js';
import type { BudgetManager } from '../core/budget.js';
import type { EventTracker } from '../core/events.js';
import type { SessionManager } from '../core/session.js';
import type { ContentStore } from '../plugins/storage/content-store.js';
import type { KnowledgeBase } from '../plugins/knowledge/knowledge-base.js';
import type { GlobalKnowledgeStore } from '../core/global-store.js';
import type { AgentRegistry } from '../core/agent-registry.js';
import { TimeTraveler } from '../core/time-travel.js';
import type { TimeSnapshot, TimeDelta } from '../core/time-travel.js';

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 512 * 1024; // 512KB
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

function validateLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 5;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, n));
}

function validateTimestamp(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function validateObservationType(v: unknown): ObservationType {
  const s = String(v || 'context');
  return (OBSERVATION_TYPES as readonly string[]).includes(s) ? (s as ObservationType) : 'context';
}

// Minimal kernel interface used by tool handlers
export interface ToolKernel {
  pipeline: Pipeline;
  search: SearchFusion;
  storage: BetterSqlite3Storage;
  registry: PluginRegistry;
  sessionId: string;
  config: ContextMemConfig;
  projectDir: string;
  budgetManager: BudgetManager;
  eventTracker: EventTracker;
  sessionManager: SessionManager;
  contentStore: ContentStore;
  knowledgeBase: KnowledgeBase;
  globalStore?: GlobalKnowledgeStore;
  knowledgeGraph?: KnowledgeGraph;
  agentRegistry?: AgentRegistry;
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema input schemas)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const toolDefinitions: ToolDefinition[] = [
  // Task 19 tools
  {
    name: 'observe',
    description: 'Store a new observation (content snippet) into context memory with automatic summarization.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content to observe and store' },
        type: {
          type: 'string',
          enum: ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'],
          description: 'Content type (default: context)',
        },
        source: { type: 'string', description: 'Source identifier (default: mcp)' },
        correlation_id: { type: 'string', description: 'Links related observations (e.g., same debugging session)' },
        files_modified: { type: 'array', items: { type: 'string' }, description: 'File paths modified in this observation' },
      },
      required: ['content'],
    },
  },
  {
    name: 'summarize',
    description: 'Summarize a piece of content using the matching summarizer plugin without storing it.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to summarize' },
      },
      required: ['content'],
    },
  },
  // Task 20 tools
  {
    name: 'search',
    description: 'Search stored observations using BM25 + trigram fusion.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: {
          type: 'string',
          enum: ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'],
          description: 'Filter by observation type',
        },
        limit: { type: 'number', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'timeline',
    description: 'Retrieve observations in reverse-chronological order with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'number', description: 'Start timestamp (ms since epoch)' },
        to: { type: 'number', description: 'End timestamp (ms since epoch)' },
        type: {
          type: 'string',
          enum: ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'],
          description: 'Filter by type',
        },
        session_id: { type: 'string', description: 'Filter by session ID' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
        anchor: { type: 'string', description: 'Observation ID to center the timeline on' },
        depth_before: { type: 'number', description: 'Number of observations before anchor (default 10)' },
        depth_after: { type: 'number', description: 'Number of observations after anchor (default 5)' },
      },
      required: [],
    },
  },
  {
    name: 'get',
    description: 'Retrieve a single observation by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Observation ID' },
      },
      required: ['id'],
    },
  },
  // Task 21 tools
  {
    name: 'stats',
    description: 'Get token economy statistics for the current session.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'configure',
    description: 'Update a mutable configuration key at runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Config key (e.g. "privacy.strip_tags")' },
        value: { description: 'New value for the config key' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'execute',
    description: 'Execute code in JavaScript, TypeScript, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, or Elixir.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to execute' },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python', 'shell', 'ruby', 'go', 'rust', 'php', 'perl', 'r', 'elixir'],
          description: 'Language hint',
        },
      },
      required: ['code'],
    },
  },
  // Content store tools
  {
    name: 'index_content',
    description: 'Index content into the content store with code-aware chunking for later search.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to index' },
        source: { type: 'string', description: 'Source identifier (e.g. file path, URL)' },
      },
      required: ['content', 'source'],
    },
  },
  {
    name: 'search_content',
    description: 'Search the content store for indexed content chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        source: { type: 'string', description: 'Filter by source' },
        limit: { type: 'number', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },
  // Knowledge base tools
  {
    name: 'save_knowledge',
    description: 'Save a knowledge entry with automatic contradiction detection. When contradictions are found, the save is blocked — resubmit with force: true to save anyway.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['pattern', 'decision', 'error', 'api', 'component'], description: 'Knowledge category' },
        title: { type: 'string', description: 'Short title' },
        content: { type: 'string', description: 'Knowledge content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        shareable: { type: 'boolean', description: 'Whether this knowledge can be shared (default: true)' },
        source_type: { type: 'string', enum: ['explicit', 'inferred', 'observed'], description: 'How this knowledge was obtained: explicit (user stated directly), inferred (AI derived from context), observed (captured automatically). Default: observed' },
        force: { type: 'boolean', description: 'Force save even when contradictions exist (default: false)' },
      },
      required: ['category', 'title', 'content'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the knowledge base using 3-layer search (FTS5 → trigram → scan). Optionally include global cross-project knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        category: { type: 'string', enum: ['pattern', 'decision', 'error', 'api', 'component'], description: 'Filter by category' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        include_global: { type: 'boolean', description: 'Also search global cross-project knowledge store and merge results (project results first). Default: false' },
      },
      required: ['query'],
    },
  },
  // Global knowledge tools
  {
    name: 'promote_knowledge',
    description: 'Promote a project knowledge entry to the global cross-project knowledge store. Privacy engine sanitizes content before storing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Knowledge entry ID to promote from project to global store' },
      },
      required: ['id'],
    },
  },
  {
    name: 'global_search',
    description: 'Search the global cross-project knowledge store.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        category: { type: 'string', enum: ['pattern', 'decision', 'error', 'api', 'component'], description: 'Filter by category' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
  },
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
  // Knowledge Graph tools
  {
    name: 'graph_query',
    description: 'Query the knowledge graph. Find entities and their relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name or ID to start from' },
        entity_type: { type: 'string', enum: [...ENTITY_TYPES], description: 'Filter by entity type' },
        relationship_type: { type: 'string', enum: [...RELATIONSHIP_TYPES], description: 'Filter by relationship type' },
        direction: { type: 'string', enum: ['in', 'out', 'both'], description: 'Relationship direction (default: both)' },
        depth: { type: 'number', description: 'Traversal depth (default: 1, max: 5)' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'add_relationship',
    description: 'Add a relationship between two entities in the knowledge graph. Creates entities if they do not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        from_name: { type: 'string', description: 'Source entity name' },
        from_type: { type: 'string', enum: [...ENTITY_TYPES], description: 'Source entity type' },
        to_name: { type: 'string', description: 'Target entity name' },
        to_type: { type: 'string', enum: [...ENTITY_TYPES], description: 'Target entity type' },
        relationship: { type: 'string', enum: [...RELATIONSHIP_TYPES], description: 'Relationship type' },
        weight: { type: 'number', description: 'Relationship strength 0-1 (default: 1.0)' },
      },
      required: ['from_name', 'from_type', 'to_name', 'to_type', 'relationship'],
    },
  },
  {
    name: 'graph_neighbors',
    description: 'Find all entities connected to a given entity. Faster than graph_query for simple lookups.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name or ID' },
        direction: { type: 'string', enum: ['in', 'out', 'both'], description: 'Direction (default: both)' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['entity'],
    },
  },
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
  // Natural Language Query tool
  {
    name: 'ask',
    description: 'Ask a natural language question about the project. Searches knowledge, observations, events, and graph entities.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural language question about the project' },
      },
      required: ['question'],
    },
  },
  // Contradiction Resolution
  {
    name: 'resolve_contradiction',
    description: 'Resolve a contradiction between knowledge entries by merging, superseding, or keeping both.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: 'ID of the entry to act on' },
        conflicting_id: { type: 'string', description: 'ID of the conflicting entry' },
        action: { type: 'string', enum: ['supersede', 'merge', 'keep_both', 'archive_old'], description: 'Resolution action' },
        merged_content: { type: 'string', description: 'New merged content (required for merge action)' },
      },
      required: ['entry_id', 'conflicting_id', 'action'],
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
// Tool handlers
// ---------------------------------------------------------------------------

// Task 19 — observe
export async function handleObserve(
  params: { content: string; type?: string; source?: string; correlation_id?: string; files_modified?: string[] },
  kernel: ToolKernel,
): Promise<{ id: string; summary: string | undefined; tokens_saved: number } | { error: string }> {
  if (!params.content || typeof params.content !== 'string') {
    return { error: 'content is required and must be a non-empty string' };
  }
  if (params.content.length > MAX_CONTENT_LENGTH) {
    return { error: `content exceeds maximum length of ${MAX_CONTENT_LENGTH} bytes` };
  }

  const type = validateObservationType(params.type);
  const source = params.source || 'mcp';

  const obs = await kernel.pipeline.observe(params.content, type, source, undefined, {
    correlation_id: params.correlation_id,
    files_modified: params.files_modified,
  });
  const tokensSaved = obs.metadata.tokens_original - obs.metadata.tokens_summarized;

  // Check budget and append warning if needed
  const budgetStatus = kernel.budgetManager.check(kernel.sessionId);
  const result: { id: string; summary: string | undefined; tokens_saved: number; budget_warning?: string } = {
    id: obs.id,
    summary: obs.summary,
    tokens_saved: tokensSaved,
  };

  if (budgetStatus.signal && budgetStatus.percentage >= 80) {
    result.budget_warning = budgetStatus.signal;
  }

  return result;
}

// Task 19 — summarize
export async function handleSummarize(
  params: { content: string },
  kernel: ToolKernel,
): Promise<{ summary: string; tokens_original: number; tokens_summarized: number; savings_pct: number } | { error: string }> {
  if (!params.content || typeof params.content !== 'string') {
    return { error: 'content is required and must be a non-empty string' };
  }
  if (params.content.length > MAX_CONTENT_LENGTH) {
    return { error: `content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` };
  }

  const summarizers = kernel.registry.getAll('summarizer') as SummarizerPlugin[];
  const matching = summarizers.find(s => s.detect(params.content));

  if (!matching) {
    // No summarizer matched — return raw content as summary
    const len = params.content.length;
    const tokens = Math.ceil(len / 4);
    return {
      summary: params.content,
      tokens_original: tokens,
      tokens_summarized: tokens,
      savings_pct: 0,
    };
  }

  const result = await matching.summarize(params.content, {});
  return {
    summary: result.summary,
    tokens_original: result.tokens_original,
    tokens_summarized: result.tokens_summarized,
    savings_pct: result.savings_pct,
  };
}

// Task 20 — search
export async function handleSearch(
  params: { query: string; type?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; title: string; snippet: string; relevance_score: number; timestamp: number }>> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  const opts: { type_filter?: ObservationType[]; limit?: number } = {
    limit: validateLimit(params.limit ?? 5),
  };
  if (params.type) {
    opts.type_filter = [validateObservationType(params.type)];
  }

  const results: SearchResult[] = await kernel.search.execute(params.query, opts);

  // Increment access_count for returned observations
  if (results.length > 0) {
    const ids = results.map(r => r.id).filter(id => !id.startsWith('__'));
    if (ids.length > 0) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        kernel.storage.exec(
          `UPDATE observations SET access_count = access_count + 1 WHERE id IN (${placeholders})`,
          ids,
        );
      } catch {
        // Non-critical: don't fail search if access_count update fails
      }
    }
  }

  return results.map(r => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    relevance_score: r.relevance_score,
    timestamp: r.timestamp,
  }));
}

// Task 20 — timeline
export interface TimelineEntry {
  id: string;
  type: string;
  summary: string | null;
  timestamp: number;
}

export async function handleTimeline(
  params: { from?: number; to?: number; type?: string; session_id?: string; limit?: number; anchor?: string; depth_before?: number; depth_after?: number },
  kernel: ToolKernel,
): Promise<TimelineEntry[]> {
  // Anchor mode: center timeline around a specific observation
  if (params.anchor) {
    const ignoredFilters = (['type', 'session_id', 'from', 'to'] as const).filter(k => params[k] !== undefined);
    const depthBefore = validateLimit(params.depth_before ?? 10);
    const depthAfter = validateLimit(params.depth_after ?? 5);

    // Get the anchor observation's timestamp
    const anchorRow = kernel.storage.prepare(
      'SELECT id, type, summary, indexed_at FROM observations WHERE id = ?'
    ).get(params.anchor) as { id: string; type: string; summary: string | null; indexed_at: number } | undefined;

    if (!anchorRow) {
      return [];
    }

    // Get observations before the anchor
    const beforeRows = kernel.storage.prepare(
      'SELECT id, type, summary, indexed_at FROM observations WHERE indexed_at < ? ORDER BY indexed_at DESC LIMIT ?'
    ).all(anchorRow.indexed_at, depthBefore) as Array<{
      id: string; type: string; summary: string | null; indexed_at: number;
    }>;

    // Get observations after the anchor
    const afterRows = kernel.storage.prepare(
      'SELECT id, type, summary, indexed_at FROM observations WHERE indexed_at > ? ORDER BY indexed_at ASC LIMIT ?'
    ).all(anchorRow.indexed_at, depthAfter) as Array<{
      id: string; type: string; summary: string | null; indexed_at: number;
    }>;

    // Combine: before (reversed to chronological) + anchor + after
    const allRows = [...beforeRows.reverse(), anchorRow, ...afterRows];

    const entries: TimelineEntry[] = [];

    if (ignoredFilters.length > 0) {
      entries.push({
        id: '_warning',
        type: 'warning',
        summary: `Anchor mode ignores these filters: ${ignoredFilters.join(', ')}`,
        timestamp: Date.now(),
      });
    }

    entries.push(...allRows.map(row => ({
      id: row.id,
      type: row.type,
      summary: row.id === anchorRow.id
        ? (row.summary ? `${row.summary} <- ANCHOR` : '<- ANCHOR')
        : row.summary,
      timestamp: row.indexed_at,
    })));

    return entries;
  }

  // Standard mode: reverse-chronological with filters
  const validFrom = validateTimestamp(params.from);
  const validTo = validateTimestamp(params.to);
  const validLimit = validateLimit(params.limit ?? 20);

  let sql = 'SELECT id, type, summary, indexed_at FROM observations WHERE 1=1';
  const queryParams: unknown[] = [];

  if (validFrom !== undefined) {
    sql += ' AND indexed_at >= ?';
    queryParams.push(validFrom);
  }
  if (validTo !== undefined) {
    sql += ' AND indexed_at <= ?';
    queryParams.push(validTo);
  }
  if (params.type) {
    sql += ' AND type = ?';
    queryParams.push(validateObservationType(params.type));
  }
  if (params.session_id) {
    sql += ' AND session_id = ?';
    queryParams.push(params.session_id);
  }

  sql += ' ORDER BY indexed_at DESC LIMIT ?';
  queryParams.push(validLimit);

  const rows = kernel.storage.prepare(sql).all(...queryParams) as Array<{
    id: string; type: string; summary: string | null; indexed_at: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    summary: row.summary,
    timestamp: row.indexed_at,
  }));
}

// Task 20 — get
export interface ObservationDetail {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
}

export async function handleGet(
  params: { id: string },
  kernel: ToolKernel,
): Promise<ObservationDetail | { error: string }> {
  if (!params.id || typeof params.id !== 'string') {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'id is required and must be a non-empty string' }) }], isError: true } as any;
  }

  const row = kernel.storage
    .prepare('SELECT id, type, content, summary, metadata FROM observations WHERE id = ?')
    .get(params.id) as { id: string; type: string; content: string; summary: string | null; metadata: string } | undefined;

  if (!row) {
    return { error: `Observation not found: ${params.id}` };
  }

  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    // malformed metadata — leave empty
  }

  return {
    id: row.id,
    type: row.type,
    content: row.content,
    summary: row.summary,
    metadata,
  };
}

// Task 21 — stats
export async function handleStats(
  _params: Record<string, never>,
  kernel: ToolKernel,
): Promise<TokenEconomics> {
  // Aggregate from token_stats table
  const countRow = kernel.storage
    .prepare('SELECT COUNT(*) as n FROM observations WHERE session_id = ?')
    .get(kernel.sessionId) as { n: number };

  const sizeRow = kernel.storage
    .prepare(
      "SELECT COALESCE(SUM(LENGTH(content)),0) as total_content, COALESCE(SUM(LENGTH(COALESCE(summary,''))),0) as total_summary FROM observations WHERE session_id = ?",
    )
    .get(kernel.sessionId) as { total_content: number; total_summary: number };

  const tokenRow = kernel.storage
    .prepare(
      "SELECT COALESCE(SUM(tokens_in),0) as tokens_in, COALESCE(SUM(tokens_out),0) as tokens_out, COALESCE(SUM(tokens_in - tokens_out),0) as saved FROM token_stats WHERE session_id = ? AND event_type = 'store'",
    )
    .get(kernel.sessionId) as { tokens_in: number; tokens_out: number; saved: number };

  const searchRow = kernel.storage
    .prepare(
      "SELECT COUNT(*) as n FROM token_stats WHERE session_id = ? AND event_type = 'discovery'",
    )
    .get(kernel.sessionId) as { n: number };

  const tokensIn = tokenRow.tokens_in || 0;
  const tokensSaved = tokenRow.saved || 0;
  const savingsPct = tokensIn > 0 ? Math.round((tokensSaved / tokensIn) * 100) : 0;

  return {
    session_id: kernel.sessionId,
    observations_stored: countRow.n,
    total_content_bytes: sizeRow.total_content,
    total_summary_bytes: sizeRow.total_summary,
    searches_performed: searchRow.n,
    discovery_tokens: tokenRow.tokens_out || 0,
    read_tokens: tokensIn,
    tokens_saved: tokensSaved,
    savings_percentage: savingsPct,
  };
}

const MUTABLE_CONFIG_KEYS = new Set([
  'privacy.strip_tags',
  'privacy.redact_patterns',
  'token_economics',
  'lifecycle.ttl_days',
  'lifecycle.max_observations',
  'lifecycle.cleanup_schedule',
]);

// Task 21 — configure
export async function handleConfigure(
  params: { key: string; value: unknown },
  kernel: ToolKernel,
): Promise<{ updated: boolean; key: string; value: unknown } | { error: string }> {
  // Reject prototype pollution keys
  const segments = params.key.split('.');
  for (const seg of segments) {
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') {
      return { error: `Forbidden config key segment: "${seg}"` };
    }
  }

  // Reject keys not in the allowlist
  if (!MUTABLE_CONFIG_KEYS.has(params.key)) {
    return { error: `Key "${params.key}" is not in the mutable config allowlist` };
  }

  // Apply mutable config updates via key path (deep clone to avoid mutating frozen config)
  const configClone = JSON.parse(JSON.stringify(kernel.config));
  const keys = segments;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = configClone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cursor[keys[i]] !== 'object' || cursor[keys[i]] === null) {
      cursor[keys[i]] = {};
    }
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = params.value;
  Object.assign(kernel, { config: configClone });

  return { updated: true, key: params.key, value: params.value };
}

const SENSITIVE_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

// Task 21 — execute
export async function handleExecute(
  params: { code: string; language?: string },
  kernel: ToolKernel,
): Promise<{ stdout: string; stderr: string; exit_code: number; duration_ms: number } | { error: string }> {
  if (params.code && params.code.length > MAX_CONTENT_LENGTH) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Code exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` }) }], isError: true } as any;
  }

  // Safety check: execute tool must be explicitly enabled
  if (!kernel.config.execute_enabled) {
    return { error: 'Execute tool is disabled. Set execute_enabled: true in .context-mem.json' };
  }

  const runtimes = kernel.registry.getAll('runtime') as RuntimePlugin[];

  if (runtimes.length === 0) {
    return { error: 'No runtime plugins available' };
  }

  // Find matching runtime by language hint
  let runtime: RuntimePlugin | undefined;
  if (params.language) {
    runtime = runtimes.find(r => r.language === params.language);
  }
  // Fall back to first available
  if (!runtime) {
    runtime = runtimes[0];
  }

  // Strip sensitive env vars before passing to runtime
  const safeEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_RE.test(key) && val !== undefined) {
      safeEnv[key] = val;
    }
  }

  try {
    const result = await runtime.execute(params.code, { env: safeEnv });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Content Store handlers
// ---------------------------------------------------------------------------

export async function handleIndexContent(
  params: { content: string; source: string },
  kernel: ToolKernel,
): Promise<{ source_id: number; source: string } | { error: string }> {
  if (!params.content || typeof params.content !== 'string') {
    return { error: 'content is required' };
  }
  if (!params.source || typeof params.source !== 'string') {
    return { error: 'source is required' };
  }
  if (params.content.length > MAX_CONTENT_LENGTH) {
    return { error: `content exceeds maximum length of ${MAX_CONTENT_LENGTH} bytes` };
  }

  const sourceId = kernel.contentStore.index(params.content, params.source);
  return { source_id: sourceId, source: params.source };
}

export async function handleSearchContent(
  params: { query: string; source?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ heading: string | null; content: string; has_code: boolean; source: string; relevance: number }>> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  return kernel.contentStore.search(params.query, {
    source: params.source,
    limit: validateLimit(params.limit ?? 5),
  });
}

// ---------------------------------------------------------------------------
// Knowledge Base handlers
// ---------------------------------------------------------------------------

const KNOWLEDGE_CATEGORIES = ['pattern', 'decision', 'error', 'api', 'component'] as const;

const SOURCE_TYPES = ['explicit', 'inferred', 'observed'] as const;

export async function handleSaveKnowledge(
  params: { category: string; title: string; content: string; tags?: string[]; shareable?: boolean; source_type?: string; force?: boolean },
  kernel: ToolKernel,
): Promise<{ id: string; category: string; title: string; source_type: string; contradictions: ContradictionWarning[] } | { blocked: boolean; contradictions: ContradictionWarning[]; message: string } | { error: string }> {
  if (!params.title || !params.content) {
    return { error: 'title and content are required' };
  }
  if (!(KNOWLEDGE_CATEGORIES as readonly string[]).includes(params.category)) {
    return { error: `Invalid category: "${params.category}". Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}` };
  }
  const category = params.category as KnowledgeCategory;

  const rawSourceType = params.source_type || 'observed';
  if (!(SOURCE_TYPES as readonly string[]).includes(rawSourceType)) {
    return { error: `Invalid source_type: "${rawSourceType}". Must be one of: ${SOURCE_TYPES.join(', ')}` };
  }
  const sourceType = rawSourceType as SourceType;

  // Check for contradictions before saving
  let contradictions: ContradictionWarning[] = [];
  try {
    contradictions = await kernel.knowledgeBase.checkContradictions(params.title, params.content, category);
  } catch (err) {
    return { error: `Contradiction check failed: ${(err as Error).message}` };
  }

  // Block save when contradictions exist unless force is strictly true
  const forceOverride = params.force === true;
  if (contradictions.length > 0 && !forceOverride) {
    return {
      blocked: true,
      contradictions,
      message: 'Similar knowledge entries found. Review contradictions and resubmit with force: true to save anyway.',
    };
  }

  try {
    const entry = kernel.knowledgeBase.save({
      category,
      title: params.title,
      content: params.content,
      tags: params.tags,
      shareable: params.shareable,
      source_type: sourceType,
    });

    return {
      id: entry.id,
      category: entry.category,
      title: entry.title,
      source_type: entry.source_type,
      contradictions,
      ...(forceOverride && contradictions.length > 0 ? { forced: true } : {}),
    };
  } catch (err) {
    return { error: `Failed to save knowledge entry: ${(err as Error).message}` };
  }
}

export async function handleSearchKnowledge(
  params: { query: string; category?: string; limit?: number; include_global?: boolean },
  kernel: ToolKernel,
): Promise<Array<{ id: string; category: string; title: string; content: string; relevance_score: number; tags: string[]; source_type: string; source_project?: string }> | { error: string }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }
  if (params.category !== undefined && !(KNOWLEDGE_CATEGORIES as readonly string[]).includes(params.category)) {
    return { error: `Invalid category: "${params.category}". Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}` };
  }
  const category = params.category as KnowledgeCategory | undefined;
  const limit = validateLimit(params.limit ?? 10);

  const results = kernel.knowledgeBase.search(params.query, {
    category,
    limit,
  });

  const mapped = results.map(r => ({
    id: r.id,
    category: r.category,
    title: r.title,
    content: r.content,
    relevance_score: r.relevance_score,
    tags: r.tags,
    source_type: r.source_type,
  }));

  // Merge global results when requested
  if (params.include_global && kernel.globalStore && kernel.config.global_knowledge?.enabled !== false) {
    try {
      const globalResults = kernel.globalStore.search(params.query, { category, limit });
      const projectIds = new Set(mapped.map(r => r.id));
      for (const gr of globalResults) {
        if (!projectIds.has(gr.id) && mapped.length < limit) {
          mapped.push({
            id: gr.id,
            category: gr.category,
            title: gr.title,
            content: gr.content,
            relevance_score: gr.relevance_score,
            tags: gr.tags,
            source_type: gr.source_type,
            source_project: gr.source_project,
          } as typeof mapped[number]);
        }
      }
    } catch {
      // Global store unavailable — return project results only
    }
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// Global Knowledge handlers
// ---------------------------------------------------------------------------

export async function handlePromoteKnowledge(
  params: { id: string },
  kernel: ToolKernel,
): Promise<{ id: string; global_id: string; source_project: string } | { error: string }> {
  if (!params.id || typeof params.id !== 'string') {
    return { error: 'id is required and must be a non-empty string' };
  }

  if (!kernel.globalStore) {
    return { error: 'Global knowledge store is not enabled' };
  }

  if (kernel.config.global_knowledge?.enabled === false) {
    return { error: 'Global knowledge is disabled in configuration' };
  }

  // Find entry in project knowledge base
  const entry = kernel.knowledgeBase.access(params.id);
  if (!entry) {
    return { error: `Knowledge entry not found: ${params.id}` };
  }

  // Determine project name from working directory
  const projectName = require('node:path').basename(process.cwd()) || 'unknown';

  try {
    const globalEntry = kernel.globalStore.promote(entry, projectName);
    return {
      id: params.id,
      global_id: globalEntry.id,
      source_project: globalEntry.source_project,
    };
  } catch (err) {
    return { error: `Failed to promote knowledge: ${(err as Error).message}` };
  }
}

export async function handleGlobalSearch(
  params: { query: string; category?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; category: string; title: string; content: string; relevance_score: number; tags: string[]; source_type: string; source_project: string }> | { error: string }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  if (!kernel.globalStore) {
    return { error: 'Global knowledge store is not enabled' };
  }

  if (kernel.config.global_knowledge?.enabled === false) {
    return { error: 'Global knowledge is disabled in configuration' };
  }

  if (params.category !== undefined && !(KNOWLEDGE_CATEGORIES as readonly string[]).includes(params.category)) {
    return { error: `Invalid category: "${params.category}". Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}` };
  }

  const category = params.category as KnowledgeCategory | undefined;

  const results = kernel.globalStore.search(params.query, {
    category,
    limit: validateLimit(params.limit ?? 10),
  });

  return results.map(r => ({
    id: r.id,
    category: r.category,
    title: r.title,
    content: r.content,
    relevance_score: r.relevance_score,
    tags: r.tags,
    source_type: r.source_type,
    source_project: r.source_project,
  }));
}

// ---------------------------------------------------------------------------
// Profile handlers
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

// ---------------------------------------------------------------------------
// Budget handlers
// ---------------------------------------------------------------------------

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

  kernel.budgetManager.configure(config as Partial<import('../core/types.js').BudgetConfig>);
  return { updated: true };
}

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Knowledge Graph handlers
// ---------------------------------------------------------------------------

function resolveEntity(
  graph: KnowledgeGraph,
  nameOrId: string,
): Entity | null {
  // Try by ID first
  const byId = graph.getEntity(nameOrId);
  if (byId) return byId;
  // Try by name
  const byName = graph.findEntity(nameOrId);
  return byName.length > 0 ? byName[0] : null;
}

export async function handleGraphQuery(
  params: { entity: string; entity_type?: string; relationship_type?: string; direction?: string; depth?: number },
  kernel: ToolKernel,
): Promise<GraphResult | { error: string }> {
  if (!kernel.knowledgeGraph) {
    return { error: 'Knowledge graph is not initialized' };
  }
  if (!params.entity || typeof params.entity !== 'string' || !params.entity.trim()) {
    return { error: 'entity is required and must be a non-empty string' };
  }

  // Validate entity_type if provided
  if (params.entity_type !== undefined && !(ENTITY_TYPES as readonly string[]).includes(params.entity_type)) {
    return { error: `Invalid entity_type: "${params.entity_type}". Must be one of: ${ENTITY_TYPES.join(', ')}` };
  }

  // Validate relationship_type if provided
  if (params.relationship_type !== undefined && !(RELATIONSHIP_TYPES as readonly string[]).includes(params.relationship_type)) {
    return { error: `Invalid relationship_type: "${params.relationship_type}". Must be one of: ${RELATIONSHIP_TYPES.join(', ')}` };
  }

  // Validate direction if provided
  const validDirections = ['in', 'out', 'both'];
  if (params.direction !== undefined && !validDirections.includes(params.direction)) {
    return { error: `Invalid direction: "${params.direction}". Must be one of: ${validDirections.join(', ')}` };
  }

  // Validate depth
  const depth = Math.max(1, Math.min(5, Number(params.depth) || 1));

  // Find entity by name or ID, optionally filtered by type
  let entity: Entity | null = null;
  if (params.entity_type) {
    const matches = kernel.knowledgeGraph.findEntity(params.entity, params.entity_type as EntityType);
    entity = matches.length > 0 ? matches[0] : null;
  }
  if (!entity) {
    entity = resolveEntity(kernel.knowledgeGraph, params.entity);
  }

  if (!entity) {
    return { error: `Entity not found: "${params.entity}"` };
  }

  // Use subgraph for deeper traversals, neighbors for depth=1
  if (depth > 1) {
    return kernel.knowledgeGraph.subgraph(entity.id, depth);
  }

  const result = kernel.knowledgeGraph.neighbors(entity.id, {
    direction: (params.direction as 'in' | 'out' | 'both') || 'both',
    type: params.relationship_type as RelationshipType | undefined,
    depth: 1,
  });

  return result;
}

export async function handleAddRelationship(
  params: { from_name: string; from_type: string; to_name: string; to_type: string; relationship: string; weight?: number },
  kernel: ToolKernel,
): Promise<{ relationship_id: string; from_entity: string; to_entity: string } | { error: string }> {
  if (!kernel.knowledgeGraph) {
    return { error: 'Knowledge graph is not initialized' };
  }

  // Validate required fields
  if (!params.from_name || typeof params.from_name !== 'string' || !params.from_name.trim()) {
    return { error: 'from_name is required and must be a non-empty string' };
  }
  if (!params.to_name || typeof params.to_name !== 'string' || !params.to_name.trim()) {
    return { error: 'to_name is required and must be a non-empty string' };
  }

  // Validate types
  if (!(ENTITY_TYPES as readonly string[]).includes(params.from_type)) {
    return { error: `Invalid from_type: "${params.from_type}". Must be one of: ${ENTITY_TYPES.join(', ')}` };
  }
  if (!(ENTITY_TYPES as readonly string[]).includes(params.to_type)) {
    return { error: `Invalid to_type: "${params.to_type}". Must be one of: ${ENTITY_TYPES.join(', ')}` };
  }
  if (!(RELATIONSHIP_TYPES as readonly string[]).includes(params.relationship)) {
    return { error: `Invalid relationship: "${params.relationship}". Must be one of: ${RELATIONSHIP_TYPES.join(', ')}` };
  }

  // Validate weight if provided
  if (params.weight !== undefined) {
    const w = Number(params.weight);
    if (!Number.isFinite(w) || w < 0 || w > 1) {
      return { error: 'weight must be a number between 0 and 1' };
    }
  }

  const fromType = params.from_type as EntityType;
  const toType = params.to_type as EntityType;
  const relType = params.relationship as RelationshipType;

  // Find or create from_entity
  let fromMatches = kernel.knowledgeGraph.findEntity(params.from_name, fromType);
  let fromEntity: Entity;
  if (fromMatches.length > 0) {
    fromEntity = fromMatches[0];
  } else {
    fromEntity = kernel.knowledgeGraph.addEntity(params.from_name, fromType);
  }

  // Find or create to_entity
  let toMatches = kernel.knowledgeGraph.findEntity(params.to_name, toType);
  let toEntity: Entity;
  if (toMatches.length > 0) {
    toEntity = toMatches[0];
  } else {
    toEntity = kernel.knowledgeGraph.addEntity(params.to_name, toType);
  }

  // Add relationship
  try {
    const rel = kernel.knowledgeGraph.addRelationship(fromEntity.id, toEntity.id, relType, {
      weight: params.weight,
    });
    return {
      relationship_id: rel.id,
      from_entity: fromEntity.id,
      to_entity: toEntity.id,
    };
  } catch (err) {
    return { error: `Failed to add relationship: ${(err as Error).message}` };
  }
}

export async function handleGraphNeighbors(
  params: { entity: string; direction?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ entity: Entity; relationship: Relationship }> | { error: string }> {
  if (!kernel.knowledgeGraph) {
    return { error: 'Knowledge graph is not initialized' };
  }
  if (!params.entity || typeof params.entity !== 'string' || !params.entity.trim()) {
    return { error: 'entity is required and must be a non-empty string' };
  }

  // Validate direction if provided
  const validDirections = ['in', 'out', 'both'];
  if (params.direction !== undefined && !validDirections.includes(params.direction)) {
    return { error: `Invalid direction: "${params.direction}". Must be one of: ${validDirections.join(', ')}` };
  }

  const entity = resolveEntity(kernel.knowledgeGraph, params.entity);
  if (!entity) {
    return { error: `Entity not found: "${params.entity}"` };
  }

  const limit = validateLimit(params.limit ?? 20);
  const direction = (params.direction as 'in' | 'out' | 'both') || 'both';

  const result = kernel.knowledgeGraph.neighbors(entity.id, {
    direction,
    depth: 1,
  });

  // Pair each neighbor entity with its relationship, limited
  const pairs: Array<{ entity: Entity; relationship: Relationship }> = [];
  for (const rel of result.relationships) {
    const neighborId = rel.from_entity === entity.id ? rel.to_entity : rel.from_entity;
    const neighborEntity = result.entities.find(e => e.id === neighborId);
    if (neighborEntity) {
      pairs.push({ entity: neighborEntity, relationship: rel });
    }
    if (pairs.length >= limit) break;
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Multi-Agent coordination handlers
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

// Time-Travel Debugging
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

// Natural Language Query
export async function handleAsk(
  params: { question: string },
  kernel: ToolKernel,
): Promise<unknown> {
  if (!params.question || typeof params.question !== 'string' || !params.question.trim()) {
    return { error: 'question is required and must be a non-empty string' };
  }

  const { NaturalLanguageQuery } = await import('../core/nl-query.js');
  const graph = kernel.knowledgeGraph ?? new (await import('../core/knowledge-graph.js')).KnowledgeGraph(kernel.storage);
  const nlQuery = new NaturalLanguageQuery(kernel.storage, kernel.knowledgeBase, graph, kernel.eventTracker);
  return nlQuery.ask(params.question.trim());
}

// Session Handoff
// ---------------------------------------------------------------------------
// Contradiction resolution
// ---------------------------------------------------------------------------

export async function handleResolveContradiction(
  params: { entry_id: string; conflicting_id: string; action: string; merged_content?: string },
  kernel: ToolKernel,
): Promise<{ resolved: true; action: string; archived?: string[]; created?: string; relationship_id?: string } | { error: string }> {
  // Validate required fields
  if (!params.entry_id || typeof params.entry_id !== 'string' || !params.entry_id.trim()) {
    return { error: 'entry_id is required and must be a non-empty string' };
  }
  if (!params.conflicting_id || typeof params.conflicting_id !== 'string' || !params.conflicting_id.trim()) {
    return { error: 'conflicting_id is required and must be a non-empty string' };
  }
  const VALID_ACTIONS = ['supersede', 'merge', 'keep_both', 'archive_old'] as const;
  if (!VALID_ACTIONS.includes(params.action as typeof VALID_ACTIONS[number])) {
    return { error: `Invalid action: "${params.action}". Must be one of: ${VALID_ACTIONS.join(', ')}` };
  }
  if (params.action === 'merge' && (!params.merged_content || typeof params.merged_content !== 'string' || !params.merged_content.trim())) {
    return { error: 'merged_content is required for merge action' };
  }

  const entry = kernel.knowledgeBase.getById(params.entry_id);
  if (!entry) {
    return { error: `Entry not found: ${params.entry_id}` };
  }
  const conflicting = kernel.knowledgeBase.getById(params.conflicting_id);
  if (!conflicting) {
    return { error: `Conflicting entry not found: ${params.conflicting_id}` };
  }

  const result: { resolved: true; action: string; archived?: string[]; created?: string; relationship_id?: string } = {
    resolved: true,
    action: params.action,
  };

  switch (params.action) {
    case 'supersede': {
      // Archive the old entry (conflicting_id), keep the new one (entry_id)
      kernel.knowledgeBase.archive(params.conflicting_id);
      kernel.knowledgeBase.addTags(params.entry_id, ['supersedes:' + params.conflicting_id]);
      result.archived = [params.conflicting_id];
      // Add graph relationship if available
      if (kernel.knowledgeGraph) {
        try {
          const fromEntity = kernel.knowledgeGraph.addEntity(entry.title, 'decision');
          const toEntity = kernel.knowledgeGraph.addEntity(conflicting.title, 'decision');
          const rel = kernel.knowledgeGraph.addRelationship(fromEntity.id, toEntity.id, 'supersedes');
          result.relationship_id = rel.id;
        } catch {
          // Graph relationship is non-critical
        }
      }
      break;
    }
    case 'merge': {
      // Create a new merged entry, archive both originals
      const merged = kernel.knowledgeBase.save({
        category: entry.category,
        title: entry.title,
        content: params.merged_content!,
        tags: Array.from(new Set([...entry.tags, ...conflicting.tags, 'merged'])),
        shareable: entry.shareable,
        source_type: entry.source_type,
      });
      kernel.knowledgeBase.archive(params.entry_id);
      kernel.knowledgeBase.archive(params.conflicting_id);
      result.archived = [params.entry_id, params.conflicting_id];
      result.created = merged.id;
      break;
    }
    case 'keep_both': {
      // Add 'reviewed' tag to both, marking them as non-contradicting
      kernel.knowledgeBase.addTags(params.entry_id, ['reviewed', 'non-contradicting']);
      kernel.knowledgeBase.addTags(params.conflicting_id, ['reviewed', 'non-contradicting']);
      // Add graph relationship if available
      if (kernel.knowledgeGraph) {
        try {
          const fromEntity = kernel.knowledgeGraph.addEntity(entry.title, 'decision');
          const toEntity = kernel.knowledgeGraph.addEntity(conflicting.title, 'decision');
          const rel = kernel.knowledgeGraph.addRelationship(fromEntity.id, toEntity.id, 'contradicts', { weight: 0.3 });
          result.relationship_id = rel.id;
        } catch {
          // Graph relationship is non-critical
        }
      }
      break;
    }
    case 'archive_old': {
      // Archive the conflicting_id entry
      kernel.knowledgeBase.archive(params.conflicting_id);
      result.archived = [params.conflicting_id];
      break;
    }
  }

  return result;
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
    read_tokens: 0,
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
