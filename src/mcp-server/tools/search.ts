import { sanitizeFTS5Query } from '../../plugins/search/fts5-utils.js';
import type { ObservationType, SearchResult } from '../../core/types.js';
import { type ToolKernel, type ToolDefinition, MAX_CONTENT_LENGTH, validateLimit, validateObservationType } from './shared.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface RecallResult {
  id: string;
  content: string;
  date: number;
  type: string;
  importance_score: number;
  flags: string[];
  compression_tier: string;
}

/**
 * Unified search parameters for the v4 `search` tool.
 *
 * scope:
 *   - 'observations' → BM25/fusion over the observations table (prior behaviour of `search`)
 *   - 'knowledge'    → knowledge-base search (prior behaviour of `search_knowledge`)
 *   - 'content'      → content-store chunk search (prior behaviour of `search_content`)
 *   - 'topics'       → topic-name match + associated observations (prior behaviour of `browse`)
 *   - 'all'          → all four in parallel, interleaved by score (default)
 *
 * mode:
 *   - 'hybrid'   → current fusion behaviour (default)
 *   - 'semantic' → bias toward vector + LLM judge when enabled
 *   - 'verbatim' → BM25 AND-mode + phrase matching (FTS content index)
 *   - 'temporal' → activate temporal resolver hint, date-sorted fallback
 *
 * cursor: accepted but returns null in v4.0 — full pagination in v4.1.
 */
export interface UnifiedSearchParams {
  query: string;
  scope?: 'observations' | 'knowledge' | 'content' | 'topics' | 'all';
  mode?: 'semantic' | 'verbatim' | 'temporal' | 'hybrid';
  filters?: {
    since?: number;
    until?: number;
    types?: string[];
    category?: string[];
    importance_min?: number;
    pinned?: boolean;
    entity?: string;
  };
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const searchToolDefinitions: ToolDefinition[] = [
  // v4 Unified search tool (Option A: replaces legacy `search` definition)
  {
    name: 'search',
    description: '[v4] Unified search across observations, knowledge, content, topics. Legacy search/search_knowledge/search_content/recall/browse/global_search/ask are aliased to this with deprecation _meta.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        scope: {
          type: 'string',
          enum: ['observations', 'knowledge', 'content', 'topics', 'all'],
          description: 'What to search (default: all)',
        },
        mode: {
          type: 'string',
          enum: ['semantic', 'verbatim', 'temporal', 'hybrid'],
          description: 'Search strategy (default: hybrid)',
        },
        filters: {
          type: 'object',
          description: 'Optional filters',
          properties: {
            since: { type: 'number', description: 'Only results after this timestamp (ms)' },
            until: { type: 'number', description: 'Only results before this timestamp (ms)' },
            types: { type: 'array', items: { type: 'string' }, description: 'Observation type filter' },
            category: { type: 'array', items: { type: 'string' }, description: 'Knowledge category filter' },
            importance_min: { type: 'number', description: 'Minimum importance score (0.0-1.0)' },
            pinned: { type: 'boolean', description: 'Only pinned observations' },
            entity: { type: 'string', description: 'Filter/boost by entity name' },
          },
        },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        cursor: { type: 'string', description: 'Pagination cursor (stub in v4.0, fully implemented in v4.1)' },
        // Legacy parameters kept for backwards compatibility
        type: {
          type: 'string',
          enum: ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'],
          description: '(Legacy) Filter by observation type — use filters.types instead',
        },
        verbatim: { type: 'boolean', description: '(Legacy) When true, return verbatim content — use mode: verbatim instead' },
      },
      required: ['query'],
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
    name: 'search_knowledge',
    description: 'Search the knowledge base using 3-layer search (FTS5 → trigram → scan). Optionally include global cross-project knowledge. By default only returns currently-valid facts (valid_to IS NULL).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        category: { type: 'string', enum: ['pattern', 'decision', 'error', 'api', 'component'], description: 'Filter by category' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        include_global: { type: 'boolean', description: 'Also search global cross-project knowledge store and merge results (project results first). Default: false' },
        include_superseded: { type: 'boolean', description: 'Include superseded/expired facts. Default: false' },
      },
      required: ['query'],
    },
  },
  // Total Recall — Verbatim Recall
  {
    name: 'recall',
    description: 'Verbatim memory retrieval with importance filtering and rich attribution. Returns original content, not summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for original content' },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow results',
          properties: {
            type: {
              type: 'string',
              enum: ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'],
              description: 'Filter by observation type',
            },
            time_range: {
              type: 'object',
              properties: {
                from: { type: 'number', description: 'Start timestamp (ms since epoch)' },
                to: { type: 'number', description: 'End timestamp (ms since epoch)' },
              },
            },
            importance_min: { type: 'number', description: 'Minimum importance score (0.0-1.0)' },
            flags: {
              type: 'array',
              items: { type: 'string', enum: ['DECISION', 'ORIGIN', 'PIVOT', 'CORE', 'MILESTONE', 'PROBLEM'] },
              description: 'Required significance flags',
            },
          },
        },
        limit: { type: 'number', description: 'Max results (default: 5)' },
      },
      required: ['query'],
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
  // Total Recall — Browse & Topics
  {
    name: 'browse',
    description: 'Browse observations by topic, person, or time dimension.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', enum: ['topic', 'person', 'time'], description: 'Dimension to browse by' },
        value: { type: 'string', description: 'Value to filter (topic name, person name, or ISO date)' },
        verbatim: { type: 'boolean', description: 'Return original content instead of summaries' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['dimension', 'value'],
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const KNOWLEDGE_CATEGORIES = ['pattern', 'decision', 'error', 'api', 'component'] as const;

// ---------------------------------------------------------------------------
// Unified search handler (v4 T4.2)
// ---------------------------------------------------------------------------

type UnifiedSearchResult = {
  id: string;
  title: string;
  snippet: string;
  relevance_score: number;
  timestamp: number;
  _source?: string; // which scope produced this result
  [key: string]: unknown;
};

/**
 * Core implementation for the unified `search` tool.
 * All legacy tool handlers delegate here and tag their response with _meta.deprecated.
 *
 * cursor is accepted but always returns null in v4.0.
 * Full cursor-based pagination will be implemented in v4.1.
 */
export async function handleSearchUnified(
  params: UnifiedSearchParams,
  kernel: ToolKernel,
): Promise<{ results: UnifiedSearchResult[]; cursor: string | null; _meta: Record<string, unknown> }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return {
      results: [],
      cursor: null,
      _meta: { error: 'query must be a non-empty string', scope: params.scope ?? 'all', mode: params.mode ?? 'hybrid', filters_applied: params.filters ?? {} },
    };
  }

  const scope = params.scope ?? 'all';
  const mode = params.mode ?? 'hybrid';
  const limit = validateLimit(params.limit ?? 10);
  const filters = params.filters ?? {};

  // Build effective query — prepend entity name if provided
  const effectiveQuery = filters.entity ? `${filters.entity} ${params.query}` : params.query;

  // Run the appropriate search branches
  const [obsResults, kbResults, contentResults, topicResults] = await Promise.all([
    (scope === 'observations' || scope === 'all') ? searchObservations(effectiveQuery, mode, filters, limit, kernel) : Promise.resolve([] as UnifiedSearchResult[]),
    (scope === 'knowledge' || scope === 'all') ? searchKnowledge(effectiveQuery, filters, limit, kernel) : Promise.resolve([] as UnifiedSearchResult[]),
    (scope === 'content' || scope === 'all') ? searchContent(effectiveQuery, filters, limit, kernel) : Promise.resolve([] as UnifiedSearchResult[]),
    (scope === 'topics' || scope === 'all') ? searchTopics(effectiveQuery, filters, limit, kernel) : Promise.resolve([] as UnifiedSearchResult[]),
  ]);

  let results: UnifiedSearchResult[];

  if (scope === 'all') {
    // Interleave by score — merge all, sort descending by relevance_score, cap at limit
    const merged = [...obsResults, ...kbResults, ...contentResults, ...topicResults];
    merged.sort((a, b) => b.relevance_score - a.relevance_score);
    results = merged.slice(0, limit);
  } else if (scope === 'observations') {
    results = obsResults.slice(0, limit);
  } else if (scope === 'knowledge') {
    results = kbResults.slice(0, limit);
  } else if (scope === 'content') {
    results = contentResults.slice(0, limit);
  } else {
    // topics
    results = topicResults.slice(0, limit);
  }

  return {
    results,
    cursor: null, // v4.1 will implement real pagination
    _meta: {
      scope,
      mode,
      filters_applied: filters,
    },
  };
}

/** Search observations table using BM25/fusion or verbatim FTS depending on mode. */
async function searchObservations(
  query: string,
  mode: string,
  filters: UnifiedSearchParams['filters'],
  limit: number,
  kernel: ToolKernel,
): Promise<UnifiedSearchResult[]> {
  const since = filters?.since;
  const until = filters?.until;
  const types = filters?.types;
  const importanceMin = filters?.importance_min;
  const pinned = filters?.pinned;

  if (mode === 'verbatim') {
    // FTS content index search
    let sql = `
      SELECT o.id, o.type, o.content, o.indexed_at, o.importance_score,
             bm25(obs_content_fts) as relevance
      FROM obs_content_fts
      JOIN observations o ON o.rowid = obs_content_fts.rowid
      WHERE obs_content_fts MATCH ?
    `;
    const sqlParams: unknown[] = [sanitizeFTS5Query(query)];

    if (types && types.length === 1) {
      sql += ' AND o.type = ?';
      sqlParams.push(validateObservationType(types[0]));
    }
    if (since) { sql += ' AND o.indexed_at >= ?'; sqlParams.push(since); }
    if (until) { sql += ' AND o.indexed_at <= ?'; sqlParams.push(until); }
    if (importanceMin !== undefined && importanceMin > 0) { sql += ' AND o.importance_score >= ?'; sqlParams.push(importanceMin); }
    if (pinned) { sql += ' AND o.pinned = 1'; }

    sql += ' ORDER BY bm25(obs_content_fts) LIMIT ?';
    sqlParams.push(limit);

    try {
      const rows = kernel.storage.prepare(sql).all(...sqlParams) as Array<{
        id: string; type: string; content: string; indexed_at: number; importance_score: number; relevance: number;
      }>;
      incrementAccessCount(rows.map(r => r.id), kernel);
      return rows.map(r => ({
        id: r.id,
        title: r.content.slice(0, 100),
        snippet: r.content,
        relevance_score: Math.abs(r.relevance),
        timestamp: r.indexed_at,
        _source: 'observations',
      }));
    } catch {
      return [];
    }
  }

  // hybrid / semantic / temporal — use fusion
  let searchQuery = query;
  if (kernel.llmService) {
    try {
      const expansion = await kernel.llmService.expandQuery(query);
      if (expansion) searchQuery = [expansion.original, ...expansion.expanded].join(' ');
    } catch { /* non-critical */ }
  }

  const opts: import('../../core/types.js').SearchOpts = {
    limit,
    ...(types && types.length > 0 ? { type_filter: types.map(validateObservationType) } : {}),
    ...(mode === 'temporal' ? { referenceDate: Date.now() } : {}),
  };

  let results: SearchResult[] = await kernel.search.execute(searchQuery, opts);

  // Post-filter
  if (since) results = results.filter(r => r.timestamp >= since);
  if (until) results = results.filter(r => r.timestamp <= until);
  if (importanceMin !== undefined && importanceMin > 0) {
    results = results.filter(r => {
      try {
        const row = kernel.storage.prepare('SELECT importance_score FROM observations WHERE id = ?').get(r.id) as { importance_score: number } | undefined;
        return row ? row.importance_score >= importanceMin : true;
      } catch { return true; }
    });
  }
  if (pinned) {
    results = results.filter(r => {
      try {
        const row = kernel.storage.prepare('SELECT pinned FROM observations WHERE id = ?').get(r.id) as { pinned: number } | undefined;
        return row ? row.pinned === 1 : false;
      } catch { return false; }
    });
  }

  const ids = results.map(r => r.id).filter(id => !id.startsWith('__'));
  incrementAccessCount(ids, kernel);
  if (kernel.feedbackEngine && ids.length > 0) {
    try { kernel.feedbackEngine.trackSearchResults(ids); } catch { /* non-critical */ }
  }

  return results.map(r => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    relevance_score: r.relevance_score,
    timestamp: r.timestamp,
    _source: 'observations',
  }));
}

/** Search knowledge base entries. */
async function searchKnowledge(
  query: string,
  filters: UnifiedSearchParams['filters'],
  limit: number,
  kernel: ToolKernel,
): Promise<UnifiedSearchResult[]> {
  try {
    const categories = filters?.category;
    // Use first category if provided (knowledge base search takes one category at a time)
    const category = categories && categories.length > 0
      ? categories[0] as import('../../core/types.js').KnowledgeCategory
      : undefined;

    const raw = kernel.knowledgeBase.search(query, { category, limit: limit * 2 }, kernel.sessionId);

    // Filter out superseded
    let filtered = raw;
    if (raw.length > 0) {
      const ids = raw.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      try {
        const superseded = new Set(
          (kernel.storage.prepare(`SELECT id FROM knowledge WHERE id IN (${placeholders}) AND valid_to IS NOT NULL`).all(...ids) as Array<{ id: string }>).map(r => r.id)
        );
        filtered = raw.filter(r => !superseded.has(r.id)).slice(0, limit);
      } catch { filtered = raw.slice(0, limit); }
    }

    // Post-filter by multiple categories if provided
    if (categories && categories.length > 1) {
      filtered = filtered.filter(r => categories.includes(r.category));
    }

    return filtered.map(r => ({
      id: r.id,
      title: r.title,
      snippet: r.content,
      relevance_score: r.relevance_score,
      timestamp: 0,
      category: r.category,
      tags: r.tags,
      source_type: r.source_type,
      _source: 'knowledge',
    }));
  } catch {
    return [];
  }
}

/** Search content store chunks. */
async function searchContent(
  query: string,
  _filters: UnifiedSearchParams['filters'],
  limit: number,
  kernel: ToolKernel,
): Promise<UnifiedSearchResult[]> {
  try {
    const results = await kernel.contentStore.search(query, { limit });
    return results.map((r, i) => ({
      id: `__content_${i}__`,
      title: r.heading ?? r.content.slice(0, 80),
      snippet: r.content,
      relevance_score: r.relevance ?? 0,
      timestamp: 0,
      heading: r.heading,
      has_code: r.has_code,
      source: r.source,
      _source: 'content',
    }));
  } catch {
    return [];
  }
}

/** Search topics by name match, returning associated observations. */
async function searchTopics(
  query: string,
  filters: UnifiedSearchParams['filters'],
  limit: number,
  kernel: ToolKernel,
): Promise<UnifiedSearchResult[]> {
  try {
    const rows = kernel.storage.prepare(`
      SELECT o.id, o.type, o.summary as text_val, o.indexed_at, o.importance_score, t.name as topic_name
      FROM observation_topics ot
      JOIN topics t ON t.id = ot.topic_id
      JOIN observations o ON o.id = ot.observation_id
      WHERE t.name LIKE ?
      ORDER BY o.importance_score DESC, o.indexed_at DESC
      LIMIT ?
    `).all(`%${query}%`, limit) as Array<{ id: string; type: string; text_val: string; indexed_at: number; importance_score: number; topic_name: string }>;

    // Post-filter timestamps if provided
    const since = filters?.since;
    const until = filters?.until;
    let filtered = rows;
    if (since) filtered = filtered.filter(r => r.indexed_at >= since);
    if (until) filtered = filtered.filter(r => r.indexed_at <= until);

    return filtered.map(r => ({
      id: r.id,
      title: r.text_val?.slice(0, 100) ?? r.topic_name,
      snippet: r.text_val ?? '',
      relevance_score: r.importance_score ?? 0,
      timestamp: r.indexed_at,
      topic: r.topic_name,
      _source: 'topics',
    }));
  } catch {
    return [];
  }
}

function incrementAccessCount(ids: string[], kernel: ToolKernel): void {
  const clean = ids.filter(id => !id.startsWith('__'));
  if (clean.length === 0) return;
  try {
    const placeholders = clean.map(() => '?').join(',');
    kernel.storage.exec(`UPDATE observations SET access_count = access_count + 1 WHERE id IN (${placeholders})`, clean);
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Task 20 — search (legacy alias, delegates to handleSearchUnified)
// ---------------------------------------------------------------------------
export async function handleSearch(
  params: { query: string; type?: string; limit?: number; verbatim?: boolean },
  kernel: ToolKernel,
): Promise<Array<{ id: string; title: string; snippet: string; relevance_score: number; timestamp: number }> & { _meta?: Record<string, unknown> }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  const unified = await handleSearchUnified({
    query: params.query,
    scope: 'observations',
    mode: params.verbatim ? 'verbatim' : 'hybrid',
    filters: params.type ? { types: [params.type] } : undefined,
    limit: params.limit ?? 5,
  }, kernel);

  const results = unified.results.map(r => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    relevance_score: r.relevance_score,
    timestamp: r.timestamp,
  }));

  return Object.assign(results, {
    _meta: {
      deprecated: true,
      replacement: 'search',
      replacement_params: { query: params.query, scope: 'observations', mode: params.verbatim ? 'verbatim' : 'hybrid' },
      removal_planned: 'v5.0.0',
    },
  });
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
): Promise<Array<{ heading: string | null; content: string; has_code: boolean; source: string; relevance: number }> & { _meta?: Record<string, unknown> }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  const results = await kernel.contentStore.search(params.query, {
    source: params.source,
    limit: validateLimit(params.limit ?? 5),
  });

  return Object.assign(results, {
    _meta: {
      deprecated: true,
      replacement: 'search',
      replacement_params: { query: params.query, scope: 'content', mode: 'hybrid' },
      removal_planned: 'v5.0.0',
    },
  });
}

// ---------------------------------------------------------------------------
// Knowledge Base search handler
// ---------------------------------------------------------------------------

export async function handleSearchKnowledge(
  params: { query: string; category?: string; limit?: number; include_global?: boolean; include_superseded?: boolean },
  kernel: ToolKernel,
): Promise<Array<{ id: string; category: string; title: string; content: string; relevance_score: number; tags: string[]; source_type: string; source_project?: string }> | { error: string }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }
  if (params.category !== undefined && !(KNOWLEDGE_CATEGORIES as readonly string[]).includes(params.category)) {
    return { error: `Invalid category: "${params.category}". Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}` };
  }
  const category = params.category as import('../../core/types.js').KnowledgeCategory | undefined;
  const limit = validateLimit(params.limit ?? 10);

  const results = kernel.knowledgeBase.search(params.query, {
    category,
    limit: params.include_superseded ? limit : limit * 2, // fetch extra to compensate for filtering
  }, kernel.sessionId);

  // Filter out superseded entries unless explicitly requested
  let filteredResults = results;
  if (!params.include_superseded && results.length > 0) {
    // Single query instead of N+1 per-result lookups
    const ids = results.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    try {
      const superseded = new Set(
        (kernel.storage.prepare(
          `SELECT id FROM knowledge WHERE id IN (${placeholders}) AND valid_to IS NOT NULL`
        ).all(...ids) as Array<{ id: string }>).map(r => r.id)
      );
      filteredResults = results.filter(r => !superseded.has(r.id)).slice(0, limit);
    } catch {
      filteredResults = results.slice(0, limit); // include all on error
    }
  }

  const mapped = filteredResults.map(r => ({
    id: r.id,
    category: r.category,
    title: r.title,
    content: r.content,
    relevance_score: r.relevance_score,
    tags: r.tags,
    source_type: r.source_type,
    confidence: kernel.knowledgeBase.computeConfidence(r),
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
            confidence: 0.5,
            source_project: gr.source_project,
          } as typeof mapped[number]);
        }
      }
    } catch {
      // Global store unavailable — return project results only
    }
  }

  return Object.assign(mapped, {
    _meta: {
      deprecated: true,
      replacement: 'search',
      replacement_params: { query: params.query, scope: 'knowledge', mode: 'hybrid' },
      removal_planned: 'v5.0.0',
    },
  });
}

// Total Recall — Recall handler
export async function handleRecall(
  params: { query: string; filters?: { type?: string; time_range?: { from?: number; to?: number }; importance_min?: number; flags?: string[] }; limit?: number },
  kernel: ToolKernel,
): Promise<(RecallResult[] & { _meta?: Record<string, unknown> }) | { error: string }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { error: 'query is required and must be a non-empty string' };
  }

  const limit = validateLimit(params.limit ?? 5);

  // Search content FTS index for verbatim results
  let sql = `
    SELECT o.id, o.type, o.content, o.indexed_at, o.importance_score, o.pinned, o.compression_tier, o.metadata,
           bm25(obs_content_fts) as relevance
    FROM obs_content_fts
    JOIN observations o ON o.rowid = obs_content_fts.rowid
    WHERE obs_content_fts MATCH ?
  `;
  const sqlParams: unknown[] = [sanitizeFTS5Query(params.query)];

  // Apply filters
  if (params.filters?.type) {
    sql += ' AND o.type = ?';
    sqlParams.push(validateObservationType(params.filters.type));
  }
  if (params.filters?.time_range?.from) {
    sql += ' AND o.indexed_at >= ?';
    sqlParams.push(params.filters.time_range.from);
  }
  if (params.filters?.time_range?.to) {
    sql += ' AND o.indexed_at <= ?';
    sqlParams.push(params.filters.time_range.to);
  }
  if (params.filters?.importance_min !== undefined && params.filters.importance_min > 0) {
    sql += ' AND o.importance_score >= ?';
    sqlParams.push(params.filters.importance_min);
  }

  sql += ' ORDER BY bm25(obs_content_fts) LIMIT ?';
  sqlParams.push(limit);

  try {
    const rows = kernel.storage.prepare(sql).all(...sqlParams) as Array<{
      id: string; type: string; content: string; indexed_at: number;
      importance_score: number; compression_tier: string; metadata: string;
    }>;

    // Post-filter by flags (stored in metadata JSON)
    let results = rows.map(row => {
      let flags: string[] = [];
      try {
        const meta = JSON.parse(row.metadata);
        flags = meta.significance_flags || [];
      } catch { /* ignore parse errors */ }

      return {
        id: row.id,
        content: row.content,
        date: row.indexed_at,
        type: row.type,
        importance_score: row.importance_score,
        flags,
        compression_tier: row.compression_tier,
      };
    });

    // Filter by required flags if specified
    if (params.filters?.flags && params.filters.flags.length > 0) {
      const requiredFlags = new Set(params.filters.flags);
      results = results.filter(r => r.flags.some(f => requiredFlags.has(f)));
    }

    return Object.assign(results, {
      _meta: {
        deprecated: true,
        replacement: 'search',
        replacement_params: { query: params.query, scope: 'observations', mode: 'verbatim' },
        removal_planned: 'v5.0.0',
      },
    });
  } catch {
    return [];
  }
}

// Natural Language Query
export async function handleAsk(
  params: { question: string },
  kernel: ToolKernel,
): Promise<unknown> {
  if (!params.question || typeof params.question !== 'string' || !params.question.trim()) {
    return { error: 'question is required and must be a non-empty string' };
  }

  const { NaturalLanguageQuery } = await import('../../core/nl-query.js');
  const graph = kernel.knowledgeGraph ?? new (await import('../../core/knowledge-graph.js')).KnowledgeGraph(kernel.storage);
  const nlQuery = new NaturalLanguageQuery(kernel.storage, kernel.knowledgeBase, graph, kernel.eventTracker);
  const result = await nlQuery.ask(params.question.trim());

  // Add deprecation _meta without breaking the existing response shape
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return {
      ...(result as unknown as Record<string, unknown>),
      _meta: {
        deprecated: true,
        replacement: 'search',
        replacement_params: { query: params.question, scope: 'all', mode: 'semantic' },
        removal_planned: 'v5.0.0',
      },
    };
  }
  return result;
}

// Total Recall — Browse & Topics handlers
export async function handleBrowse(
  params: { dimension: string; value: string; verbatim?: boolean; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; type: string; text: string; timestamp: number; importance_score: number }> & { _meta?: Record<string, unknown> }> {
  const limit = validateLimit(params.limit ?? 10);
  const textCol = params.verbatim ? 'content' : 'summary';

  try {
    let rows: Array<{ id: string; type: string; text_val: string; indexed_at: number; importance_score: number }> = [];
    switch (params.dimension) {
      case 'topic': {
        rows = kernel.storage.prepare(`
          SELECT o.id, o.type, o.${textCol} as text_val, o.indexed_at, o.importance_score
          FROM observation_topics ot
          JOIN topics t ON t.id = ot.topic_id
          JOIN observations o ON o.id = ot.observation_id
          WHERE t.name = ?
          ORDER BY o.importance_score DESC, o.indexed_at DESC
          LIMIT ?
        `).all(params.value, limit) as typeof rows;
        break;
      }
      case 'person': {
        rows = kernel.storage.prepare(`
          SELECT o.id, o.type, o.${textCol} as text_val, o.indexed_at, o.importance_score
          FROM observations o
          WHERE o.metadata LIKE ?
          ORDER BY o.importance_score DESC, o.indexed_at DESC
          LIMIT ?
        `).all(`%${params.value}%`, limit) as typeof rows;
        break;
      }
      case 'time': {
        const ts = new Date(params.value).getTime();
        if (isNaN(ts)) return [];
        const dayStart = ts;
        const dayEnd = ts + 24 * 60 * 60 * 1000;
        rows = kernel.storage.prepare(`
          SELECT id, type, ${textCol} as text_val, indexed_at, importance_score
          FROM observations
          WHERE indexed_at >= ? AND indexed_at < ?
          ORDER BY importance_score DESC, indexed_at DESC
          LIMIT ?
        `).all(dayStart, dayEnd, limit) as typeof rows;
        break;
      }
      default:
        return [];
    }

    const results = rows.map(r => ({ id: r.id, type: r.type, text: r.text_val || '', timestamp: r.indexed_at, importance_score: r.importance_score }));
    return Object.assign(results, {
      _meta: {
        deprecated: true,
        replacement: 'search',
        replacement_params: { query: params.value, scope: 'topics', mode: 'hybrid' },
        removal_planned: 'v5.0.0',
      },
    });
  } catch {
    return [];
  }
}
