import { basename } from 'node:path';
import type { KnowledgeCategory, SourceType, ContradictionWarning } from '../../core/types.js';
import { type ToolKernel, type ToolDefinition, validateLimit, validateObservationType } from './shared.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const KNOWLEDGE_CATEGORIES = ['pattern', 'decision', 'error', 'api', 'component'] as const;
const SOURCE_TYPES = ['explicit', 'inferred', 'observed'] as const;

export const knowledgeToolDefinitions: ToolDefinition[] = [
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
        valid_from: { type: 'number', description: 'Timestamp (ms) when this fact became true. Default: now' },
      },
      required: ['category', 'title', 'content'],
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
  // Merge suggestions
  {
    name: 'merge_suggestions',
    description: 'View pending merge suggestions for duplicate global knowledge entries.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'accepted', 'dismissed', 'all'], description: 'Filter by status (default: pending)' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
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
  // Total Recall — Temporal Query
  {
    name: 'temporal_query',
    description: 'Query knowledge that was valid at a specific point in time. Returns facts that were active at the given timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        at: { type: 'number', description: 'Timestamp (ms) to query knowledge state at' },
        category: { type: 'string', enum: ['pattern', 'decision', 'error', 'api', 'component'], description: 'Filter by category' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query', 'at'],
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleSaveKnowledge(
  params: { category: string; title: string; content: string; tags?: string[]; shareable?: boolean; source_type?: string; force?: boolean; valid_from?: number },
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
    const entry = await kernel.knowledgeBase.save({
      category,
      title: params.title,
      content: params.content,
      tags: params.tags,
      shareable: params.shareable,
      source_type: sourceType,
    });

    // Set valid_from for temporal facts
    const validFrom = params.valid_from ?? Date.now();
    try {
      kernel.storage.exec('UPDATE knowledge SET valid_from = ? WHERE id = ?', [validFrom, entry.id]);
    } catch { /* non-critical */ }

    // If contradictions were force-overridden, supersede old entries
    if (forceOverride && contradictions.length > 0) {
      for (const c of contradictions) {
        try {
          kernel.storage.exec(
            'UPDATE knowledge SET valid_to = ?, superseded_by = ? WHERE id = ? AND valid_to IS NULL',
            [Date.now(), entry.id, c.id],
          );
        } catch { /* non-critical */ }
      }
    }

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
  const projectName = basename(process.cwd()) || 'unknown';

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

export async function handleMergeSuggestions(
  params: { status?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; global_id: string; similarity_score: number; strategy: string; status: string }> | { error: string }> {
  if (!kernel.globalStore) {
    return { error: 'Global knowledge store is not enabled' };
  }
  const status = (params.status || 'pending') as 'pending' | 'accepted' | 'dismissed' | 'all';
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  return kernel.globalStore.getMergeSuggestions(status, limit);
}

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
      const merged = await kernel.knowledgeBase.save({
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

// Total Recall — Temporal Query handler
export async function handleTemporalQuery(
  params: { query: string; at: number; category?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; category: string; title: string; content: string; valid_from: number | null; valid_to: number | null; superseded_by: string | null }> | { error: string }> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { error: 'query is required and must be a non-empty string' };
  }
  if (!params.at || typeof params.at !== 'number') {
    return { error: 'at timestamp is required' };
  }

  const limit = validateLimit(params.limit ?? 10);

  // Search knowledge base, then filter by temporal validity
  const results = kernel.knowledgeBase.search(params.query, {
    category: params.category as KnowledgeCategory | undefined,
    limit: limit * 3, // over-fetch to compensate for temporal filtering
  }, kernel.sessionId);

  const temporalResults: Array<{
    id: string; category: string; title: string; content: string;
    valid_from: number | null; valid_to: number | null; superseded_by: string | null;
  }> = [];

  for (const r of results) {
    if (temporalResults.length >= limit) break;
    try {
      const row = kernel.storage.prepare(
        'SELECT valid_from, valid_to, superseded_by FROM knowledge WHERE id = ?'
      ).get(r.id) as { valid_from: number | null; valid_to: number | null; superseded_by: string | null } | undefined;

      if (!row) continue;

      // Check: valid_from <= at AND (valid_to IS NULL OR valid_to > at)
      const validFrom = row.valid_from ?? 0;
      const validAtTime = validFrom <= params.at && (row.valid_to === null || row.valid_to > params.at);

      if (validAtTime) {
        temporalResults.push({
          id: r.id,
          category: r.category,
          title: r.title,
          content: r.content,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          superseded_by: row.superseded_by,
        });
      }
    } catch { /* skip on error */ }
  }

  return temporalResults;
}
