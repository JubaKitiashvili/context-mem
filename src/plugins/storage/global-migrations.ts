export interface GlobalMigration {
  version: number;
  description: string;
  up: string;
}

export const LATEST_GLOBAL_VERSION = 1;

export const globalMigrations: GlobalMigration[] = [
  {
    version: 1,
    description: 'Global knowledge store — knowledge table with source_project, FTS5 index',
    up: `
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
        last_accessed INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        source_type TEXT DEFAULT 'observed',
        source_project TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gk_category ON knowledge(category);
      CREATE INDEX IF NOT EXISTS idx_gk_source_project ON knowledge(source_project);
      CREATE INDEX IF NOT EXISTS idx_gk_created_at ON knowledge(created_at);

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        title, content, tags,
        content=knowledge,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS gk_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS gk_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS gk_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags);
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags);
      END;

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      );

      INSERT INTO schema_version (version, applied_at, description)
      VALUES (1, unixepoch(), 'Global knowledge store — initial schema');
    `,
  },
];
