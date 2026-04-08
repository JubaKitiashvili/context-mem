import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities, resolveAlias } from '../../core/entity-extractor.js';

describe('Entity Extractor', () => {
  describe('technology detection', () => {
    it('detects known technologies', () => {
      const entities = extractEntities('We use React and PostgreSQL for our stack');
      const names = entities.map(e => e.name);
      assert.ok(names.includes('React'));
      assert.ok(names.includes('PostgreSQL'));
    });

    it('resolves aliases to canonical names', () => {
      const entities = extractEntities('Using Postgres with ReactJS frontend');
      const names = entities.map(e => e.name);
      assert.ok(names.includes('PostgreSQL'), 'Postgres should resolve to PostgreSQL');
      assert.ok(names.includes('React'), 'ReactJS should resolve to React');
    });

    it('assigns high confidence (0.95) to technologies', () => {
      const entities = extractEntities('Docker is running');
      const docker = entities.find(e => e.name === 'Docker');
      assert.ok(docker);
      assert.equal(docker!.confidence, 0.95);
    });
  });

  describe('CamelCase detection', () => {
    it('detects CamelCase component names', () => {
      const entities = extractEntities('The UserProfileCard renders user data');
      const found = entities.find(e => e.name === 'UserProfileCard');
      assert.ok(found, 'should detect CamelCase');
      assert.equal(found!.type, 'module');
      assert.equal(found!.confidence, 0.8);
    });

    it('skips CamelCase that are known technologies', () => {
      const entities = extractEntities('Using JavaScript and TypeScript together');
      // These should be detected as technologies, not CamelCase modules
      const jsEntity = entities.find(e => e.name === 'JavaScript');
      assert.ok(jsEntity);
      assert.equal(jsEntity!.type, 'library');
    });
  });

  describe('ALL_CAPS detection', () => {
    it('detects ALL_CAPS constants', () => {
      const entities = extractEntities('Set MAX_RETRIES to 5 and DATABASE_URL to the connection string');
      const names = entities.map(e => e.name);
      assert.ok(names.includes('MAX_RETRIES'));
      assert.ok(names.includes('DATABASE_URL'));
    });

    it('skips common ALL_CAPS non-entities', () => {
      const entities = extractEntities('The API uses HTTP GET requests with JSON responses');
      const names = entities.map(e => e.name);
      assert.ok(!names.includes('API'));
      assert.ok(!names.includes('HTTP'));
      assert.ok(!names.includes('JSON'));
    });

    it('assigns config type with 0.7 confidence', () => {
      const entities = extractEntities('Set MAX_POOL_SIZE appropriately');
      const found = entities.find(e => e.name === 'MAX_POOL_SIZE');
      assert.ok(found);
      assert.equal(found!.type, 'config');
      assert.equal(found!.confidence, 0.7);
    });
  });

  describe('file path detection', () => {
    it('detects file paths', () => {
      const entities = extractEntities('Edit src/core/pipeline.ts to add the hook');
      const found = entities.find(e => e.type === 'file');
      assert.ok(found, 'should detect file path');
      assert.ok(found!.name.includes('src/core/pipeline.ts'));
    });

    it('detects relative paths', () => {
      const entities = extractEntities('Check ./config/settings.json for details');
      const found = entities.find(e => e.type === 'file');
      assert.ok(found);
    });
  });

  describe('person name detection', () => {
    it('detects person names (capitalized multi-word)', () => {
      const entities = extractEntities('John Smith reviewed the pull request yesterday');
      const found = entities.find(e => e.type === 'person');
      assert.ok(found, 'should detect person name');
      assert.ok(found!.name.includes('John Smith'));
      assert.equal(found!.confidence, 0.6);
    });
  });

  describe('issue reference detection', () => {
    it('detects #123 issue references', () => {
      const entities = extractEntities('This fixes #42 and relates to #100');
      const issues = entities.filter(e => e.type === 'bug');
      assert.ok(issues.length >= 2, 'should find both issue refs');
      const names = issues.map(e => e.name);
      assert.ok(names.includes('#42'));
      assert.ok(names.includes('#100'));
    });
  });

  describe('version detection', () => {
    it('detects version numbers', () => {
      const entities = extractEntities('Upgraded from v1.2.3 to v2.0.0');
      const versions = entities.filter(e => e.name.startsWith('v'));
      assert.ok(versions.length >= 2);
    });
  });

  describe('alias resolution', () => {
    it('resolves known alias', () => {
      const result = resolveAlias('Postgres');
      assert.equal(result.canonical, 'PostgreSQL');
      assert.equal(result.isAlias, true);
    });

    it('returns canonical name unchanged', () => {
      const result = resolveAlias('React');
      assert.equal(result.canonical, 'React');
      assert.equal(result.isAlias, false);
    });

    it('case-insensitive alias matching', () => {
      const result = resolveAlias('reactjs');
      assert.equal(result.canonical, 'React');
      assert.equal(result.isAlias, true);
    });

    it('unknown name returns itself', () => {
      const result = resolveAlias('MyCustomLib');
      assert.equal(result.canonical, 'MyCustomLib');
      assert.equal(result.isAlias, false);
    });
  });

  describe('edge cases', () => {
    it('empty content returns empty array', () => {
      assert.deepEqual(extractEntities(''), []);
      assert.deepEqual(extractEntities('   '), []);
    });

    it('deduplicates same entity mentioned multiple times', () => {
      const entities = extractEntities('React React React React React is great');
      const reactEntities = entities.filter(e => e.name === 'React');
      assert.equal(reactEntities.length, 1);
    });

    it('mixed content detects multiple entity types', () => {
      const content = 'John Smith fixed #42 by updating src/auth/login.ts to use React v18.2.0 with MAX_TIMEOUT=5000';
      const entities = extractEntities(content);
      const types = new Set(entities.map(e => e.type));
      assert.ok(types.size >= 3, `expected 3+ entity types, got ${types.size}: ${[...types]}`);
    });
  });
});
