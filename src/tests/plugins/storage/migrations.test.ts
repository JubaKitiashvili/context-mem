import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, migrations } from '../../../plugins/storage/migrations.js';

describe('migrations', () => {
  it('LATEST_SCHEMA_VERSION is 4', () => {
    assert.equal(LATEST_SCHEMA_VERSION, 4);
  });

  it('migrations array has 4 entries', () => {
    assert.equal(migrations.length, 4);
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

  describe('running migrations on in-memory database', () => {
    it('applies all migrations without error', () => {
      const db = new Database(':memory:');
      for (const m of migrations) {
        db.exec(m.up);
      }

      // Verify schema_version has all entries
      const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>;
      assert.equal(versions.length, 4);
      assert.equal(versions[0].version, 1);
      assert.equal(versions[1].version, 2);
      assert.equal(versions[2].version, 3);
      assert.equal(versions[3].version, 4);

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

      db.close();
    });
  });
});
