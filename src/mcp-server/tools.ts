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
} from '../core/types.js';
import { OBSERVATION_TYPES } from '../core/types.js';
import type { PluginRegistry } from '../core/plugin-registry.js';
import type { ContextMemConfig } from '../core/types.js';
import type { BudgetManager } from '../core/budget.js';
import type { EventTracker } from '../core/events.js';
import type { SessionManager } from '../core/session.js';
import type { ContentStore } from '../plugins/storage/content-store.js';
import type { KnowledgeBase } from '../plugins/knowledge/knowledge-base.js';

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
  budgetManager: BudgetManager;
  eventTracker: EventTracker;
  sessionManager: SessionManager;
  contentStore: ContentStore;
  knowledgeBase: KnowledgeBase;
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
    description: 'Search the knowledge base using 3-layer search (FTS5 → trigram → scan).',
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

    return allRows.map(row => ({
      id: row.id,
      type: row.type,
      summary: row.id === anchorRow.id
        ? (row.summary ? `${row.summary} <- ANCHOR` : '<- ANCHOR')
        : row.summary,
      timestamp: row.indexed_at,
    }));
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
  params: { query: string; category?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; category: string; title: string; content: string; relevance_score: number; tags: string[]; source_type: string }> | { error: string }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }
  if (params.category !== undefined && !(KNOWLEDGE_CATEGORIES as readonly string[]).includes(params.category)) {
    return { error: `Invalid category: "${params.category}". Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}` };
  }
  const category = params.category as KnowledgeCategory | undefined;

  const results = kernel.knowledgeBase.search(params.query, {
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

  const result = kernel.sessionManager.restoreSnapshot(sessionId);
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
