import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, migrations } from '../../../plugins/storage/migrations.js';

describe('migrations', () => {
  it('LATEST_SCHEMA_VERSION is 16', () => {
    assert.equal(LATEST_SCHEMA_VERSION, 16);
  });

  it('migrations array has 16 entries', () => {
    assert.equal(migrations.length, 16);
  });

  it('each migration has version, description, and up', () => {
    for (const m of migrations) {
      assert.equal(typeof m.version, 'number');
      assert.equal(typeof m.description, 'string');
      assert.ok(m.description.length > 0);
      assert.equal(typeof m.up, 'string');
      assert.ok(m.up.length > 0);
    }
  });

  describe('migration v1 SQL', () => {
    const v1 = migrations.find(m => m.version === 1)!;

    it('contains expected tables', () => {
      const tables = ['observations', 'obs_fts', 'obs_trigram', 'token_stats', 'schema_version'];
      for (const table of tables) {
        assert.ok(v1.up.includes(table), `missing table: ${table}`);
      }
    });

    it('contains expected indexes', () => {
      const indexes = ['idx_obs_type', 'idx_obs_indexed_at', 'idx_obs_session'];
      for (const idx of indexes) {
        assert.ok(v1.up.includes(idx), `missing index: ${idx}`);
      }
    });

    it('contains triggers obs_ai, obs_ad, obs_au', () => {
      const triggers = ['obs_ai', 'obs_ad', 'obs_au'];
      for (const trigger of triggers) {
        assert.ok(v1.up.includes(trigger), `missing trigger: ${trigger}`);
      }
    });
  });

  describe('migration v2 SQL', () => {
    const v2 = migrations.find(m => m.version === 2)!;

    it('recreates obs_trigram with only summary column', () => {
      assert.ok(v2.up.includes('DROP TABLE IF EXISTS obs_trigram'));
      assert.ok(v2.up.includes('CREATE VIRTUAL TABLE IF NOT EXISTS obs_trigram'));
      // Verify the trigram table only indexes summary (no content column)
      const trigramMatch = v2.up.match(/obs_trigram USING fts5\(\s*(\w+)/);
      assert.ok(trigramMatch);
      assert.equal(trigramMatch![1], 'summary');
    });
  });

  it('v10 creates session_chains table with correct columns', () => {
    const sql = migrations[9].up;
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS session_chains'));
    assert.ok(sql.includes('chain_id TEXT NOT NULL'));
    assert.ok(sql.includes('session_id TEXT PRIMARY KEY'));
    assert.ok(sql.includes('parent_session TEXT'));
    assert.ok(sql.includes('project_path TEXT NOT NULL'));
    assert.ok(sql.includes('handoff_reason TEXT NOT NULL'));
    assert.ok(sql.includes('summary TEXT'));
    assert.ok(sql.includes('token_estimate INTEGER'));
  });

  it('v10 creates required indexes', () => {
    const sql = migrations[9].up;
    assert.ok(sql.includes('idx_chains_session'));
    assert.ok(sql.includes('idx_chains_parent'));
    assert.ok(sql.includes('idx_chains_created'));
    assert.ok(sql.includes('idx_chains_project'));
  });

  it('v11 creates session_access_log table with correct columns', () => {
    const sql = migrations[10].up;
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS session_access_log'));
    assert.ok(sql.includes('knowledge_id TEXT NOT NULL'));
    assert.ok(sql.includes('session_id TEXT NOT NULL'));
    assert.ok(sql.includes('accessed_at INTEGER NOT NULL'));
    assert.ok(sql.includes('UNIQUE(knowledge_id, session_id)'));
  });

  it('v11 creates required indexes on session_access_log', () => {
    const sql = migrations[10].up;
    assert.ok(sql.includes('idx_sal_knowledge'));
    assert.ok(sql.includes('idx_sal_session'));
  });

  it('v11 adds auto_promoted column to knowledge table', () => {
    const sql = migrations[10].up;
    assert.ok(sql.includes('ALTER TABLE knowledge ADD COLUMN auto_promoted INTEGER DEFAULT 0'));
  });

  describe('migration v13 SQL', () => {
    const v13 = migrations.find(m => m.version === 13)!;

    it('adds importance_score, pinned, compression_tier columns', () => {
      assert.ok(v13.up.includes('ALTER TABLE observations ADD COLUMN importance_score REAL DEFAULT 0.5'));
      assert.ok(v13.up.includes('ALTER TABLE observations ADD COLUMN pinned INTEGER DEFAULT 0'));
      assert.ok(v13.up.includes("ALTER TABLE observations ADD COLUMN compression_tier TEXT DEFAULT 'verbatim'"));
    });

    it('creates obs_content_fts table', () => {
      assert.ok(v13.up.includes('CREATE VIRTUAL TABLE IF NOT EXISTS obs_content_fts USING fts5'));
    });

    it('recreates triggers with obs_content_fts sync', () => {
      assert.ok(v13.up.includes('DROP TRIGGER IF EXISTS obs_ai'));
      assert.ok(v13.up.includes('DROP TRIGGER IF EXISTS obs_ad'));
      assert.ok(v13.up.includes('DROP TRIGGER IF EXISTS obs_au'));
      assert.ok(v13.up.includes('INSERT INTO obs_content_fts(rowid, content) VALUES (NEW.rowid, NEW.content)'));
    });

    it('rebuilds content FTS index', () => {
      assert.ok(v13.up.includes("INSERT INTO obs_content_fts(obs_content_fts) VALUES('rebuild')"));
    });
  });

  it('v13 columns are usable after migration', () => {
    const db = new Database(':memory:');
    for (const m of migrations) {
      db.exec(m.up);
    }

    // Insert with new columns
    db.exec(`INSERT INTO observations (id, type, content, summary, metadata, indexed_at, importance_score, pinned, compression_tier)
             VALUES ('tr1', 'decision', 'We decided to use Redis', 'Use Redis', '{}', 1000, 0.9, 1, 'verbatim')`);

    const row = db.prepare('SELECT importance_score, pinned, compression_tier FROM observations WHERE id = ?').get('tr1') as {
      importance_score: number; pinned: number; compression_tier: string;
    };
    assert.equal(row.importance_score, 0.9);
    assert.equal(row.pinned, 1);
    assert.equal(row.compression_tier, 'verbatim');

    // Verify content FTS index works
    const ftsResults = db.prepare("SELECT rowid FROM obs_content_fts WHERE obs_content_fts MATCH 'Redis'").all();
    assert.ok(ftsResults.length >= 1);

    // Verify defaults on insert without specifying new columns
    db.exec(`INSERT INTO observations (id, type, content, summary, metadata, indexed_at)
             VALUES ('tr2', 'context', 'some content', 'some summary', '{}', 2000)`);
    const row2 = db.prepare('SELECT importance_score, pinned, compression_tier FROM observations WHERE id = ?').get('tr2') as {
      importance_score: number; pinned: number; compression_tier: string;
    };
    assert.equal(row2.importance_score, 0.5);
    assert.equal(row2.pinned, 0);
    assert.equal(row2.compression_tier, 'verbatim');

    db.close();
  });

  describe('migration v14 SQL', () => {
    const v14 = migrations.find(m => m.version === 14)!;

    it('adds canonical_id and aliases to entities', () => {
      assert.ok(v14.up.includes('ALTER TABLE entities ADD COLUMN canonical_id TEXT'));
      assert.ok(v14.up.includes("ALTER TABLE entities ADD COLUMN aliases TEXT DEFAULT '[]'"));
      assert.ok(v14.up.includes('idx_entities_canonical'));
    });

    it('adds temporal columns to knowledge', () => {
      assert.ok(v14.up.includes('ALTER TABLE knowledge ADD COLUMN valid_from INTEGER'));
      assert.ok(v14.up.includes('ALTER TABLE knowledge ADD COLUMN valid_to INTEGER'));
      assert.ok(v14.up.includes('ALTER TABLE knowledge ADD COLUMN superseded_by TEXT'));
    });

    it('adds last_useful_at to observations and knowledge', () => {
      assert.ok(v14.up.includes('ALTER TABLE observations ADD COLUMN last_useful_at INTEGER'));
      assert.ok(v14.up.includes('ALTER TABLE knowledge ADD COLUMN last_useful_at INTEGER'));
    });
  });

  describe('migration v15 SQL', () => {
    const v15 = migrations.find(m => m.version === 15)!;

    it('creates topics and observation_topics tables', () => {
      assert.ok(v15.up.includes('CREATE TABLE IF NOT EXISTS topics'));
      assert.ok(v15.up.includes('CREATE TABLE IF NOT EXISTS observation_topics'));
      assert.ok(v15.up.includes('idx_ot_topic'));
    });
  });

  it('v15 topics tables are usable after migration', () => {
    const db = new Database(':memory:');
    for (const m of migrations) { db.exec(m.up); }

    db.exec(`INSERT INTO topics (id, name, observation_count, last_seen) VALUES ('t1', 'database', 5, 1000)`);
    db.exec(`INSERT INTO observation_topics (observation_id, topic_id, confidence) VALUES ('obs1', 't1', 0.9)`);

    const topic = db.prepare('SELECT name, observation_count FROM topics WHERE id = ?').get('t1') as { name: string; observation_count: number };
    assert.equal(topic.name, 'database');
    assert.equal(topic.observation_count, 5);

    const ot = db.prepare('SELECT confidence FROM observation_topics WHERE observation_id = ? AND topic_id = ?').get('obs1', 't1') as { confidence: number };
    assert.equal(ot.confidence, 0.9);

    db.close();
  });

  it('v14 columns are usable after migration', () => {
    const db = new Database(':memory:');
    for (const m of migrations) {
      db.exec(m.up);
    }

    // Test entity alias columns
    db.exec(`INSERT INTO entities (id, name, entity_type, metadata, created_at, updated_at, canonical_id, aliases)
             VALUES ('e1', 'React.js', 'library', '{}', 1000, 1000, 'e-react', '["React","ReactJS"]')`);
    const entity = db.prepare('SELECT canonical_id, aliases FROM entities WHERE id = ?').get('e1') as {
      canonical_id: string; aliases: string;
    };
    assert.equal(entity.canonical_id, 'e-react');
    assert.equal(JSON.parse(entity.aliases).length, 2);

    // Test temporal columns on knowledge
    db.exec(`INSERT INTO knowledge (id, category, title, content, tags, created_at, valid_from, valid_to, superseded_by)
             VALUES ('k1', 'decision', 'Use Redis', 'Cache with Redis', '[]', 1000, 1000, 2000, 'k2')`);
    const kn = db.prepare('SELECT valid_from, valid_to, superseded_by FROM knowledge WHERE id = ?').get('k1') as {
      valid_from: number; valid_to: number; superseded_by: string;
    };
    assert.equal(kn.valid_from, 1000);
    assert.equal(kn.valid_to, 2000);
    assert.equal(kn.superseded_by, 'k2');

    // Test last_useful_at on observations
    db.exec(`INSERT INTO observations (id, type, content, metadata, indexed_at, last_useful_at)
             VALUES ('o1', 'context', 'test', '{}', 1000, 5000)`);
    const obs = db.prepare('SELECT last_useful_at FROM observations WHERE id = ?').get('o1') as { last_useful_at: number };
    assert.equal(obs.last_useful_at, 5000);

    db.close();
  });

  describe('running migrations on in-memory database', () => {
    it('applies all migrations without error', () => {
      const db = new Database(':memory:');
      for (const m of migrations) {
        db.exec(m.up);
      }

      // Verify schema_version has all entries
      const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>;
      assert.equal(versions.length, 16);
      assert.equal(versions[0].version, 1);
      assert.equal(versions[1].version, 2);
      assert.equal(versions[2].version, 3);
      assert.equal(versions[3].version, 4);
      assert.equal(versions[4].version, 5);
      assert.equal(versions[5].version, 6);
      assert.equal(versions[6].version, 7);
      assert.equal(versions[7].version, 8);
      assert.equal(versions[8].version, 9);
      assert.equal(versions[9].version, 10);
      assert.equal(versions[10].version, 11);
      assert.equal(versions[11].version, 12);
      assert.equal(versions[12].version, 13);
      assert.equal(versions[13].version, 14);
      assert.equal(versions[14].version, 15);
      assert.equal(versions[15].version, 16);

      // Verify observations table exists and is insertable
      db.exec(`INSERT INTO observations (id, type, content, summary, metadata, indexed_at)
               VALUES ('test1', 'note', 'hello world', 'greeting', '{}', 1000)`);

      const row = db.prepare('SELECT id, summary FROM observations WHERE id = ?').get('test1') as { id: string; summary: string };
      assert.equal(row.id, 'test1');
      assert.equal(row.summary, 'greeting');

      // Verify FTS5 index works
      const ftsResults = db.prepare("SELECT rowid FROM obs_fts WHERE obs_fts MATCH 'greeting'").all();
      assert.ok(ftsResults.length >= 1);

      // Verify trigram index works
      const trigramResults = db.prepare("SELECT rowid FROM obs_trigram WHERE obs_trigram MATCH 'gree'").all();
      assert.ok(trigramResults.length >= 1);

      // Verify token_stats table exists
      db.exec(`INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp)
               VALUES ('s1', 'query', 100, 50, 1000)`);
      const ts = db.prepare('SELECT * FROM token_stats WHERE session_id = ?').get('s1') as { session_id: string };
      assert.equal(ts.session_id, 's1');

      // Verify session_access_log table exists and is insertable
      db.exec(`INSERT INTO session_access_log (knowledge_id, session_id, accessed_at)
               VALUES ('k1', 'sess1', 1000)`);
      db.exec(`INSERT INTO session_access_log (knowledge_id, session_id, accessed_at)
               VALUES ('k1', 'sess2', 2000)`);
      const salRows = db.prepare('SELECT * FROM session_access_log WHERE knowledge_id = ?').all('k1') as Array<{ knowledge_id: string; session_id: string }>;
      assert.equal(salRows.length, 2);

      // Verify UNIQUE(knowledge_id, session_id) constraint prevents duplicates
      assert.throws(() => {
        db.exec(`INSERT INTO session_access_log (knowledge_id, session_id, accessed_at)
                 VALUES ('k1', 'sess1', 9999)`);
      });

      // Verify auto_promoted column exists on knowledge table with default 0
      db.exec(`INSERT INTO knowledge (id, category, title, content, tags, created_at)
               VALUES ('kn1', 'test', 'Test Title', 'Test content', '[]', 1000)`);
      const kn = db.prepare('SELECT id, auto_promoted FROM knowledge WHERE id = ?').get('kn1') as { id: string; auto_promoted: number };
      assert.equal(kn.id, 'kn1');
      assert.equal(kn.auto_promoted, 0);

      db.close();
    });
  });
});
