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
    let currentVersion = (db.pragma('user_version', { simple: true }) as number) || 0;

    // Legacy upgrade: v1.0 used schema_version table instead of user_version pragma.
    // Sync user_version from schema_version if it exists and user_version is behind.
    if (currentVersion === 0) {
      try {
        const row = db.prepare(
          'SELECT MAX(version) as v FROM schema_version'
        ).get() as { v: number } | undefined;
        if (row?.v && row.v > 0) {
          currentVersion = row.v;
          db.pragma(`user_version = ${currentVersion}`);
        }
      } catch {
        // schema_version table doesn't exist — fresh install, proceed normally
      }
    }

    if (currentVersion < LATEST_SCHEMA_VERSION) {
      const toRun = migrations.filter(m => m.version > currentVersion);
      for (const migration of toRun) {
        db.transaction(() => {
          try {
            db.exec(migration.up);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '';
            // If the full exec fails due to duplicate column/table from legacy DB,
            // re-run line by line to skip only the problematic statements
            if (msg.includes('duplicate column') || msg.includes('already exists')) {
              for (const line of migration.up.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.startsWith('ALTER TABLE') && trimmed.endsWith(';')) {
                  try { db.exec(trimmed); } catch { /* skip duplicate column */ }
                }
              }
            } else {
              throw err;
            }
          }
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
