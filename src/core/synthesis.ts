import fs from 'node:fs';
import path from 'node:path';
import type { StoragePlugin } from './types.js';
import type { VaultSync } from './vault.js';
import type { LLMService } from './llm-provider.js';
import type { ErrorLogger } from './error-logger.js';
import { safeName } from './vault-templates.js';

export interface SynthesisOptions {
  vaultDir: string;
  /** default true */
  enabled?: boolean;
  /** debounce window in ms, default 2000 */
  debounceMs?: number;
  /** minimum observations before synthesis runs, default 3 */
  minObservations?: number;
}

interface PendingItem {
  kind: 'entity' | 'topic';
  name: string;
  timer: ReturnType<typeof setTimeout>;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtYearMonth(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7); // YYYY-MM
}

/** Group observations by month for the deterministic template. */
function groupByMonth(rows: Array<{ content: string; summary: string | null; indexed_at: number }>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const month = fmtYearMonth(row.indexed_at);
    const text = row.summary ?? row.content.slice(0, 120);
    const list = groups.get(month) ?? [];
    list.push(text);
    groups.set(month, list);
  }
  return groups;
}

function buildDeterministicEntityPage(
  entityName: string,
  entityType: string,
  observations: Array<{ content: string; summary: string | null; indexed_at: number }>,
  relatedEntities: string[],
): string {
  const byMonth = groupByMonth(observations);
  const timelineEntries: string[] = [];
  // Sort months descending
  for (const [month, items] of [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    timelineEntries.push(`### ${month}`);
    for (const item of items) {
      timelineEntries.push(`- ${item}`);
    }
  }
  const timelineSection = timelineEntries.length > 0 ? timelineEntries.join('\n') : '_No observations yet._';
  const relatedSection = relatedEntities.length > 0
    ? relatedEntities.map(r => `- [[${safeName(r)}]]`).join('\n')
    : '_None detected._';

  return `# ${entityName}

- **Type:** ${entityType}
- **Observations:** ${observations.length}
- **Last updated:** ${fmtDate(Date.now())}

## Summary

_Synthesis is available when LLM is enabled (ai_curation.enabled = true)._

## Timeline of Observations

${timelineSection}

## Related Entities

${relatedSection}

## Open Questions

_Enable AI curation to get narrative synthesis and open question detection._
`;
}

function buildDeterministicTopicPage(
  topicName: string,
  observations: Array<{ content: string; summary: string | null; indexed_at: number }>,
): string {
  const byMonth = groupByMonth(observations);
  const timelineEntries: string[] = [];
  for (const [month, items] of [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    timelineEntries.push(`### ${month}`);
    for (const item of items) {
      timelineEntries.push(`- ${item}`);
    }
  }
  const timelineSection = timelineEntries.length > 0 ? timelineEntries.join('\n') : '_No observations yet._';

  return `# Topic: ${topicName}

- **Observations:** ${observations.length}
- **Last updated:** ${fmtDate(Date.now())}

## Summary

_Synthesis is available when LLM is enabled (ai_curation.enabled = true)._

## Timeline of Observations

${timelineSection}

## Open Questions

_Enable AI curation to get narrative synthesis and open question detection._
`;
}

export class SynthesisEngine {
  private storage: StoragePlugin;
  private vaultSync: VaultSync;
  private llmService: LLMService | null;
  private vaultDir: string;
  private enabled: boolean;
  private debounceMs: number;
  private minObservations: number;
  private pending = new Map<string, PendingItem>();
  private stopped = false;
  private errorLogger?: ErrorLogger;

  constructor(
    storage: StoragePlugin,
    vaultSync: VaultSync,
    llmService: LLMService | null,
    options: SynthesisOptions,
  ) {
    this.storage = storage;
    this.vaultSync = vaultSync;
    this.llmService = llmService;
    this.vaultDir = options.vaultDir;
    this.enabled = options.enabled ?? true;
    this.debounceMs = options.debounceMs ?? 2000;
    this.minObservations = options.minObservations ?? 3;
  }

  setErrorLogger(logger: ErrorLogger): void {
    this.errorLogger = logger;
  }

  /** Schedule synthesis refresh for an entity (debounced). */
  scheduleEntity(name: string): void {
    if (!this.enabled || this.stopped) return;
    this._schedule('entity', name);
  }

  /** Schedule synthesis refresh for a topic (debounced). */
  scheduleTopic(name: string): void {
    if (!this.enabled || this.stopped) return;
    this._schedule('topic', name);
  }

  private _schedule(kind: 'entity' | 'topic', name: string): void {
    const key = `${kind}:${name}`;
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.pending.delete(key);
      if (this.stopped) return;
      const work = kind === 'entity'
        ? this.refreshEntity(name)
        : this.refreshTopic(name);
      work.catch(err => {
        this.errorLogger?.error('synthesis', err, { kind, name });
      });
    }, this.debounceMs);
    this.pending.set(key, { kind, name, timer });
  }

  /** Flush all pending refreshes immediately. */
  async flush(): Promise<void> {
    const items = [...this.pending.values()];
    for (const item of items) {
      clearTimeout(item.timer);
      this.pending.delete(`${item.kind}:${item.name}`);
    }
    await Promise.all(
      items.map(item =>
        (item.kind === 'entity' ? this.refreshEntity(item.name) : this.refreshTopic(item.name)).catch(err => {
          this.errorLogger?.error('synthesis', err, { kind: item.kind, name: item.name });
        }),
      ),
    );
  }

  /** Force-refresh a specific entity synthesis page (bypasses debounce). */
  async refreshEntity(name: string): Promise<void> {
    if (!this.enabled) return;

    // Get entity row
    const entityRow = this.storage.prepare(
      'SELECT id, name, entity_type, metadata, created_at, updated_at FROM entities WHERE name = ?',
    ).get(name) as { id: string; name: string; entity_type: string; metadata: string; created_at: number; updated_at: number } | undefined;

    if (!entityRow) return;

    // Get non-private observations mentioning this entity
    const observations = this._getEntityObservations(name);

    // Min-observations guard
    if (observations.length < this.minObservations) return;

    // Get related entities from relationships
    const relatedEntities = this._getRelatedEntities(entityRow.id);

    const filePath = path.join(this.vaultDir, 'entities', `${safeName(name)}.md`);
    if (!this._withinVault(filePath)) return;

    let pageContent: string;

    // LLM path
    if (this.llmService) {
      try {
        const existingPage = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const newObsJoined = observations
          .map(o => `[${fmtDate(o.indexed_at)}] ${o.summary ?? o.content.slice(0, 120)}`)
          .join('\n');
        const result = await this.llmService.synthesizePage(existingPage, newObsJoined, name);
        if (result) {
          pageContent = result.synthesis;
        } else {
          pageContent = buildDeterministicEntityPage(name, entityRow.entity_type, observations, relatedEntities);
        }
      } catch (err) {
        this.errorLogger?.error('synthesis', err, { kind: 'entity', name });
        pageContent = buildDeterministicEntityPage(name, entityRow.entity_type, observations, relatedEntities);
      }
    } else {
      pageContent = buildDeterministicEntityPage(name, entityRow.entity_type, observations, relatedEntities);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, pageContent, 'utf8');
  }

  /** Force-refresh a specific topic synthesis page (bypasses debounce). */
  async refreshTopic(name: string): Promise<void> {
    if (!this.enabled) return;

    const topicRow = this.storage.prepare(
      'SELECT id, name, observation_count FROM topics WHERE name = ?',
    ).get(name) as { id: string; name: string; observation_count: number } | undefined;

    if (!topicRow) return;

    const observations = this._getTopicObservations(topicRow.id);

    if (observations.length < this.minObservations) return;

    const filePath = path.join(this.vaultDir, 'topics', `${safeName(name)}.md`);
    if (!this._withinVault(filePath)) return;

    let pageContent: string;

    if (this.llmService) {
      try {
        const existingPage = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const newObsJoined = observations
          .map(o => `[${fmtDate(o.indexed_at)}] ${o.summary ?? o.content.slice(0, 120)}`)
          .join('\n');
        const result = await this.llmService.synthesizePage(existingPage, newObsJoined, name);
        if (result) {
          pageContent = result.synthesis;
        } else {
          pageContent = buildDeterministicTopicPage(name, observations);
        }
      } catch (err) {
        this.errorLogger?.error('synthesis', err, { kind: 'topic', name });
        pageContent = buildDeterministicTopicPage(name, observations);
      }
    } else {
      pageContent = buildDeterministicTopicPage(name, observations);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, pageContent, 'utf8');
  }

  stop(): void {
    this.stopped = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
    }
    this.pending.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _withinVault(fullPath: string): boolean {
    const resolvedVault = path.resolve(this.vaultDir);
    const resolved = path.resolve(fullPath);
    return resolved === resolvedVault || resolved.startsWith(resolvedVault + path.sep);
  }

  private _getEntityObservations(entityName: string): Array<{ content: string; summary: string | null; indexed_at: number }> {
    // Fetch observations that mention this entity (via metadata entities field or content match)
    // Use a JSON-based approach: look at the entities metadata field
    try {
      // First try: observations with the entity name in their metadata entities array
      const rows = this.storage.prepare(
        `SELECT content, summary, indexed_at
         FROM observations
         WHERE (privacy_level IS NULL OR privacy_level != 'private')
           AND (
             json_extract(metadata, '$.entities') LIKE ?
             OR content LIKE ?
           )
         ORDER BY indexed_at DESC
         LIMIT 50`,
      ).all(`%${entityName}%`, `%${entityName}%`) as Array<{ content: string; summary: string | null; indexed_at: number }>;
      return rows;
    } catch {
      // Fallback: simple content search
      try {
        return this.storage.prepare(
          `SELECT content, summary, indexed_at
           FROM observations
           WHERE (privacy_level IS NULL OR privacy_level != 'private')
             AND content LIKE ?
           ORDER BY indexed_at DESC
           LIMIT 50`,
        ).all(`%${entityName}%`) as Array<{ content: string; summary: string | null; indexed_at: number }>;
      } catch {
        return [];
      }
    }
  }

  private _getTopicObservations(topicId: string): Array<{ content: string; summary: string | null; indexed_at: number }> {
    try {
      return this.storage.prepare(
        `SELECT o.content, o.summary, o.indexed_at
         FROM observations o
         JOIN observation_topics ot ON ot.observation_id = o.id
         WHERE ot.topic_id = ?
           AND (o.privacy_level IS NULL OR o.privacy_level != 'private')
         ORDER BY o.indexed_at DESC
         LIMIT 50`,
      ).all(topicId) as Array<{ content: string; summary: string | null; indexed_at: number }>;
    } catch {
      return [];
    }
  }

  private _getRelatedEntities(entityId: string): string[] {
    try {
      const from = this.storage.prepare(
        `SELECT e.name FROM relationships r
         JOIN entities e ON e.id = r.to_entity
         WHERE r.from_entity = ?
         LIMIT 10`,
      ).all(entityId) as { name: string }[];
      const to = this.storage.prepare(
        `SELECT e.name FROM relationships r
         JOIN entities e ON e.id = r.from_entity
         WHERE r.to_entity = ?
         LIMIT 10`,
      ).all(entityId) as { name: string }[];
      const names = new Set([...from.map(r => r.name), ...to.map(r => r.name)]);
      return [...names];
    } catch {
      return [];
    }
  }
}
