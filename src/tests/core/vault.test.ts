import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { VaultSync } from '../../core/vault.js';
import { renderEntityPage, renderIndex } from '../../core/vault-templates.js';

describe('VaultSync', () => {
  let tmp: string;
  let dbPath: string;
  let vaultDir: string;
  let storage: BetterSqlite3Storage;
  let vault: VaultSync;

  before(async () => {
    tmp = path.join(os.tmpdir(), `cm-vault-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    dbPath = path.join(tmp, 'store.db');
    vaultDir = path.join(tmp, 'vault');
    storage = new BetterSqlite3Storage();
    await storage.open(dbPath);
  });

  beforeEach(() => {
    if (fs.existsSync(vaultDir)) {
      fs.rmSync(vaultDir, { recursive: true });
    }
    vault = new VaultSync(storage, { vaultDir });
  });

  after(async () => {
    vault.stop();
    await storage.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('creates vault directory structure on init', async () => {
    await vault.init();
    for (const sub of ['sources', 'entities', 'topics', 'knowledge']) {
      assert.ok(fs.existsSync(path.join(vaultDir, sub)), `${sub} dir missing`);
    }
  });

  it('writes index.md on init', async () => {
    await vault.init();
    const indexPath = path.join(vaultDir, 'index.md');
    assert.ok(fs.existsSync(indexPath));
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('Context-Mem Vault'));
  });

  it('writes log.md on init', async () => {
    await vault.init();
    const logPath = path.join(vaultDir, 'log.md');
    assert.ok(fs.existsSync(logPath));
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('Event Log'));
  });

  it('writes entity page when entity added', async () => {
    await vault.init();
    const now = Date.now();
    storage.exec(
      `INSERT INTO entities (id, name, entity_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['e1', 'Postgres', 'library', '{}', now, now],
    );
    await vault.refreshEntity('Postgres');
    const pagePath = path.join(vaultDir, 'entities', 'Postgres.md');
    assert.ok(fs.existsSync(pagePath));
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('Postgres'));
    assert.ok(content.includes('library'));
  });

  it('writes session page when session observed', async () => {
    await vault.init();
    const sid = 'sess-test-001';
    const now = Date.now();
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs1', 'code', 'console.log("hi")', 'log hi', '{}', now, sid],
    );
    await vault.refreshSession(sid);
    const date = new Date(now).toISOString().slice(0, 10);
    const pagePath = path.join(vaultDir, 'sources', `${sid}-${date}.md`);
    assert.ok(fs.existsSync(pagePath));
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes(sid));
  });

  it('appends to log.md on event', async () => {
    await vault.init();
    await vault.logEvent('observe', 'new observation added');
    const logPath = path.join(vaultDir, 'log.md');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('observe'));
    assert.ok(content.includes('new observation added'));
  });

  it('updates index.md when pages change', async () => {
    await vault.init();
    const now = Date.now();
    storage.exec(
      `INSERT INTO entities (id, name, entity_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['e2', 'Redis', 'library', '{}', now, now],
    );
    await vault.refreshIndex();
    const indexPath = path.join(vaultDir, 'index.md');
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('Redis'));
  });

  it('is safe to init twice without data loss', async () => {
    await vault.init();
    await vault.logEvent('first', 'first event');
    const logBefore = fs.readFileSync(path.join(vaultDir, 'log.md'), 'utf8');
    await vault.init();
    const logAfter = fs.readFileSync(path.join(vaultDir, 'log.md'), 'utf8');
    assert.equal(logBefore, logAfter, 'second init should not overwrite log.md');
    assert.ok(fs.existsSync(path.join(vaultDir, 'index.md')));
  });

  it('vault.enabled=false prevents any writes', async () => {
    const disabledVault = new VaultSync(storage, { vaultDir, enabled: false });
    await disabledVault.init();
    assert.ok(!fs.existsSync(vaultDir), 'vault dir should not be created when disabled');
    disabledVault.stop();
  });

  it('sanitizes entity names to prevent path traversal', async () => {
    await vault.init();
    storage.exec(
      `INSERT INTO entities (id, name, entity_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['e-trav', '../../escape', 'library', '{}', Date.now(), Date.now()],
    );
    await vault.refreshEntity('../../escape');
    const escapedPath = path.join(vaultDir, '..', '..', 'escape.md');
    assert.ok(!fs.existsSync(escapedPath), 'must not escape vault dir');
  });

  it('logEvent appends a formatted entry with event name and summary', async () => {
    await vault.init();
    await vault.logEvent('ingest', 'code: console.log("hello")');
    const logPath = path.join(vaultDir, 'log.md');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('ingest'), 'log.md must include event type');
    assert.ok(content.includes('console.log("hello")'), 'log.md must include summary text');
    // Entry must follow the ## [datetime] event | summary pattern
    assert.match(content, /##\s+\[\d{4}-\d{2}-\d{2}/);
  });

  it('renderEntityPage backlinks apply safeName to dangerous names', () => {
    const entity = {
      id: 'e-safe',
      name: 'SafeEntity',
      entity_type: 'person',
      metadata: '{}',
      knowledge_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    const dangerousBacklink = '../../evil';
    const rendered = renderEntityPage(entity, [dangerousBacklink]);
    // The raw dangerous string must not appear as a wikilink target
    assert.ok(!rendered.includes('[[../../evil]]'), 'raw path traversal must not appear in backlinks');
    // The sanitized form must appear with entities/ prefix
    assert.ok(rendered.includes('[[entities/------evil]]'), 'sanitized backlink must appear with entities/ prefix');
  });

  it('renderIndex enriches entity links with updated date and topic links with observation count', () => {
    const now = Date.now();
    const entity = {
      id: 'e-idx',
      name: 'Postgres',
      entity_type: 'library',
      metadata: '{}',
      knowledge_id: null,
      created_at: now,
      updated_at: now,
    };
    const topic = {
      id: 't-idx',
      name: 'authentication',
      parent_id: null,
      observation_count: 12,
      last_seen: now,
    };
    const rendered = renderIndex(
      { observations: 1, entities: 1, topics: 1, knowledge: 0, sessions: 0 },
      [entity],
      [topic],
      [],
    );
    assert.match(rendered, /\[\[entities\/Postgres\]\] — updated \d{4}-\d{2}-\d{2}/);
    assert.ok(rendered.includes('[[topics/authentication]] — 12 observations'));
  });
});
