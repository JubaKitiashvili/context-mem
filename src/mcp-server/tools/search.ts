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

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const searchToolDefinitions: ToolDefinition[] = [
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
        verbatim: { type: 'boolean', description: 'When true, search original content and return verbatim text instead of summaries' },
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

// Task 20 — search
export async function handleSearch(
  params: { query: string; type?: string; limit?: number; verbatim?: boolean },
  kernel: ToolKernel,
): Promise<Array<{ id: string; title: string; snippet: string; relevance_score: number; timestamp: number }>> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  // Verbatim mode: search content-only FTS index and return original content
  if (params.verbatim) {
    const limit = validateLimit(params.limit ?? 5);
    let sql = `
      SELECT o.id, o.type, o.content, o.indexed_at, o.access_count,
             bm25(obs_content_fts) as relevance
      FROM obs_content_fts
      JOIN observations o ON o.rowid = obs_content_fts.rowid
      WHERE obs_content_fts MATCH ?
    `;
    const sqlParams: unknown[] = [sanitizeFTS5Query(params.query)];

    if (params.type) {
      sql += ' AND o.type = ?';
      sqlParams.push(validateObservationType(params.type));
    }
    sql += ' ORDER BY bm25(obs_content_fts) LIMIT ?';
    sqlParams.push(limit);

    try {
      const rows = kernel.storage.prepare(sql).all(...sqlParams) as Array<{
        id: string; type: string; content: string; indexed_at: number; access_count: number; relevance: number;
      }>;

      // Increment access_count
      const ids = rows.map(r => r.id);
      if (ids.length > 0) {
        try {
          const placeholders = ids.map(() => '?').join(',');
          kernel.storage.exec(`UPDATE observations SET access_count = access_count + 1 WHERE id IN (${placeholders})`, ids);
        } catch { /* non-critical */ }
      }

      return rows.map(r => ({
        id: r.id,
        title: r.content.slice(0, 100),
        snippet: r.content,
        relevance_score: Math.abs(r.relevance),
        timestamp: r.indexed_at,
      }));
    } catch {
      return [];
    }
  }

  // LLM query expansion (optional)
  let searchQuery = params.query;
  if (kernel.llmService) {
    try {
      const expansion = await kernel.llmService.expandQuery(params.query);
      if (expansion) {
        searchQuery = [expansion.original, ...expansion.expanded].join(' ');
      }
    } catch {
      // LLM failure is non-critical — use original query
    }
  }

  const opts: { type_filter?: ObservationType[]; limit?: number } = {
    limit: validateLimit(params.limit ?? 5),
  };
  if (params.type) {
    opts.type_filter = [validateObservationType(params.type)];
  }

  const results: SearchResult[] = await kernel.search.execute(searchQuery, opts);

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

      // Track search results for feedback engine
      if (kernel.feedbackEngine) {
        try { kernel.feedbackEngine.trackSearchResults(ids); } catch { /* non-critical */ }
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

  return mapped;
}

// Total Recall — Recall handler
export async function handleRecall(
  params: { query: string; filters?: { type?: string; time_range?: { from?: number; to?: number }; importance_min?: number; flags?: string[] }; limit?: number },
  kernel: ToolKernel,
): Promise<RecallResult[] | { error: string }> {
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

    return results;
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
  return nlQuery.ask(params.question.trim());
}

// Total Recall — Browse & Topics handlers
export async function handleBrowse(
  params: { dimension: string; value: string; verbatim?: boolean; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; type: string; text: string; timestamp: number; importance_score: number }>> {
  const limit = validateLimit(params.limit ?? 10);
  const textCol = params.verbatim ? 'content' : 'summary';

  try {
    switch (params.dimension) {
      case 'topic': {
        const rows = kernel.storage.prepare(`
          SELECT o.id, o.type, o.${textCol} as text_val, o.indexed_at, o.importance_score
          FROM observation_topics ot
          JOIN topics t ON t.id = ot.topic_id
          JOIN observations o ON o.id = ot.observation_id
          WHERE t.name = ?
          ORDER BY o.importance_score DESC, o.indexed_at DESC
          LIMIT ?
        `).all(params.value, limit) as Array<{ id: string; type: string; text_val: string; indexed_at: number; importance_score: number }>;
        return rows.map(r => ({ id: r.id, type: r.type, text: r.text_val || '', timestamp: r.indexed_at, importance_score: r.importance_score }));
      }
      case 'person': {
        const rows = kernel.storage.prepare(`
          SELECT o.id, o.type, o.${textCol} as text_val, o.indexed_at, o.importance_score
          FROM observations o
          WHERE o.metadata LIKE ?
          ORDER BY o.importance_score DESC, o.indexed_at DESC
          LIMIT ?
        `).all(`%${params.value}%`, limit) as Array<{ id: string; type: string; text_val: string; indexed_at: number; importance_score: number }>;
        return rows.map(r => ({ id: r.id, type: r.type, text: r.text_val || '', timestamp: r.indexed_at, importance_score: r.importance_score }));
      }
      case 'time': {
        const ts = new Date(params.value).getTime();
        if (isNaN(ts)) return [];
        const dayStart = ts;
        const dayEnd = ts + 24 * 60 * 60 * 1000;
        const rows = kernel.storage.prepare(`
          SELECT id, type, ${textCol} as text_val, indexed_at, importance_score
          FROM observations
          WHERE indexed_at >= ? AND indexed_at < ?
          ORDER BY importance_score DESC, indexed_at DESC
          LIMIT ?
        `).all(dayStart, dayEnd, limit) as Array<{ id: string; type: string; text_val: string; indexed_at: number; importance_score: number }>;
        return rows.map(r => ({ id: r.id, type: r.type, text: r.text_val || '', timestamp: r.indexed_at, importance_score: r.importance_score }));
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}
