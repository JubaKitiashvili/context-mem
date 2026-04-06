import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ContentStore } from '../../../plugins/storage/content-store.js';
import { BetterSqlite3Storage } from '../../../plugins/storage/better-sqlite3.js';
import { createTestDb } from '../../helpers.js';

describe('ContentStore', () => {
  let storage: BetterSqlite3Storage;
  let store: ContentStore;

  beforeEach(async () => {
    storage = await createTestDb();
    store = new ContentStore(storage);
  });

  afterEach(async () => { await storage.close(); });

  // --- index ---

  it('index returns a positive integer source id', () => {
    const id = store.index('Hello world', 'test-source');
    assert.ok(typeof id === 'number');
    assert.ok(id > 0);
  });

  it('index is idempotent — same source returns same id', () => {
    const id1 = store.index('Hello world', 'test-source');
    const id2 = store.index('Hello world different content', 'test-source');
    assert.equal(id1, id2);
  });

  it('index creates content_sources row', () => {
    store.index('Some content', 'my-source');
    const row = storage.prepare('SELECT * FROM content_sources WHERE source = ?').get('my-source') as Record<string, unknown> | undefined;
    assert.ok(row !== undefined);
    assert.equal(row.source, 'my-source');
  });

  it('index creates at least one content_chunks row', () => {
    store.index('Some content here', 'src-a');
    const row = storage.prepare('SELECT COUNT(*) as n FROM content_chunks WHERE source_id = (SELECT id FROM content_sources WHERE source = ?)').get('src-a') as { n: number };
    assert.ok(row.n >= 1);
  });

  it('index different sources get different ids', () => {
    const id1 = store.index('Content A', 'source-a');
    const id2 = store.index('Content B', 'source-b');
    assert.notEqual(id1, id2);
  });

  // --- chunking: JSON ---

  it('index treats valid JSON as a single chunk', () => {
    const json = JSON.stringify({ key: 'value', nested: { a: 1 } });
    store.index(json, 'json-source');
    const row = storage.prepare('SELECT COUNT(*) as n FROM content_chunks WHERE source_id = (SELECT id FROM content_sources WHERE source = ?)').get('json-source') as { n: number };
    assert.equal(row.n, 1);
  });

  // --- chunking: Markdown headings ---

  it('index splits Markdown content by headings', () => {
    const md = `# Introduction\n\nThis is an intro.\n\n## Setup\n\nSetup steps here.\n\n## Usage\n\nUsage instructions.`;
    store.index(md, 'md-source');
    const row = storage.prepare('SELECT COUNT(*) as n FROM content_chunks WHERE source_id = (SELECT id FROM content_sources WHERE source = ?)').get('md-source') as { n: number };
    // Should produce 3 chunks (one per heading)
    assert.ok(row.n >= 2);
  });

  it('index records headings on heading chunks', () => {
    const md = `# Introduction\n\nThis is intro content.\n\n## Setup\n\nSetup content here.`;
    store.index(md, 'md-headings');
    const chunks = storage.prepare(
      'SELECT heading FROM content_chunks WHERE source_id = (SELECT id FROM content_sources WHERE source = ?) AND heading IS NOT NULL'
    ).all('md-headings') as Array<{ heading: string }>;
    assert.ok(chunks.length >= 1);
    const headings = chunks.map(c => c.heading);
    assert.ok(headings.includes('Introduction') || headings.includes('Setup'));
  });

  // --- chunking: code blocks ---

  it('index marks chunks containing code as has_code=1', () => {
    const content = 'Some text here.\n\n```typescript\nconst x = 1;\n```\n\nMore text.';
    store.index(content, 'code-source');
    const codeChunk = storage.prepare(
      'SELECT has_code FROM content_chunks WHERE source_id = (SELECT id FROM content_sources WHERE source = ?) AND has_code = 1'
    ).get('code-source') as { has_code: number } | undefined;
    assert.ok(codeChunk !== undefined);
    assert.equal(codeChunk.has_code, 1);
  });

  it('index preserves code blocks in chunk content', () => {
    const content = 'Intro paragraph.\n\n```js\nconsole.log("hello");\n```\n\nConclusion.';
    store.index(content, 'code-preserve');
    const chunk = storage.prepare(
      'SELECT content FROM content_chunks WHERE source_id = (SELECT id FROM content_sources WHERE source = ?) AND has_code = 1'
    ).get('code-preserve') as { content: string } | undefined;
    assert.ok(chunk !== undefined);
    assert.ok(chunk.content.includes('console.log'));
  });

  // --- search ---

  it('search returns empty array for unknown query', () => {
    store.index('The quick brown fox jumps over the lazy dog', 'fox-source');
    const results = store.search('zzzunknownxxx');
    assert.equal(results.length, 0);
  });

  it('search finds indexed content by keyword', () => {
    store.index('Authentication middleware validates JWT tokens', 'auth-source');
    const results = store.search('authentication');
    assert.ok(results.length >= 1);
    assert.ok(results[0].content.toLowerCase().includes('auth'));
  });

  it('search result includes source field', () => {
    store.index('This is test content for searching', 'my-source-name');
    const results = store.search('test');
    assert.ok(results.length >= 1);
    assert.equal(results[0].source, 'my-source-name');
  });

  it('search result includes relevance score', () => {
    store.index('Token budget management and overflow handling', 'budget-source');
    const results = store.search('token budget');
    assert.ok(results.length >= 1);
    assert.ok(typeof results[0].relevance === 'number');
    assert.ok(results[0].relevance >= 0);
  });

  it('search result includes heading (may be null for non-heading chunks)', () => {
    store.index('Plain paragraph content without any headings at all', 'plain-source');
    const results = store.search('paragraph content');
    assert.ok(results.length >= 1);
    // heading can be null or string
    assert.ok(results[0].heading === null || typeof results[0].heading === 'string');
  });

  it('search result has_code is boolean', () => {
    store.index('Simple text without code', 'no-code-source');
    const results = store.search('simple text');
    assert.ok(results.length >= 1);
    assert.ok(typeof results[0].has_code === 'boolean');
  });

  it('search respects limit option', () => {
    store.index('# Section A\n\nContent about apples and oranges.\n\n## Section B\n\nMore about apples.\n\n## Section C\n\nEven more apples here.', 'multi-source');
    const results = store.search('apples', { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('search respects source filter', () => {
    store.index('authentication token validation', 'source-alpha');
    store.index('authentication bypass vulnerability', 'source-beta');
    const results = store.search('authentication', { source: 'source-alpha' });
    assert.ok(results.length >= 1);
    for (const r of results) assert.equal(r.source, 'source-alpha');
  });

  it('search returns empty for empty/invalid query', () => {
    store.index('Some content', 'src');
    const results = store.search('');
    assert.equal(results.length, 0);
  });

  it('search across multiple indexed sources returns results from all', () => {
    store.index('React component lifecycle methods', 'react-docs');
    store.index('React hooks useState and useEffect', 'hooks-docs');
    const results = store.search('react');
    assert.ok(results.length >= 2);
  });

  // --- content budget cap ---

  it('search truncates large text responses to stay within budget', () => {
    // Create a large text chunk (well over 1536 bytes)
    const largeText = 'alpha beta gamma delta epsilon '.repeat(200); // ~6000 chars
    store.index(largeText, 'large-source');
    const results = store.search('alpha beta');
    // Budget applies: total bytes of results should be <= ~1.5KB + some tolerance
    let totalBytes = 0;
    for (const r of results) totalBytes += Buffer.byteLength(r.content, 'utf8');
    assert.ok(totalBytes <= 2000, `Total content bytes ${totalBytes} exceeded budget`);
  });
});
