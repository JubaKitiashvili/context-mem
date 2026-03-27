import type {
  StoragePlugin,
  Entity,
  Relationship,
  EntityType,
  RelationshipType,
  GraphResult,
  KnowledgeCategory,
} from './types.js';
import { ulid } from './utils.js';

/** Map knowledge categories to entity types for auto-extraction. */
const CATEGORY_TO_ENTITY: Partial<Record<KnowledgeCategory, EntityType>> = {
  pattern: 'pattern',
  decision: 'decision',
  error: 'bug',
  api: 'api',
  component: 'module',
};

export class KnowledgeGraph {
  constructor(private storage: StoragePlugin) {}

  // ---------------------------------------------------------------------------
  // Entity CRUD
  // ---------------------------------------------------------------------------

  addEntity(
    name: string,
    type: EntityType,
    opts?: { metadata?: Record<string, unknown>; knowledgeId?: string },
  ): Entity {
    const now = Date.now();
    const entity: Entity = {
      id: ulid(),
      name,
      entity_type: type,
      metadata: opts?.metadata ?? {},
      knowledge_id: opts?.knowledgeId,
      created_at: now,
      updated_at: now,
    };

    this.storage.exec(
      `INSERT INTO entities (id, name, entity_type, metadata, knowledge_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.name,
        entity.entity_type,
        JSON.stringify(entity.metadata),
        entity.knowledge_id ?? null,
        entity.created_at,
        entity.updated_at,
      ],
    );

    return entity;
  }

  getEntity(id: string): Entity | null {
    const row = this.storage.prepare(
      'SELECT id, name, entity_type, metadata, knowledge_id, created_at, updated_at FROM entities WHERE id = ?',
    ).get(id) as Record<string, unknown> | undefined;

    return row ? this.rowToEntity(row) : null;
  }

  findEntity(name: string, type?: EntityType): Entity[] {
    let sql = 'SELECT id, name, entity_type, metadata, knowledge_id, created_at, updated_at FROM entities WHERE name = ?';
    const params: unknown[] = [name];

    if (type) {
      sql += ' AND entity_type = ?';
      params.push(type);
    }

    const rows = this.storage.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.rowToEntity(r));
  }

  updateEntity(id: string, updates: Partial<Pick<Entity, 'name' | 'entity_type' | 'metadata' | 'knowledge_id'>>): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }
    if (updates.entity_type !== undefined) {
      setClauses.push('entity_type = ?');
      params.push(updates.entity_type);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    if (updates.knowledge_id !== undefined) {
      setClauses.push('knowledge_id = ?');
      params.push(updates.knowledge_id);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.storage.exec(
      `UPDATE entities SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    );
  }

  removeEntity(id: string): void {
    // Cascade: delete all relationships involving this entity
    this.storage.exec(
      'DELETE FROM relationships WHERE from_entity = ? OR to_entity = ?',
      [id, id],
    );
    this.storage.exec('DELETE FROM entities WHERE id = ?', [id]);
  }

  // ---------------------------------------------------------------------------
  // Relationship CRUD
  // ---------------------------------------------------------------------------

  addRelationship(
    from: string,
    to: string,
    type: RelationshipType,
    opts?: { weight?: number; metadata?: Record<string, unknown> },
  ): Relationship {
    const now = Date.now();
    const weight = opts?.weight ?? 1.0;
    const metadata = opts?.metadata ?? {};
    const id = ulid();

    // Upsert: on conflict (from_entity, to_entity, relationship_type) update weight/metadata
    this.storage.exec(
      `INSERT INTO relationships (id, from_entity, to_entity, relationship_type, weight, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(from_entity, to_entity, relationship_type)
       DO UPDATE SET weight = excluded.weight, metadata = excluded.metadata`,
      [id, from, to, type, weight, JSON.stringify(metadata), now],
    );

    // For upsert, the returned id might differ from the inserted one if it was an update.
    // Fetch the actual row to return the correct id.
    const row = this.storage.prepare(
      'SELECT id, from_entity, to_entity, relationship_type, weight, metadata, created_at FROM relationships WHERE from_entity = ? AND to_entity = ? AND relationship_type = ?',
    ).get(from, to, type) as Record<string, unknown>;

    return this.rowToRelationship(row);
  }

  removeRelationship(id: string): void {
    this.storage.exec('DELETE FROM relationships WHERE id = ?', [id]);
  }

  // ---------------------------------------------------------------------------
  // Graph queries
  // ---------------------------------------------------------------------------

  neighbors(
    entityId: string,
    opts?: { direction?: 'in' | 'out' | 'both'; type?: RelationshipType; depth?: number },
  ): GraphResult {
    const { direction = 'both', type, depth = 1 } = opts ?? {};
    const visited = new Set<string>([entityId]);
    const allRelationships: Relationship[] = [];
    let frontier = [entityId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const rels = this.getRelationships(id, direction, type);
        for (const rel of rels) {
          allRelationships.push(rel);
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

    // Remove the starting entity from the result set
    visited.delete(entityId);

    const entities = this.getEntitiesByIds([...visited]);

    // Deduplicate relationships by id
    const uniqueRels = new Map<string, Relationship>();
    for (const rel of allRelationships) {
      uniqueRels.set(rel.id, rel);
    }

    return { entities, relationships: [...uniqueRels.values()] };
  }

  subgraph(entityId: string, depth: number): GraphResult {
    const visited = new Set<string>([entityId]);
    const allRelationships: Relationship[] = [];
    let frontier = [entityId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const rels = this.getRelationships(id, 'both');
        for (const rel of rels) {
          allRelationships.push(rel);
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

    const entities = this.getEntitiesByIds([...visited]);

    const uniqueRels = new Map<string, Relationship>();
    for (const rel of allRelationships) {
      uniqueRels.set(rel.id, rel);
    }

    return { entities, relationships: [...uniqueRels.values()] };
  }

  // ---------------------------------------------------------------------------
  // Auto-extraction
  // ---------------------------------------------------------------------------

  /**
   * Scan the knowledge table and create entities + relationships from existing entries.
   * Idempotent: uses the UNIQUE constraint on (name, entity_type) to skip duplicates.
   * Returns the number of entities created.
   */
  extractEntitiesFromKnowledge(): number {
    const rows = this.storage.prepare(
      'SELECT id, category, title, content FROM knowledge WHERE archived = 0',
    ).all() as Array<Record<string, unknown>>;

    let created = 0;

    for (const row of rows) {
      const category = row.category as KnowledgeCategory;
      const entityType = CATEGORY_TO_ENTITY[category];
      if (!entityType) continue;

      const title = row.title as string;
      const knowledgeId = row.id as string;

      // Check if entity already exists (name + type unique)
      const existing = this.findEntity(title, entityType);
      if (existing.length > 0) {
        // Link to knowledge entry if not already linked
        if (!existing[0].knowledge_id) {
          this.updateEntity(existing[0].id, { knowledge_id: knowledgeId });
        }
        continue;
      }

      this.addEntity(title, entityType, { knowledgeId });
      created++;

      // Extract file paths from content and create file entities + documents relationships
      const content = row.content as string;
      const filePaths = this.extractFilePaths(content);
      for (const fp of filePaths) {
        let fileEntity = this.findEntity(fp, 'file');
        if (fileEntity.length === 0) {
          const fe = this.addEntity(fp, 'file');
          fileEntity = [fe];
          created++;
        }
        // The knowledge entity documents the file
        const knowledgeEntity = this.findEntity(title, entityType);
        if (knowledgeEntity.length > 0) {
          try {
            this.addRelationship(knowledgeEntity[0].id, fileEntity[0].id, 'documents');
          } catch {
            // Ignore duplicate relationship errors
          }
        }
      }
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getRelationships(
    entityId: string,
    direction: 'in' | 'out' | 'both',
    type?: RelationshipType,
  ): Relationship[] {
    const results: Relationship[] = [];

    if (direction === 'out' || direction === 'both') {
      let sql = 'SELECT id, from_entity, to_entity, relationship_type, weight, metadata, created_at FROM relationships WHERE from_entity = ?';
      const params: unknown[] = [entityId];
      if (type) {
        sql += ' AND relationship_type = ?';
        params.push(type);
      }
      const rows = this.storage.prepare(sql).all(...params) as Record<string, unknown>[];
      results.push(...rows.map(r => this.rowToRelationship(r)));
    }

    if (direction === 'in' || direction === 'both') {
      let sql = 'SELECT id, from_entity, to_entity, relationship_type, weight, metadata, created_at FROM relationships WHERE to_entity = ?';
      const params: unknown[] = [entityId];
      if (type) {
        sql += ' AND relationship_type = ?';
        params.push(type);
      }
      const rows = this.storage.prepare(sql).all(...params) as Record<string, unknown>[];
      results.push(...rows.map(r => this.rowToRelationship(r)));
    }

    return results;
  }

  private getEntitiesByIds(ids: string[]): Entity[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.storage.prepare(
      `SELECT id, name, entity_type, metadata, knowledge_id, created_at, updated_at FROM entities WHERE id IN (${placeholders})`,
    ).all(...ids) as Record<string, unknown>[];
    return rows.map(r => this.rowToEntity(r));
  }

  private rowToEntity(row: Record<string, unknown>): Entity {
    return {
      id: row.id as string,
      name: row.name as string,
      entity_type: row.entity_type as EntityType,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
      knowledge_id: (row.knowledge_id as string) || undefined,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }

  private rowToRelationship(row: Record<string, unknown>): Relationship {
    return {
      id: row.id as string,
      from_entity: row.from_entity as string,
      to_entity: row.to_entity as string,
      relationship_type: row.relationship_type as RelationshipType,
      weight: row.weight as number,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>),
      created_at: row.created_at as number,
    };
  }

  /** Extract file paths from text content. Matches common path patterns. */
  private extractFilePaths(content: string): string[] {
    const paths = new Set<string>();
    // Match paths like src/foo/bar.ts, ./config.json, /usr/local/bin/node
    const regex = /(?:^|\s|['"`(])([.\/]?(?:[\w-]+\/)+[\w.-]+\.\w+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      paths.add(match[1]);
    }
    return [...paths];
  }
}
