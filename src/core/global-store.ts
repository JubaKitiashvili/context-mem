import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { globalMigrations, LATEST_GLOBAL_VERSION } from '../plugins/storage/global-migrations.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
import { sanitizeFTS5 } from '../plugins/search/fts5-utils.js';
import { ulid } from './utils.js';
import type { KnowledgeEntry, KnowledgeCategory, SourceType } from './types.js';

export interface GlobalSearchOpts {
  category?: KnowledgeCategory;
  limit?: number;
}

export interface GlobalKnowledgeEntry extends KnowledgeEntry {
  source_project: string;
}

export class GlobalKnowledgeStore {
  private db: Database.Database | null = null;
  private dbPath: string;
  private stmtCache = new Map<string, Database.Statement>();
  private privacyEngine: PrivacyEngine;

  constructor(privacyEngine?: PrivacyEngine, dbPath?: string) {
    this.dbPath = dbPath ?? path.join(os.homedir(), '.context-mem', 'global', 'store.db');
    this.privacyEngine = privacyEngine ?? new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
  }

  open(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');

    this.runMigrations();
  }

  private runMigrations(): void {
    const db = this.getDb();
    const currentVersion = (db.pragma('user_version', { simple: true }) as number) || 0;

    if (currentVersion < LATEST_GLOBAL_VERSION) {
      const toRun = globalMigrations.filter(m => m.version > currentVersion);
      for (const migration of toRun) {
        db.transaction(() => {
          db.exec(migration.up);
          db.pragma(`user_version = ${migration.version}`);
        })();
      }
    }
  }

  /**
   * Promote a project-level knowledge entry to the global store.
   * Runs the privacy engine on content before storing.
   */
  promote(entry: KnowledgeEntry, projectName: string): GlobalKnowledgeEntry {
    const db = this.getDb();

    // Sanitize content through privacy engine before promoting
    const titleResult = this.privacyEngine.sanitize(entry.title);
    const contentResult = this.privacyEngine.sanitize(entry.content);

    const globalId = ulid();
    const now = Date.now();

    const globalEntry: GlobalKnowledgeEntry = {
      id: globalId,
      category: entry.category,
      title: titleResult.sanitized,
      content: contentResult.sanitized,
      tags: entry.tags,
      shareable: entry.shareable,
      relevance_score: entry.relevance_score,
      access_count: 0,
      created_at: now,
      last_accessed: now,
      archived: false,
      source_type: entry.source_type,
      source_project: projectName,
    };

    db.prepare(
      `INSERT INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, last_accessed, archived, source_type, source_project)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      globalEntry.id,
      globalEntry.category,
      globalEntry.title,
      globalEntry.content,
      JSON.stringify(globalEntry.tags),
      globalEntry.shareable ? 1 : 0,
      globalEntry.relevance_score,
      globalEntry.access_count,
      globalEntry.created_at,
      globalEntry.last_accessed,
      globalEntry.archived ? 1 : 0,
      globalEntry.source_type,
      globalEntry.source_project,
    );

    return globalEntry;
  }

  /**
   * Search the global knowledge store using FTS5 with fallback to scan.
   */
  search(query: string, opts: GlobalSearchOpts = {}): GlobalKnowledgeEntry[] {
    const limit = opts.limit || 10;
    const sanitized = sanitizeFTS5(query);
    if (!sanitized) return [];

    // Layer 1: FTS5 search
    let results = this.searchFTS5(sanitized, opts.category, limit);

    // Layer 2: Scan fallback
    if (results.length === 0) {
      results = this.searchScan(query, opts.category, limit);
    }

    return results;
  }

  /**
   * Remove an entry from the global store by ID.
   */
  demote(id: string): boolean {
    const db = this.getDb();
    const result = db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get all global knowledge entries with optional filters.
   */
  getAll(opts: GlobalSearchOpts = {}): GlobalKnowledgeEntry[] {
    const db = this.getDb();
    const limit = opts.limit || 100;

    let sql = 'SELECT * FROM knowledge WHERE archived = 0';
    const params: unknown[] = [];

    if (opts.category) {
      sql += ' AND category = ?';
      params.push(opts.category);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToEntry(r));
  }

  /**
   * Get a single entry by ID.
   */
  getById(id: string): GlobalKnowledgeEntry | null {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  close(): void {
    this.stmtCache.clear();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private searchFTS5(query: string, category: KnowledgeCategory | undefined, limit: number): GlobalKnowledgeEntry[] {
    try {
      const db = this.getDb();
      let sql = `
        SELECT k.* FROM knowledge_fts
        JOIN knowledge k ON k.rowid = knowledge_fts.rowid
        WHERE knowledge_fts MATCH ? AND k.archived = 0
      `;
      const params: unknown[] = [query];
      if (category) {
        sql += ' AND k.category = ?';
        params.push(category);
      }
      sql += ' ORDER BY bm25(knowledge_fts) ASC LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEntry(r));
    } catch {
      return [];
    }
  }

  private searchScan(query: string, category: KnowledgeCategory | undefined, limit: number): GlobalKnowledgeEntry[] {
    const db = this.getDb();
    const lowerQuery = query.toLowerCase();
    let sql = 'SELECT * FROM knowledge WHERE archived = 0';
    const params: unknown[] = [];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows
      .filter(r => {
        const title = ((r.title as string) ?? '').toLowerCase();
        const content = ((r.content as string) ?? '').toLowerCase();
        return title.includes(lowerQuery) || content.includes(lowerQuery);
      })
      .slice(0, limit)
      .map(r => this.rowToEntry(r));
  }

  private rowToEntry(row: Record<string, unknown>): GlobalKnowledgeEntry {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags as string) as string[];
    } catch {
      // invalid tags
    }
    return {
      id: row.id as string,
      category: row.category as KnowledgeCategory,
      title: row.title as string,
      content: row.content as string,
      tags,
      shareable: !!(row.shareable as number),
      relevance_score: row.relevance_score as number,
      access_count: row.access_count as number,
      created_at: row.created_at as number,
      last_accessed: (row.last_accessed as number) || (row.created_at as number),
      archived: !!(row.archived as number),
      source_type: (['explicit', 'inferred', 'observed'].includes(row.source_type as string)
        ? row.source_type as SourceType
        : 'observed'),
      source_project: row.source_project as string,
    };
  }

  private getDb(): Database.Database {
    if (!this.db) throw new Error('Global store not opened');
    return this.db;
  }
}
