import fs from 'node:fs';
import path from 'node:path';
import type { StoragePlugin } from './types.js';
import {
  renderEntityPage,
  renderTopicPage,
  renderSessionPage,
  renderKnowledgePage,
  renderIndex,
  renderLogEntry,
  safeName as safeNameImpl,
  type EntityRow,
  type TopicRow,
  type ObsRow,
  type KnowledgeRow,
} from './vault-templates.js';

export interface VaultOptions {
  vaultDir: string;
  enabled?: boolean;
}

export { safeName } from './vault-templates.js';

export class VaultSync {
  private storage: StoragePlugin;
  private vaultDir: string;
  private enabled: boolean;

  constructor(storage: StoragePlugin, options: VaultOptions) {
    this.storage = storage;
    this.vaultDir = options.vaultDir;
    this.enabled = options.enabled ?? true;
  }

  stop(): void {}

  private safeName(name: string): string {
    return safeNameImpl(name);
  }

  private withinVault(fullPath: string): boolean {
    const resolvedVault = path.resolve(this.vaultDir);
    const resolved = path.resolve(fullPath);
    return resolved === resolvedVault || resolved.startsWith(resolvedVault + path.sep);
  }

  async init(): Promise<void> {
    if (!this.enabled) return;
    for (const sub of ['sources', 'entities', 'topics', 'knowledge']) {
      fs.mkdirSync(path.join(this.vaultDir, sub), { recursive: true });
    }
    const indexPath = path.join(this.vaultDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
      await this.refreshIndex();
    }
    const logPath = path.join(this.vaultDir, 'log.md');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '# Event Log\n\n', 'utf8');
    }
  }

  async refreshEntity(name: string): Promise<void> {
    if (!this.enabled) return;
    const row = this.storage.prepare(
      'SELECT id, name, entity_type, metadata, knowledge_id, created_at, updated_at FROM entities WHERE name = ?',
    ).get(name) as EntityRow | undefined;
    if (!row) return;

    let backlinks: string[] = [];
    try {
      const rels = this.storage.prepare(
        `SELECT e.name FROM relationships r
         JOIN entities e ON e.id = r.from_entity
         WHERE r.to_entity = ?`,
      ).all(row.id) as { name: string }[];
      backlinks = rels.map(r => r.name);
    } catch {
      backlinks = [];
    }

    const content = renderEntityPage(row, backlinks);
    const filePath = path.join(this.vaultDir, 'entities', `${this.safeName(name)}.md`);
    if (!this.withinVault(filePath)) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  async refreshTopic(name: string): Promise<void> {
    if (!this.enabled) return;
    const topic = this.storage.prepare(
      'SELECT id, name, parent_id, observation_count, last_seen FROM topics WHERE name = ?',
    ).get(name) as TopicRow | undefined;
    if (!topic) return;

    const observations = this.storage.prepare(
      `SELECT o.id, o.type, o.content, o.summary, o.indexed_at, o.session_id
       FROM observations o
       JOIN observation_topics ot ON ot.observation_id = o.id
       WHERE ot.topic_id = ?
         AND (o.privacy_level IS NULL OR o.privacy_level != 'private')
       ORDER BY o.indexed_at DESC
       LIMIT 20`,
    ).all(topic.id) as ObsRow[];

    const content = renderTopicPage(topic, observations);
    const filePath = path.join(this.vaultDir, 'topics', `${this.safeName(name)}.md`);
    if (!this.withinVault(filePath)) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  async refreshSession(sessionId: string): Promise<void> {
    if (!this.enabled) return;
    const observations = this.storage.prepare(
      `SELECT id, type, content, summary, indexed_at, session_id
       FROM observations
       WHERE session_id = ?
         AND (privacy_level IS NULL OR privacy_level != 'private')
       ORDER BY indexed_at ASC`,
    ).all(sessionId) as ObsRow[];

    const date = observations.length > 0
      ? new Date(observations[0].indexed_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const fileName = `${this.safeName(sessionId)}-${date}.md`;
    const content = renderSessionPage(sessionId, observations);
    const filePath = path.join(this.vaultDir, 'sources', fileName);
    if (!this.withinVault(filePath)) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  async refreshKnowledge(id: string): Promise<void> {
    if (!this.enabled) return;
    const row = this.storage.prepare(
      'SELECT id, category, title, content, tags, access_count, created_at FROM knowledge WHERE id = ?',
    ).get(id) as KnowledgeRow | undefined;
    if (!row) return;

    const content = renderKnowledgePage(row);
    const filePath = path.join(this.vaultDir, 'knowledge', `${this.safeName(id)}.md`);
    if (!this.withinVault(filePath)) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  async refreshIndex(): Promise<void> {
    if (!this.enabled) return;

    const count = (sql: string): number => {
      try {
        const row = this.storage.prepare(sql).get() as { c: number } | undefined;
        return row?.c ?? 0;
      } catch { return 0; }
    };

    const counts = {
      observations: count('SELECT COUNT(*) as c FROM observations'),
      entities: count('SELECT COUNT(*) as c FROM entities'),
      topics: count('SELECT COUNT(*) as c FROM topics'),
      knowledge: count('SELECT COUNT(*) as c FROM knowledge'),
      sessions: count('SELECT COUNT(DISTINCT session_id) as c FROM observations WHERE session_id IS NOT NULL'),
    };

    const topEntities = (() => {
      try {
        return this.storage.prepare(
          'SELECT id, name, entity_type, metadata, knowledge_id, created_at, updated_at FROM entities ORDER BY updated_at DESC LIMIT 10',
        ).all() as EntityRow[];
      } catch { return []; }
    })();

    const recentTopics = (() => {
      try {
        return this.storage.prepare(
          'SELECT id, name, parent_id, observation_count, last_seen FROM topics ORDER BY last_seen DESC LIMIT 10',
        ).all() as TopicRow[];
      } catch { return []; }
    })();

    const recentKnowledge = (() => {
      try {
        return this.storage.prepare(
          'SELECT id, category, title, content, tags, access_count, created_at FROM knowledge ORDER BY created_at DESC LIMIT 10',
        ).all() as KnowledgeRow[];
      } catch { return []; }
    })();

    const content = renderIndex(counts, topEntities, recentTopics, recentKnowledge);
    const filePath = path.join(this.vaultDir, 'index.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  async logEvent(event: string, summary: string): Promise<void> {
    if (!this.enabled) return;
    const entry = renderLogEntry(event, summary, Date.now());
    const logPath = path.join(this.vaultDir, 'log.md');
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    try {
      await fs.promises.access(logPath);
    } catch {
      await fs.promises.writeFile(logPath, '# Event Log\n\n', 'utf8');
    }
    await fs.promises.appendFile(logPath, entry, 'utf8');
  }
}
