import path from 'node:path';
import { PluginRegistry } from './plugin-registry.js';
import { Pipeline } from './pipeline.js';
import { loadConfig } from './config.js';
import { ulid, estimateTokens } from './utils.js';
import { SearchFusion } from '../plugins/search/fusion.js';
import { BetterSqlite3Storage } from '../plugins/storage/better-sqlite3.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
import { ShellSummarizer } from '../plugins/summarizers/shell-summarizer.js';
import { JsonSummarizer } from '../plugins/summarizers/json-summarizer.js';
import { ErrorSummarizer } from '../plugins/summarizers/error-summarizer.js';
import { LogSummarizer } from '../plugins/summarizers/log-summarizer.js';
import { CodeSummarizer } from '../plugins/summarizers/code-summarizer.js';
import { BM25Search } from '../plugins/search/bm25.js';
import { TrigramSearch } from '../plugins/search/trigram.js';
import { LifecycleManager } from './lifecycle.js';
import type {
  SessionContext,
  ContextMemConfig,
  SearchResult,
  Observation,
  TokenEconomics,
  SearchOpts,
} from './types.js';

export class Kernel {
  readonly registry = new PluginRegistry();
  readonly session: SessionContext;
  pipeline!: Pipeline;
  private config: ContextMemConfig;
  private projectDir: string;
  private searchFusion!: SearchFusion;
  private storage!: BetterSqlite3Storage;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.config = loadConfig(projectDir);
    this.session = {
      session_id: ulid(),
      platform: 'unknown',
      started_at: Date.now(),
    };
  }

  async start(): Promise<void> {
    // Resolve db_path relative to projectDir if not absolute
    const dbPath = path.isAbsolute(this.config.db_path)
      ? this.config.db_path
      : path.join(this.projectDir, this.config.db_path);

    // 1. Storage
    this.storage = new BetterSqlite3Storage();
    await this.storage.open(dbPath);
    await this.registry.register(this.storage);

    // 2. Privacy
    const privacy = new PrivacyEngine(this.config.privacy);

    // 3. Pipeline
    this.pipeline = new Pipeline(this.registry, this.storage, privacy, this.session.session_id);

    // 4. Summarizers
    const summarizers = [
      new ShellSummarizer(),
      new JsonSummarizer(),
      new ErrorSummarizer(),
      new LogSummarizer(),
      new CodeSummarizer(),
    ];
    for (const s of summarizers) {
      await this.registry.register(s);
    }

    // 5. Search plugins
    const bm25 = new BM25Search(this.storage);
    const trigram = new TrigramSearch(this.storage);
    await this.registry.register(bm25);
    await this.registry.register(trigram);
    this.searchFusion = new SearchFusion([bm25, trigram]);

    // 6. Lifecycle cleanup (on_startup)
    if (this.config.lifecycle.cleanup_schedule === 'on_startup') {
      const lifecycle = new LifecycleManager(this.storage, this.config.lifecycle);
      await lifecycle.cleanup();
    }
  }

  private ensureStarted(): void {
    if (!this.storage) throw new Error('Kernel not started. Call start() first.');
  }

  async observe(content: string, type: Observation['type'], source: string, filePath?: string): Promise<Observation> {
    return this.pipeline.observe(content, type, source, filePath);
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    this.ensureStarted();
    const results = await this.searchFusion.execute(query, opts || {});
    // Track discovery token economics
    const discoveryTokens = results.reduce((sum, r) => sum + estimateTokens(r.snippet), 0);
    if (this.storage && results.length > 0) {
      this.storage.exec(
        'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
        [this.session.session_id, 'discovery', 0, discoveryTokens, Date.now()]
      );
    }
    return results;
  }

  async get(id: string): Promise<Observation | null> {
    this.ensureStarted();
    const row = this.storage.prepare('SELECT * FROM observations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    // Track read token economics
    this.storage.exec(
      'INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?)',
      [this.session.session_id, 'read', 0, estimateTokens(row.content as string), Date.now()]
    );

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata as string) as Record<string, unknown>;
    } catch {
      // malformed metadata — leave empty
    }

    return {
      id: row.id as string,
      type: row.type as Observation['type'],
      content: row.content as string,
      summary: (row.summary ?? undefined) as string | undefined,
      metadata: metadata as unknown as Observation['metadata'],
      indexed_at: row.indexed_at as number,
    };
  }

  async stats(): Promise<TokenEconomics> {
    this.ensureStarted();
    const sid = this.session.session_id;
    const q = (sql: string): Record<string, number> =>
      this.storage.prepare(sql).get(sid) as Record<string, number>;

    const stored = q("SELECT COUNT(*) as v FROM token_stats WHERE session_id = ? AND event_type = 'store'");
    const contentBytes = q("SELECT COALESCE(SUM(tokens_in),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'store'");
    const summaryBytes = q("SELECT COALESCE(SUM(tokens_out),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'store'");
    const searches = q("SELECT COUNT(*) as v FROM token_stats WHERE session_id = ? AND event_type = 'discovery'");
    const discovery = q("SELECT COALESCE(SUM(tokens_out),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'discovery'");
    const reads = q("SELECT COALESCE(SUM(tokens_out),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'read'");

    const saved = contentBytes.v - (discovery.v + reads.v);

    return {
      session_id: sid,
      observations_stored: stored.v,
      total_content_bytes: contentBytes.v,
      total_summary_bytes: summaryBytes.v,
      searches_performed: searches.v,
      discovery_tokens: discovery.v,
      read_tokens: reads.v,
      tokens_saved: Math.max(0, saved),
      savings_percentage: contentBytes.v > 0 ? Math.round((saved / contentBytes.v) * 100) : 0,
    };
  }

  async stop(): Promise<void> {
    // Session-scoped private cleanup
    if (this.storage) {
      this.storage.exec(
        `DELETE FROM observations WHERE privacy_level = 'private' AND session_id = ?`,
        [this.session.session_id]
      );
    }
    await this.registry.shutdown();
  }
}
