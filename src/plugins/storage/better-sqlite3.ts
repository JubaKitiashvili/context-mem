import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { StoragePlugin, PluginConfig, Statement as IStatement } from '../../core/types.js';
import { migrations, LATEST_SCHEMA_VERSION } from './migrations.js';

export class BetterSqlite3Storage implements StoragePlugin {
  name = 'better-sqlite3-storage';
  version = '1.0.0';
  type = 'storage' as const;
  private db: Database.Database | null = null;
  private stmtCache = new Map<string, Database.Statement>();

  async init(_config: PluginConfig): Promise<void> {}

  async open(dbPath: string): Promise<void> {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('wal_autocheckpoint = 1000');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('cache_size = -8000');   // 8MB cache (negative = KB)
    this.db.pragma('mmap_size = 67108864'); // 64MB mmap
    this.db.pragma('synchronous = NORMAL'); // WAL mode safe with NORMAL

    this.runMigrations();
  }

  private runMigrations(): void {
    const db = this.getDb();
    const currentVersion = (db.pragma('user_version', { simple: true }) as number) || 0;

    if (currentVersion < LATEST_SCHEMA_VERSION) {
      const toRun = migrations.filter(m => m.version > currentVersion);
      for (const migration of toRun) {
        db.transaction(() => {
          db.exec(migration.up);
          db.pragma(`user_version = ${migration.version}`);
        })();
      }
    }
  }

  exec(sql: string, params?: unknown[]): void {
    const db = this.getDb();
    if (params && params.length > 0) {
      db.prepare(sql).run(...(params as unknown[]));
    } else {
      db.exec(sql);
    }
  }

  prepare(sql: string): IStatement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.getDb().prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt as unknown as IStatement;
  }

  async close(): Promise<void> {
    this.stmtCache.clear();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async destroy(): Promise<void> {
    await this.close();
  }

  get supportsJSON(): boolean { return true; }
  get supportsFTS5(): boolean { return true; }

  private getDb(): Database.Database {
    if (!this.db) throw new Error('Database not opened');
    return this.db;
  }
}
