export interface Migration {
  version: number;
  description: string;
  up: string;
}

export const LATEST_SCHEMA_VERSION = 1;

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema with observations, FTS5, trigram, token_stats',
    up: `
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        embeddings BLOB,
        indexed_at INTEGER NOT NULL,
        privacy_level TEXT DEFAULT 'public',
        session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_obs_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_obs_indexed_at ON observations(indexed_at);
      CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_obs_privacy ON observations(privacy_level);

      CREATE VIRTUAL TABLE IF NOT EXISTS obs_fts USING fts5(
        summary, content,
        content=observations,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS obs_trigram USING fts5(
        summary, content,
        content=observations,
        content_rowid=rowid,
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS obs_ai AFTER INSERT ON observations BEGIN
        INSERT INTO obs_fts(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
        INSERT INTO obs_trigram(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS obs_ad AFTER DELETE ON observations BEGIN
        INSERT INTO obs_fts(obs_fts, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_trigram(obs_trigram, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS obs_au AFTER UPDATE ON observations BEGIN
        INSERT INTO obs_fts(obs_fts, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_fts(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
        INSERT INTO obs_trigram(obs_trigram, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_trigram(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
      END;

      CREATE TABLE IF NOT EXISTS token_stats (
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ts_session ON token_stats(session_id);
      CREATE INDEX IF NOT EXISTS idx_ts_event ON token_stats(event_type);

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      );

      INSERT INTO schema_version (version, applied_at, description)
      VALUES (1, unixepoch(), 'Initial schema');
    `,
  },
];
