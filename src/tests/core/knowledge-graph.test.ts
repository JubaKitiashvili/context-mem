/**
 * Tests for KnowledgeGraph — entity-relationship graph layer.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeGraph } from '../../core/knowledge-graph.js';
import { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../helpers.js';
import type { Entity, Relationship } from '../../core/types.js';

describe('KnowledgeGraph', () => {
  let storage: BetterSqlite3Storage;
  let graph: KnowledgeGraph;

  before(async () => {
    storage = await createTestDb();
    graph = new KnowledgeGraph(storage);
  });

  after(async () => {
    await storage.close();
  });

  // -------------------------------------------------------------------------
  // Entity CRUD
  // -------------------------------------------------------------------------

  it('addEntity creates and returns an entity', () => {
    const entity = graph.addEntity('auth-module', 'module');
    assert.ok(entity.id, 'should have an id');
    assert.equal(entity.name, 'auth-module');
    assert.equal(entity.entity_type, 'module');
    assert.deepEqual(entity.metadata, {});
    assert.ok(entity.created_at > 0);
    assert.ok(entity.updated_at > 0);
  });

  it('addEntity with metadata and knowledgeId', () => {
    const entity = graph.addEntity('JWT handling', 'pattern', {
      metadata: { scope: 'backend' },
      knowledgeId: 'k-123',
    });
    assert.equal(entity.name, 'JWT handling');
    assert.equal(entity.entity_type, 'pattern');
    assert.deepEqual(entity.metadata, { scope: 'backend' });
    assert.equal(entity.knowledge_id, 'k-123');
  });

  it('getEntity returns entity by id', () => {
    const created = graph.addEntity('user-service', 'service');
    const fetched = graph.getEntity(created.id);
    assert.ok(fetched);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.name, 'user-service');
    assert.equal(fetched.entity_type, 'service');
  });

  it('getEntity returns null for non-existent id', () => {
    const result = graph.getEntity('nonexistent-id');
    assert.equal(result, null);
  });

  it('findEntity by name', () => {
    graph.addEntity('database-config', 'config');
    const results = graph.findEntity('database-config');
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, 'database-config');
  });

  it('findEntity by name and type', () => {
    graph.addEntity('auth', 'module');
    graph.addEntity('auth', 'api');
    const modules = graph.findEntity('auth', 'module');
    assert.equal(modules.length, 1);
    assert.equal(modules[0].entity_type, 'module');

    const apis = graph.findEntity('auth', 'api');
    assert.equal(apis.length, 1);
    assert.equal(apis[0].entity_type, 'api');
  });

  it('updateEntity modifies fields', () => {
    const entity = graph.addEntity('old-name', 'library');
    graph.updateEntity(entity.id, { name: 'new-name', metadata: { version: '2.0' } });
    const updated = graph.getEntity(entity.id);
    assert.ok(updated);
    assert.equal(updated.name, 'new-name');
    assert.deepEqual(updated.metadata, { version: '2.0' });
    assert.ok(updated.updated_at >= entity.updated_at);
  });

  it('removeEntity deletes entity', () => {
    const entity = graph.addEntity('to-delete', 'file');
    assert.ok(graph.getEntity(entity.id));
    graph.removeEntity(entity.id);
    assert.equal(graph.getEntity(entity.id), null);
  });

  // -------------------------------------------------------------------------
  // Relationship CRUD
  // -------------------------------------------------------------------------

  it('addRelationship creates a relationship', () => {
    const a = graph.addEntity('module-a', 'module');
    const b = graph.addEntity('module-b', 'module');
    const rel = graph.addRelationship(a.id, b.id, 'uses');
    assert.ok(rel.id);
    assert.equal(rel.from_entity, a.id);
    assert.equal(rel.to_entity, b.id);
    assert.equal(rel.relationship_type, 'uses');
    assert.equal(rel.weight, 1.0);
  });

  it('addRelationship with weight and metadata', () => {
    const a = graph.addEntity('service-x', 'service');
    const b = graph.addEntity('lib-y', 'library');
    const rel = graph.addRelationship(a.id, b.id, 'depends-on', {
      weight: 0.8,
      metadata: { reason: 'runtime dependency' },
    });
    assert.equal(rel.weight, 0.8);
    assert.deepEqual(rel.metadata, { reason: 'runtime dependency' });
  });

  it('addRelationship upserts on duplicate (from, to, type)', () => {
    const a = graph.addEntity('upsert-a', 'module');
    const b = graph.addEntity('upsert-b', 'module');
    const rel1 = graph.addRelationship(a.id, b.id, 'uses', { weight: 0.5 });
    const rel2 = graph.addRelationship(a.id, b.id, 'uses', { weight: 0.9 });
    // Should be the same relationship, updated weight
    assert.equal(rel1.id, rel2.id);
    assert.equal(rel2.weight, 0.9);
  });

  it('removeRelationship deletes a relationship', () => {
    const a = graph.addEntity('rem-rel-a', 'module');
    const b = graph.addEntity('rem-rel-b', 'module');
    const rel = graph.addRelationship(a.id, b.id, 'implements');
    // Verify it exists via neighbors
    const before = graph.neighbors(a.id);
    assert.ok(before.relationships.length >= 1);

    graph.removeRelationship(rel.id);
    const after = graph.neighbors(a.id);
    const stillHas = after.relationships.some(r => r.id === rel.id);
    assert.ok(!stillHas, 'relationship should be removed');
  });

  // -------------------------------------------------------------------------
  // Cascading delete
  // -------------------------------------------------------------------------

  it('removeEntity cascades to relationships', () => {
    const a = graph.addEntity('cascade-a', 'module');
    const b = graph.addEntity('cascade-b', 'module');
    const c = graph.addEntity('cascade-c', 'module');
    graph.addRelationship(a.id, b.id, 'uses');
    graph.addRelationship(c.id, a.id, 'depends-on');

    // Verify relationships exist
    const neighborsBefore = graph.neighbors(b.id);
    assert.ok(neighborsBefore.entities.some(e => e.id === a.id));

    // Delete a — should cascade
    graph.removeEntity(a.id);

    // b should have no neighbors via that relationship
    const neighborsAfter = graph.neighbors(b.id);
    assert.ok(!neighborsAfter.entities.some(e => e.id === a.id));

    // c should have no neighbors via that relationship
    const neighborsC = graph.neighbors(c.id);
    assert.ok(!neighborsC.entities.some(e => e.id === a.id));
  });

  // -------------------------------------------------------------------------
  // neighbors()
  // -------------------------------------------------------------------------

  it('neighbors returns direct neighbors at depth 1', () => {
    const center = graph.addEntity('center-node', 'module');
    const n1 = graph.addEntity('neighbor-1', 'file');
    const n2 = graph.addEntity('neighbor-2', 'library');
    graph.addRelationship(center.id, n1.id, 'uses');
    graph.addRelationship(center.id, n2.id, 'depends-on');

    const result = graph.neighbors(center.id);
    assert.equal(result.entities.length, 2);
    assert.equal(result.relationships.length, 2);
    const names = result.entities.map(e => e.name).sort();
    assert.deepEqual(names, ['neighbor-1', 'neighbor-2']);
  });

  it('neighbors with depth 2 returns transitive neighbors', () => {
    const a = graph.addEntity('depth-a', 'module');
    const b = graph.addEntity('depth-b', 'module');
    const c = graph.addEntity('depth-c', 'module');
    graph.addRelationship(a.id, b.id, 'uses');
    graph.addRelationship(b.id, c.id, 'uses');

    // Depth 1: only b
    const d1 = graph.neighbors(a.id, { depth: 1 });
    assert.equal(d1.entities.length, 1);
    assert.equal(d1.entities[0].name, 'depth-b');

    // Depth 2: b + c
    const d2 = graph.neighbors(a.id, { depth: 2 });
    assert.equal(d2.entities.length, 2);
    const names = d2.entities.map(e => e.name).sort();
    assert.deepEqual(names, ['depth-b', 'depth-c']);
  });

  it('neighbors with direction filter (out)', () => {
    const from = graph.addEntity('dir-from', 'module');
    const to = graph.addEntity('dir-to', 'file');
    const inbound = graph.addEntity('dir-inbound', 'service');
    graph.addRelationship(from.id, to.id, 'uses');
    graph.addRelationship(inbound.id, from.id, 'depends-on');

    const outOnly = graph.neighbors(from.id, { direction: 'out' });
    assert.equal(outOnly.entities.length, 1);
    assert.equal(outOnly.entities[0].name, 'dir-to');
  });

  it('neighbors with direction filter (in)', () => {
    const target = graph.addEntity('in-target', 'module');
    const source = graph.addEntity('in-source', 'service');
    const outbound = graph.addEntity('in-outbound', 'file');
    graph.addRelationship(source.id, target.id, 'uses');
    graph.addRelationship(target.id, outbound.id, 'documents');

    const inOnly = graph.neighbors(target.id, { direction: 'in' });
    assert.equal(inOnly.entities.length, 1);
    assert.equal(inOnly.entities[0].name, 'in-source');
  });

  it('neighbors with relationship type filter', () => {
    const hub = graph.addEntity('type-hub', 'module');
    const dep = graph.addEntity('type-dep', 'library');
    const doc = graph.addEntity('type-doc', 'file');
    graph.addRelationship(hub.id, dep.id, 'depends-on');
    graph.addRelationship(hub.id, doc.id, 'documents');

    const depsOnly = graph.neighbors(hub.id, { type: 'depends-on' });
    assert.equal(depsOnly.entities.length, 1);
    assert.equal(depsOnly.entities[0].name, 'type-dep');

    const docsOnly = graph.neighbors(hub.id, { type: 'documents' });
    assert.equal(docsOnly.entities.length, 1);
    assert.equal(docsOnly.entities[0].name, 'type-doc');
  });

  it('neighbors returns empty for isolated entity', () => {
    const lonely = graph.addEntity('lonely-node', 'config');
    const result = graph.neighbors(lonely.id);
    assert.equal(result.entities.length, 0);
    assert.equal(result.relationships.length, 0);
  });

  // -------------------------------------------------------------------------
  // subgraph()
  // -------------------------------------------------------------------------

  it('subgraph includes the starting entity', () => {
    const root = graph.addEntity('sub-root', 'module');
    const child = graph.addEntity('sub-child', 'file');
    graph.addRelationship(root.id, child.id, 'uses');

    const result = graph.subgraph(root.id, 1);
    assert.equal(result.entities.length, 2);
    assert.ok(result.entities.some(e => e.id === root.id));
    assert.ok(result.entities.some(e => e.id === child.id));
    assert.equal(result.relationships.length, 1);
  });

  // -------------------------------------------------------------------------
  // extractEntitiesFromKnowledge()
  // -------------------------------------------------------------------------

  it('extractEntitiesFromKnowledge populates graph from knowledge table', () => {
    const kb = new KnowledgeBase(storage);

    kb.save({
      category: 'pattern',
      title: 'Repository pattern',
      content: 'Use repository pattern for data access in src/repos/user.ts',
      tags: ['architecture'],
      source_type: 'explicit',
    });

    kb.save({
      category: 'decision',
      title: 'Use PostgreSQL',
      content: 'We decided to use PostgreSQL for the main database.',
      tags: ['database'],
      source_type: 'explicit',
    });

    kb.save({
      category: 'error',
      title: 'Memory leak in worker',
      content: 'Found memory leak in src/workers/processor.ts when handling large payloads.',
      tags: ['bug'],
      source_type: 'observed',
    });

    const created = graph.extractEntitiesFromKnowledge();
    assert.ok(created >= 3, `expected at least 3 entities created, got ${created}`);

    // Verify entities exist
    const patterns = graph.findEntity('Repository pattern', 'pattern');
    assert.equal(patterns.length, 1);

    const decisions = graph.findEntity('Use PostgreSQL', 'decision');
    assert.equal(decisions.length, 1);

    const bugs = graph.findEntity('Memory leak in worker', 'bug');
    assert.equal(bugs.length, 1);
  });

  it('extractEntitiesFromKnowledge is idempotent', () => {
    const count1 = graph.extractEntitiesFromKnowledge();
    const count2 = graph.extractEntitiesFromKnowledge();
    assert.equal(count2, 0, 'second extraction should create 0 new entities');
  });

  it('extractEntitiesFromKnowledge creates file entities from content paths', () => {
    const fileEntities = graph.findEntity('src/repos/user.ts', 'file');
    assert.ok(fileEntities.length >= 1, 'should have created file entity from path in content');
  });
});
