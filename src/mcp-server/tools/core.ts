import type { SummarizerPlugin, RuntimePlugin, TokenEconomics } from '../../core/types.js';
import { type ToolKernel, type ToolDefinition, MAX_CONTENT_LENGTH, validateLimit, validateTimestamp, validateObservationType } from './shared.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  id: string;
  type: string;
  summary: string | null;
  timestamp: number;
}

export interface ObservationDetail {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const coreToolDefinitions: ToolDefinition[] = [
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
        verbatim: { type: 'boolean', description: 'When true, return original content instead of summaries' },
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
];

// ---------------------------------------------------------------------------
// Handlers
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

// Task 20 — timeline
export async function handleTimeline(
  params: { from?: number; to?: number; type?: string; session_id?: string; limit?: number; anchor?: string; depth_before?: number; depth_after?: number; verbatim?: boolean },
  kernel: ToolKernel,
): Promise<TimelineEntry[]> {
  const textCol = params.verbatim ? 'content' : 'summary';

  // Anchor mode: center timeline around a specific observation
  if (params.anchor) {
    const ignoredFilters = (['type', 'session_id', 'from', 'to'] as const).filter(k => params[k] !== undefined);
    const depthBefore = validateLimit(params.depth_before ?? 10);
    const depthAfter = validateLimit(params.depth_after ?? 5);

    // Get the anchor observation's timestamp
    const anchorRow = kernel.storage.prepare(
      `SELECT id, type, ${textCol} as text_val, indexed_at FROM observations WHERE id = ?`
    ).get(params.anchor) as { id: string; type: string; text_val: string | null; indexed_at: number } | undefined;

    if (!anchorRow) {
      return [];
    }

    // Get observations before the anchor
    const beforeRows = kernel.storage.prepare(
      `SELECT id, type, ${textCol} as text_val, indexed_at FROM observations WHERE indexed_at < ? ORDER BY indexed_at DESC LIMIT ?`
    ).all(anchorRow.indexed_at, depthBefore) as Array<{
      id: string; type: string; text_val: string | null; indexed_at: number;
    }>;

    // Get observations after the anchor
    const afterRows = kernel.storage.prepare(
      `SELECT id, type, ${textCol} as text_val, indexed_at FROM observations WHERE indexed_at > ? ORDER BY indexed_at ASC LIMIT ?`
    ).all(anchorRow.indexed_at, depthAfter) as Array<{
      id: string; type: string; text_val: string | null; indexed_at: number;
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
        ? (row.text_val ? `${row.text_val} <- ANCHOR` : '<- ANCHOR')
        : row.text_val,
      timestamp: row.indexed_at,
    })));

    return entries;
  }

  // Standard mode: reverse-chronological with filters
  const validFrom = validateTimestamp(params.from);
  const validTo = validateTimestamp(params.to);
  const validLimit = validateLimit(params.limit ?? 20);

  let sql = `SELECT id, type, ${textCol} as text_val, indexed_at FROM observations WHERE 1=1`;
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
    id: string; type: string; text_val: string | null; indexed_at: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    summary: row.text_val,
    timestamp: row.indexed_at,
  }));
}

// Task 20 — get
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
    stored_tokens: tokensIn,
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
