export interface Migration {
  version: number;
  description: string;
  up: string;
}

export const LATEST_SCHEMA_VERSION = 8;

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
        summary,
        content=observations,
        content_rowid=rowid,
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS obs_ai AFTER INSERT ON observations BEGIN
        INSERT INTO obs_fts(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
        INSERT INTO obs_trigram(rowid, summary) VALUES (NEW.rowid, NEW.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS obs_ad AFTER DELETE ON observations BEGIN
        INSERT INTO obs_fts(obs_fts, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_trigram(obs_trigram, rowid, summary) VALUES ('delete', OLD.rowid, OLD.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS obs_au AFTER UPDATE ON observations BEGIN
        INSERT INTO obs_fts(obs_fts, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_fts(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
        INSERT INTO obs_trigram(obs_trigram, rowid, summary) VALUES ('delete', OLD.rowid, OLD.summary);
        INSERT INTO obs_trigram(rowid, summary) VALUES (NEW.rowid, NEW.summary);
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
  {
    version: 2,
    description: 'Optimize trigram index — index only summary column',
    up: `
      DROP TABLE IF EXISTS obs_trigram;

      CREATE VIRTUAL TABLE IF NOT EXISTS obs_trigram USING fts5(
        summary,
        content=observations,
        content_rowid=rowid,
        tokenize='trigram'
      );

      DROP TRIGGER IF EXISTS obs_ai;
      DROP TRIGGER IF EXISTS obs_ad;
      DROP TRIGGER IF EXISTS obs_au;

      CREATE TRIGGER IF NOT EXISTS obs_ai AFTER INSERT ON observations BEGIN
        INSERT INTO obs_fts(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
        INSERT INTO obs_trigram(rowid, summary) VALUES (NEW.rowid, NEW.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS obs_ad AFTER DELETE ON observations BEGIN
        INSERT INTO obs_fts(obs_fts, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_trigram(obs_trigram, rowid, summary) VALUES ('delete', OLD.rowid, OLD.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS obs_au AFTER UPDATE ON observations BEGIN
        INSERT INTO obs_fts(obs_fts, rowid, summary, content) VALUES ('delete', OLD.rowid, OLD.summary, OLD.content);
        INSERT INTO obs_fts(rowid, summary, content) VALUES (NEW.rowid, NEW.summary, NEW.content);
        INSERT INTO obs_trigram(obs_trigram, rowid, summary) VALUES ('delete', OLD.rowid, OLD.summary);
        INSERT INTO obs_trigram(rowid, summary) VALUES (NEW.rowid, NEW.summary);
      END;

      -- Rebuild trigram index with existing data
      INSERT INTO obs_trigram(obs_trigram) VALUES('rebuild');

      INSERT INTO schema_version (version, applied_at, description)
      VALUES (2, unixepoch(), 'Optimize trigram index — index only summary column');
    `,
  },
  {
    version: 3,
    description: 'Add content_hash dedup, content store, knowledge base, budget, snapshots, events',
    up: `
      -- SHA256 deduplication column
      ALTER TABLE observations ADD COLUMN content_hash TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_content_hash ON observations(content_hash);

      -- Content store: sources
      CREATE TABLE IF NOT EXISTS content_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_hash TEXT UNIQUE NOT NULL,
        source TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      -- Content store: chunks
      CREATE TABLE IF NOT EXISTS content_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        heading TEXT,
        content TEXT NOT NULL,
        has_code INTEGER NOT NULL DEFAULT 0
      );

      -- Content chunks FTS5
      CREATE VIRTUAL TABLE IF NOT EXISTS content_chunks_fts USING fts5(
        heading, content,
        content=content_chunks,
        content_rowid=id,
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON content_chunks BEGIN
        INSERT INTO content_chunks_fts(rowid, heading, content) VALUES (NEW.id, NEW.heading, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON content_chunks BEGIN
        INSERT INTO content_chunks_fts(content_chunks_fts, rowid, heading, content) VALUES ('delete', OLD.id, OLD.heading, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON content_chunks BEGIN
        INSERT INTO content_chunks_fts(content_chunks_fts, rowid, heading, content) VALUES ('delete', OLD.id, OLD.heading, OLD.content);
        INSERT INTO content_chunks_fts(rowid, heading, content) VALUES (NEW.id, NEW.heading, NEW.content);
      END;

      -- Knowledge base
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        shareable INTEGER NOT NULL DEFAULT 1,
        relevance_score REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        title, content, tags,
        content=knowledge,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_trigram USING fts5(
        title, content,
        content=knowledge,
        content_rowid=rowid,
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags);
        INSERT INTO knowledge_trigram(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags);
        INSERT INTO knowledge_trigram(knowledge_trigram, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags);
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags);
        INSERT INTO knowledge_trigram(knowledge_trigram, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
        INSERT INTO knowledge_trigram(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
      END;

      -- Budget settings
      CREATE TABLE IF NOT EXISTS budget_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        session_limit INTEGER NOT NULL DEFAULT 100000,
        overflow_strategy TEXT NOT NULL DEFAULT 'warn',
        agent_limits TEXT NOT NULL DEFAULT '{}'
      );

      INSERT OR IGNORE INTO budget_settings (id, session_limit, overflow_strategy, agent_limits)
      VALUES (1, 100000, 'warn', '{}');

      -- Session snapshots
      CREATE TABLE IF NOT EXISTS snapshots (
        session_id TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- Event tracking
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 4,
        agent TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        context_bytes INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_priority ON events(priority);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

      INSERT INTO schema_version (version, applied_at, description)
      VALUES (3, unixepoch(), 'Add content_hash dedup, content store, knowledge base, budget, snapshots, events');
    `,
  },
  {
    version: 4,
    description: 'Add correlation_id for causality tracking',
    up: `
      ALTER TABLE observations ADD COLUMN correlation_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_obs_correlation ON observations(correlation_id);
      INSERT INTO schema_version (version, applied_at, description) VALUES (4, unixepoch(), 'Add correlation_id for causality tracking');
    `,
  },
  {
    version: 5,
    description: 'Add source_type to knowledge entries and project_profile table',
    up: `
      ALTER TABLE knowledge ADD COLUMN source_type TEXT DEFAULT 'observed';

      CREATE TABLE IF NOT EXISTS project_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        content TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      INSERT OR IGNORE INTO project_profile (id, content, updated_at) VALUES (1, '', 0);

      INSERT OR IGNORE INTO schema_version (version, applied_at, description)
      VALUES (5, unixepoch(), 'Add source_type to knowledge entries and project_profile table');
    `,
  },
  {
    version: 6,
    description: 'Add access_count to observations for search reranking',
    up: `
      ALTER TABLE observations ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;

      INSERT OR IGNORE INTO schema_version (version, applied_at, description)
      VALUES (6, unixepoch(), 'Add access_count to observations for search reranking');
    `,
  },
  {
    version: 7,
    description: 'Add last_accessed timestamp to knowledge entries for relevance decay',
    up: `
      ALTER TABLE knowledge ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0;

      INSERT OR IGNORE INTO schema_version (version, applied_at, description)
      VALUES (7, unixepoch(), 'Add last_accessed timestamp to knowledge entries for relevance decay');
    `,
  },
  {
    version: 8,
    description: 'Add stale flag to knowledge entries for Dreamer background validation',
    up: `
      ALTER TABLE knowledge ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;

      INSERT OR IGNORE INTO schema_version (version, applied_at, description)
      VALUES (8, unixepoch(), 'Add stale flag to knowledge entries for Dreamer background validation');
    `,
  },
];
