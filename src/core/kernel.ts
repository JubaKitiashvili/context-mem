import path from 'node:path';
import { PluginRegistry } from './plugin-registry.js';
import { Pipeline } from './pipeline.js';
import { loadConfig } from './config.js';
import { ulid, estimateTokens } from './utils.js';
import { SearchFusion } from '../plugins/search/fusion.js';
import { BetterSqlite3Storage } from '../plugins/storage/better-sqlite3.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
// Summarizers — registered in priority order
import { TypescriptErrorSummarizer } from '../plugins/summarizers/typescript-error-summarizer.js';
import { TestOutputSummarizer } from '../plugins/summarizers/test-output-summarizer.js';
import { BuildOutputSummarizer } from '../plugins/summarizers/build-output-summarizer.js';
import { GitLogSummarizer } from '../plugins/summarizers/git-log-summarizer.js';
import { NetworkSummarizer } from '../plugins/summarizers/network-summarizer.js';
import { ErrorSummarizer } from '../plugins/summarizers/error-summarizer.js';
import { JsonSummarizer } from '../plugins/summarizers/json-summarizer.js';
import { CsvSummarizer } from '../plugins/summarizers/csv-summarizer.js';
import { MarkdownSummarizer } from '../plugins/summarizers/markdown-summarizer.js';
import { HtmlSummarizer } from '../plugins/summarizers/html-summarizer.js';
import { CodeSummarizer } from '../plugins/summarizers/code-summarizer.js';
import { LogSummarizer } from '../plugins/summarizers/log-summarizer.js';
import { ShellSummarizer } from '../plugins/summarizers/shell-summarizer.js';
import { BinarySummarizer } from '../plugins/summarizers/binary-summarizer.js';
// Search
import { BM25Search } from '../plugins/search/bm25.js';
import { TrigramSearch } from '../plugins/search/trigram.js';
import { LevenshteinSearch } from '../plugins/search/levenshtein.js';
// Core modules
import { BudgetManager } from './budget.js';
import { EventTracker } from './events.js';
import { SessionManager } from './session.js';
import { ContentStore } from '../plugins/storage/content-store.js';
import { KnowledgeBase } from '../plugins/knowledge/knowledge-base.js';
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
  budgetManager!: BudgetManager;
  eventTracker!: EventTracker;
  sessionManager!: SessionManager;
  contentStore!: ContentStore;
  knowledgeBase!: KnowledgeBase;

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

    // 3. Core modules
    this.budgetManager = new BudgetManager(this.storage);
    this.eventTracker = new EventTracker(this.storage);
    this.sessionManager = new SessionManager(this.storage, this.eventTracker);
    this.contentStore = new ContentStore(this.storage);
    this.knowledgeBase = new KnowledgeBase(this.storage);

    // 4. Pipeline (with budget integration)
    this.pipeline = new Pipeline(this.registry, this.storage, privacy, this.session.session_id);
    this.pipeline.setBudgetManager(this.budgetManager);

    // 5. Summarizers — registered in priority order (most specific first)
    const summarizers = [
      new TypescriptErrorSummarizer(),  // Before generic Error
      new TestOutputSummarizer(),        // Before Shell
      new BuildOutputSummarizer(),       // Before Shell
      new GitLogSummarizer(),
      new NetworkSummarizer(),
      new ErrorSummarizer(),
      new JsonSummarizer(),
      new CsvSummarizer(),
      new MarkdownSummarizer(),
      new HtmlSummarizer(),
      new CodeSummarizer(),
      new LogSummarizer(),
      new ShellSummarizer(),
      new BinarySummarizer(),            // Always last (catches binary)
    ];
    for (const s of summarizers) {
      await this.registry.register(s);
    }

    // 6. Search plugins (with Levenshtein fallback)
    const bm25 = new BM25Search(this.storage);
    const trigram = new TrigramSearch(this.storage);
    const levenshtein = new LevenshteinSearch(this.storage);
    await this.registry.register(bm25);
    await this.registry.register(trigram);
    await this.registry.register(levenshtein);
    this.searchFusion = new SearchFusion([bm25, trigram, levenshtein]);

    // 7. Lifecycle cleanup (on_startup)
    if (this.config.lifecycle.cleanup_schedule === 'on_startup') {
      const lifecycle = new LifecycleManager(this.storage, this.config.lifecycle);
      await lifecycle.cleanup();
    }
  }

  private ensureStarted(): void {
    if (!this.storage) throw new Error('Kernel not started. Call start() first.');
  }

  /** Safe accessors for ToolKernel adapter */
  getConfig(): ContextMemConfig { this.ensureStarted(); return this.config; }
  getStorage(): BetterSqlite3Storage { this.ensureStarted(); return this.storage; }
  getSearchFusion(): SearchFusion { this.ensureStarted(); return this.searchFusion; }
  getBudgetManager(): BudgetManager { this.ensureStarted(); return this.budgetManager; }
  getEventTracker(): EventTracker { this.ensureStarted(); return this.eventTracker; }
  getSessionManager(): SessionManager { this.ensureStarted(); return this.sessionManager; }
  getContentStore(): ContentStore { this.ensureStarted(); return this.contentStore; }
  getKnowledgeBase(): KnowledgeBase { this.ensureStarted(); return this.knowledgeBase; }

  async observe(content: string, type: Observation['type'], source: string, filePath?: string): Promise<Observation> {
    const obs = await this.pipeline.observe(content, type, source, filePath);
    // Auto-emit event
    this.eventTracker.emit(this.session.session_id, type === 'error' ? 'error' : 'file_read', {
      observation_id: obs.id,
      type,
      source,
      file_path: filePath,
    });
    return obs;
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
    // Auto-emit search event
    this.eventTracker.emit(this.session.session_id, 'search', {
      query,
      results_count: results.length,
    });
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
    const q = (sql: string): number => {
      const row = this.storage.prepare(sql).get(sid) as { v: number } | undefined;
      return row?.v ?? 0;
    };

    const storedV = q("SELECT COUNT(*) as v FROM token_stats WHERE session_id = ? AND event_type = 'store'");
    const contentBytesV = q("SELECT COALESCE(SUM(tokens_in),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'store'");
    const summaryBytesV = q("SELECT COALESCE(SUM(tokens_out),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'store'");
    const searchesV = q("SELECT COUNT(*) as v FROM token_stats WHERE session_id = ? AND event_type = 'discovery'");
    const discoveryV = q("SELECT COALESCE(SUM(tokens_out),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'discovery'");
    const readsV = q("SELECT COALESCE(SUM(tokens_out),0) as v FROM token_stats WHERE session_id = ? AND event_type = 'read'");

    const saved = contentBytesV - (discoveryV + readsV);

    return {
      session_id: sid,
      observations_stored: storedV,
      total_content_bytes: contentBytesV,
      total_summary_bytes: summaryBytesV,
      searches_performed: searchesV,
      discovery_tokens: discoveryV,
      read_tokens: readsV,
      tokens_saved: Math.max(0, saved),
      savings_percentage: contentBytesV > 0 ? Math.round((saved / contentBytesV) * 100) : 0,
    };
  }

  async stop(): Promise<void> {
    // Save session snapshot before shutdown
    if (this.storage && this.sessionManager) {
      try {
        const tokenStats = await this.stats();
        this.sessionManager.saveSnapshot(this.session.session_id, tokenStats);
      } catch {
        // Snapshot save failed — non-critical
      }
    }

    // Session-scoped private cleanup
    if (this.storage) {
      this.storage.exec(
        `DELETE FROM observations WHERE privacy_level = 'private' AND session_id = ?`,
        [this.session.session_id]
      );
    }
    await this.registry.shutdown();
  }

  async restoreSession(sessionId: string): Promise<{ snapshot: Record<string, unknown>; condensed: boolean } | null> {
    this.ensureStarted();
    return this.sessionManager.restoreSnapshot(sessionId);
  }
}
