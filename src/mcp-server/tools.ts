import type { Pipeline } from '../core/pipeline.js';
import type { SearchFusion } from '../plugins/search/fusion.js';
import type { BetterSqlite3Storage } from '../plugins/storage/better-sqlite3.js';
import type {
  SummarizerPlugin,
  RuntimePlugin,
  ObservationType,
  TokenEconomics,
  SearchResult,
} from '../core/types.js';
import type { PluginRegistry } from '../core/plugin-registry.js';
import type { ContextMemConfig } from '../core/types.js';

// Minimal kernel interface used by tool handlers
export interface ToolKernel {
  pipeline: Pipeline;
  search: SearchFusion;
  storage: BetterSqlite3Storage;
  registry: PluginRegistry;
  sessionId: string;
  config: ContextMemConfig;
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
    description: 'Execute a code snippet using an available runtime plugin.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to execute' },
        language: { type: 'string', description: 'Language hint (e.g. "javascript", "python")' },
      },
      required: ['code'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

// Task 19 — observe
export async function handleObserve(
  params: { content: string; type?: string; source?: string },
  kernel: ToolKernel,
): Promise<{ id: string; summary: string | undefined; tokens_saved: number }> {
  const type = (params.type || 'context') as ObservationType;
  const source = params.source || 'mcp';

  const obs = await kernel.pipeline.observe(params.content, type, source);
  const tokensSaved = obs.metadata.tokens_original - obs.metadata.tokens_summarized;

  return {
    id: obs.id,
    summary: obs.summary,
    tokens_saved: tokensSaved,
  };
}

// Task 19 — summarize
export async function handleSummarize(
  params: { content: string },
  kernel: ToolKernel,
): Promise<{ summary: string; tokens_original: number; tokens_summarized: number; savings_pct: number }> {
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
  const opts: { type_filter?: ObservationType[]; limit?: number } = {
    limit: params.limit || 5,
  };
  if (params.type) {
    opts.type_filter = [params.type as ObservationType];
  }

  const results: SearchResult[] = await kernel.search.execute(params.query, opts);

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
  params: { from?: number; to?: number; type?: string; session_id?: string; limit?: number },
  kernel: ToolKernel,
): Promise<TimelineEntry[]> {
  let sql = 'SELECT id, type, summary, indexed_at FROM observations WHERE 1=1';
  const queryParams: unknown[] = [];

  if (params.from !== undefined) {
    sql += ' AND indexed_at >= ?';
    queryParams.push(params.from);
  }
  if (params.to !== undefined) {
    sql += ' AND indexed_at <= ?';
    queryParams.push(params.to);
  }
  if (params.type) {
    sql += ' AND type = ?';
    queryParams.push(params.type);
  }
  if (params.session_id) {
    sql += ' AND session_id = ?';
    queryParams.push(params.session_id);
  }

  sql += ' ORDER BY indexed_at DESC LIMIT ?';
  queryParams.push(params.limit || 20);

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
      "SELECT COUNT(*) as n FROM token_stats WHERE session_id = ? AND event_type = 'search'",
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

  // Apply mutable config updates via key path
  const keys = segments;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = kernel.config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cursor[keys[i]] !== 'object' || cursor[keys[i]] === null) {
      cursor[keys[i]] = {};
    }
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = params.value;

  return { updated: true, key: params.key, value: params.value };
}

const SENSITIVE_ENV_RE = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

// Task 21 — execute
export async function handleExecute(
  params: { code: string; language?: string },
  kernel: ToolKernel,
): Promise<{ stdout: string; stderr: string; exit_code: number; duration_ms: number } | { error: string }> {
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
