import type { Entity, EntityType, Relationship, RelationshipType, GraphResult } from '../../core/types.js';
import { ENTITY_TYPES, RELATIONSHIP_TYPES } from '../../core/types.js';
import type { KnowledgeGraph } from '../../core/knowledge-graph.js';
import { type ToolKernel, type ToolDefinition, validateLimit } from './shared.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const graphToolDefinitions: ToolDefinition[] = [
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
  // Total Recall — Entity Detection
  {
    name: 'entity_detect',
    description: 'Extract entities (technologies, people, files, components) from text content.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Text to extract entities from' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_people',
    description: 'List all detected person entities with relationship counts.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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

// Total Recall — Entity Detection handlers
export async function handleEntityDetect(
  params: { content: string },
  _kernel: ToolKernel,
): Promise<Array<{ name: string; type: string; confidence: number; aliases: string[] }> | { error: string }> {
  if (!params.content || typeof params.content !== 'string' || !params.content.trim()) {
    return { error: 'content is required and must be a non-empty string' };
  }

  const { extractEntities } = await import('../../core/entity-extractor.js');
  return extractEntities(params.content);
}

export async function handleListPeople(
  params: { limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; name: string; relationship_count: number; created_at: number }>> {
  const limit = validateLimit(params.limit ?? 20);

  try {
    const rows = kernel.storage.prepare(`
      SELECT e.id, e.name, e.created_at,
             (SELECT COUNT(*) FROM relationships r WHERE r.from_entity = e.id OR r.to_entity = e.id) as rel_count
      FROM entities e
      WHERE e.entity_type = 'person'
      ORDER BY rel_count DESC, e.created_at DESC
      LIMIT ?
    `).all(limit) as Array<{ id: string; name: string; created_at: number; rel_count: number }>;

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      relationship_count: r.rel_count,
      created_at: r.created_at,
    }));
  } catch {
    return [];
  }
}
