# Knowledge Graph Design Spec — v2.0.0 Phase 2

**Goal:** Add an entity-relationship graph layer on top of the existing flat knowledge base, enabling queries like "What depends on auth module?" and "Show everything related to JWT."

**Architecture:** Property graph model (nodes + typed edges) stored in SQLite via adjacency list. Additive — existing knowledge table unchanged, graph is a new layer that references it.

**Tech Stack:** SQLite (better-sqlite3), same migration system

---

## Data Model

### Entities (Nodes)

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,  -- file, module, pattern, decision, bug, person, library, service, api, config
  metadata TEXT DEFAULT '{}', -- JSON: extra attributes
  knowledge_id TEXT,          -- optional link to knowledge table entry
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (knowledge_id) REFERENCES knowledge(id)
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_name ON entities(name);
CREATE UNIQUE INDEX idx_entities_name_type ON entities(name, entity_type);
```

### Relationships (Edges)

```sql
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  relationship_type TEXT NOT NULL,  -- uses, depends-on, fixed-by, contradicts, supersedes, implements, tests, documents
  weight REAL DEFAULT 1.0,         -- strength/confidence (0-1)
  metadata TEXT DEFAULT '{}',      -- JSON: context, timestamp, source
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_entity) REFERENCES entities(id),
  FOREIGN KEY (to_entity) REFERENCES entities(id)
);

CREATE INDEX idx_rel_from ON relationships(from_entity);
CREATE INDEX idx_rel_to ON relationships(to_entity);
CREATE INDEX idx_rel_type ON relationships(relationship_type);
CREATE UNIQUE INDEX idx_rel_unique ON relationships(from_entity, to_entity, relationship_type);
```

### Entity Types
- `file` — source file path
- `module` — logical module/component
- `pattern` — design pattern or convention
- `decision` — architectural decision
- `bug` — known issue or past bug
- `person` — team member or contributor
- `library` — external dependency
- `service` — external service or API
- `api` — internal API endpoint
- `config` — configuration key or setting

### Relationship Types
- `uses` — A uses B (import, function call)
- `depends-on` — A depends on B (build/runtime dependency)
- `fixed-by` — bug A was fixed by commit/change B
- `contradicts` — A contradicts B (from contradiction detection)
- `supersedes` — A replaces B (newer version/decision)
- `implements` — A implements B (code implements decision)
- `tests` — A tests B (test file tests module)
- `documents` — A documents B (docs describe module)

---

## Graph Engine

### New file: `src/core/knowledge-graph.ts`

```typescript
export class KnowledgeGraph {
  constructor(private storage: StoragePlugin) {}

  // Entity CRUD
  addEntity(name: string, type: EntityType, opts?: { metadata?: Record<string, unknown>; knowledgeId?: string }): Entity
  getEntity(id: string): Entity | null
  findEntity(name: string, type?: EntityType): Entity[]
  updateEntity(id: string, updates: Partial<Entity>): void
  removeEntity(id: string): void  // cascades to relationships

  // Relationship CRUD
  addRelationship(from: string, to: string, type: RelationshipType, opts?: { weight?: number; metadata?: Record<string, unknown> }): Relationship
  removeRelationship(id: string): void

  // Graph queries
  neighbors(entityId: string, opts?: { direction?: 'in' | 'out' | 'both'; type?: RelationshipType; depth?: number }): GraphResult
  shortestPath(fromId: string, toId: string): Entity[]
  subgraph(entityId: string, depth: number): { entities: Entity[]; relationships: Relationship[] }

  // Auto-extraction
  extractEntitiesFromKnowledge(): number  // scans knowledge table, creates entities + relationships
  extractEntitiesFromObservation(obs: Observation): void  // real-time extraction on new observations
}
```

### Graph Query Algorithm

`neighbors()` uses iterative BFS with depth limit:

```typescript
neighbors(entityId: string, opts: NeighborOpts = {}): GraphResult {
  const { direction = 'both', type, depth = 1 } = opts;
  const visited = new Set<string>([entityId]);
  let frontier = [entityId];

  for (let d = 0; d < depth; d++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      // Query relationships based on direction
      const rels = this.getRelationships(id, direction, type);
      for (const rel of rels) {
        const neighbor = rel.from_entity === id ? rel.to_entity : rel.from_entity;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Return entities + relationships in the traversed subgraph
}
```

`shortestPath()` uses bidirectional BFS (optimal for unweighted graphs in SQLite).

---

## Auto-Entity Extraction

### From Knowledge Entries (migration-time)

Scan existing knowledge entries and extract entities:
- Category `pattern` → entity type `pattern`
- Category `decision` → entity type `decision`
- Category `error` → entity type `bug`
- Category `api` → entity type `api`
- Category `component` → entity type `module`

Parse titles and content for file paths → create `file` entities with `documents` relationships.

### From Observations (real-time)

When a new observation is stored, extract entities from metadata:
- `filePath` → `file` entity
- `source: 'Edit'` on file A after error observation → `fixed-by` relationship
- Import statements in code observations → `uses` relationships

This runs in the pipeline after storage, non-blocking (fire-and-forget).

---

## MCP Tools

### `graph_query` — Query the knowledge graph

```typescript
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
}
```

### `add_relationship` — Add a relationship between entities

```typescript
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
}
```

### `graph_neighbors` — Quick neighbor lookup

```typescript
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
}
```

---

## Migration

### Migration v9: Knowledge Graph Tables

```sql
-- Entities
CREATE TABLE IF NOT EXISTS entities (...);
-- Relationships
CREATE TABLE IF NOT EXISTS relationships (...);
-- Indexes (as above)
-- Schema version
INSERT INTO schema_version (version, applied_at, description)
VALUES (9, unixepoch(), 'Knowledge graph: entities and relationships');
```

### Auto-populate from existing knowledge

After migration, run `extractEntitiesFromKnowledge()` once to seed the graph from existing data. This is idempotent (uses UNIQUE constraint on name+type).

---

## Integration Points

### kernel.ts
- Initialize `KnowledgeGraph` after `KnowledgeBase`
- Pass to `ToolKernel` interface
- No separate shutdown needed (shares storage connection)

### tools.ts + server.ts
- Add 3 new tool definitions and handlers
- Register in dispatch switch (23 total tools)

### pipeline.ts
- After storing observation, call `graph.extractEntitiesFromObservation(obs)` in fire-and-forget

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/core/knowledge-graph.ts` |
| Create | `src/tests/core/knowledge-graph.test.ts` |
| Modify | `src/plugins/storage/migrations.ts` — add migration v9 |
| Modify | `src/core/types.ts` — add Entity, Relationship, EntityType, RelationshipType types |
| Modify | `src/core/kernel.ts` — initialize KnowledgeGraph |
| Modify | `src/mcp-server/tools.ts` — add 3 tool definitions + handlers |
| Modify | `src/mcp-server/server.ts` — register 3 new tools |
| Modify | `src/core/pipeline.ts` — auto-extract on new observations |

---

## Tests

- Add entity, get entity, find entity by name/type
- Add relationship, unique constraint prevents duplicates
- neighbors() returns correct entities at depth 1 and 2
- direction filter (in/out/both) works
- relationship_type filter works
- removeEntity cascades to relationships
- extractEntitiesFromKnowledge populates graph from existing data
- graph_query MCP tool returns correct results
- add_relationship MCP tool creates entities if missing
- graph_neighbors MCP tool works
- shortestPath finds the shortest route

Target: 15+ new tests.

---

## Backwards Compatibility

- Existing knowledge table unchanged
- Existing 20 MCP tools unchanged
- Graph is purely additive (new tables, new tools)
- Auto-extraction is idempotent (safe to re-run)
- If graph tables are empty, graph_query returns empty results (no crash)
