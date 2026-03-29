/**
 * Tests for GlobalKnowledgeStore duplicate detection and auto-merge.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GlobalKnowledgeStore } from '../../core/global-store.js';
import type { KnowledgeEntry } from '../../core/types.js';

function makeEntry(overrides: Partial<KnowledgeEntry> & { id: string; title: string; content: string }): KnowledgeEntry {
  return {
    category: 'pattern',
    tags: [],
    shareable: true,
    relevance_score: 1,
    access_count: 5,
    created_at: Date.now(),
    last_accessed: Date.now(),
    archived: false,
    source_type: 'explicit',
    ...overrides,
  };
}

describe('GlobalKnowledgeStore duplicate detection and auto-merge', () => {
  let tmpDir: string;
  let dbPath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-merge-test-'));
    dbPath = path.join(tmpDir, 'store.db');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects high-confidence duplicates', () => {
    const store = new GlobalKnowledgeStore(undefined, dbPath);
    store.open();

    store.promote(makeEntry({
      id: 'local-1',
      category: 'pattern',
      title: 'PostgreSQL connection pooling with PgBouncer',
      content: 'Use PgBouncer for connection pooling in production PostgreSQL. Set pool_mode to transaction for best performance.',
      tags: ['postgres', 'pooling'],
    }), 'project-a');

    store.promote(makeEntry({
      id: 'local-2',
      category: 'pattern',
      title: 'PostgreSQL connection pooling configuration',
      content: 'PgBouncer connection pooling for PostgreSQL. Configure pool_mode transaction in production environment.',
      tags: ['postgres', 'pgbouncer'],
    }), 'project-b');

    const candidate = makeEntry({
      id: 'local-3',
      category: 'pattern',
      title: 'PostgreSQL connection pooling with PgBouncer',
      content: 'Use PgBouncer for connection pooling in PostgreSQL production. Pool mode transaction recommended.',
      tags: ['postgres'],
    });

    const duplicates = store.findDuplicates(candidate);

    assert.ok(duplicates.length > 0, 'should find at least one duplicate');
    assert.ok(duplicates[0].similarity >= 0.4, `similarity ${duplicates[0].similarity} should be >= 0.4`);
    assert.ok(duplicates[0].entry.id, 'duplicate should have an entry id');

    store.close();
  });

  it('does not flag unrelated entries as duplicates', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-merge-unrelated-'));
    const dbPath2 = path.join(tmpDir2, 'store.db');
    const store = new GlobalKnowledgeStore(undefined, dbPath2);
    store.open();

    store.promote(makeEntry({
      id: 'local-1',
      category: 'pattern',
      title: 'JWT authentication token signing',
      content: 'Sign JWT tokens with RS256 algorithm. Use asymmetric keys for production authentication services.',
      tags: ['jwt', 'auth'],
    }), 'project-a');

    const candidate = makeEntry({
      id: 'local-2',
      category: 'pattern',
      title: 'PostgreSQL database indexing strategies',
      content: 'Create btree indexes on foreign keys and frequently queried columns in PostgreSQL database schema.',
      tags: ['postgres', 'database'],
    });

    const duplicates = store.findDuplicates(candidate);

    assert.equal(duplicates.length, 0, 'unrelated entries should not be flagged as duplicates');

    store.close();
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  it('autoMerge combines entries correctly', () => {
    const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-automerge-'));
    const dbPath3 = path.join(tmpDir3, 'store.db');
    const store = new GlobalKnowledgeStore(undefined, dbPath3);
    store.open();

    const entryA = store.promote(makeEntry({
      id: 'local-1',
      category: 'pattern',
      title: 'React hooks pattern for state management',
      content: 'Use custom hooks to encapsulate state logic and share between components.',
      tags: ['react', 'hooks'],
    }), 'project-a');

    const entryB = store.promote(makeEntry({
      id: 'local-2',
      category: 'pattern',
      title: 'React hooks pattern for state management',
      content: 'Custom React hooks allow reusing stateful logic without changing component hierarchy.',
      tags: ['react', 'state'],
    }), 'project-b');

    const merged = store.autoMerge(entryA.id, entryB.id);

    assert.ok(merged, 'autoMerge should return the kept entry');
    assert.ok(
      merged.source_projects && merged.source_projects.includes('project-a'),
      'merged entry should include project-a in source_projects'
    );
    assert.ok(
      merged.source_projects && merged.source_projects.includes('project-b'),
      'merged entry should include project-b in source_projects'
    );
    assert.ok(merged.tags.includes('auto-merged'), 'merged entry should have auto-merged tag');

    const archivedEntry = store.getById(entryB.id);
    assert.ok(archivedEntry, 'archived entry should still exist in DB');
    assert.ok(archivedEntry.archived, 'merged entry should be archived');

    store.close();
    fs.rmSync(tmpDir3, { recursive: true, force: true });
  });
});
