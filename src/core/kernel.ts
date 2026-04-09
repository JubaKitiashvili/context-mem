import path from 'node:path';
import { PluginRegistry } from './plugin-registry.js';
import { Pipeline } from './pipeline.js';
import { loadConfig } from './config.js';
import { ulid, estimateTokens } from './utils.js';
import { SearchFusion } from '../plugins/search/fusion.js';
import { BetterSqlite3Storage } from '../plugins/storage/better-sqlite3.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
import { createLLMService } from './llm-factory.js';
import type { LLMService } from './llm-provider.js';
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
// Runtimes
import { JavaScriptRuntime } from '../plugins/runtimes/javascript.js';
import { TypeScriptRuntime } from '../plugins/runtimes/typescript.js';
import { PythonRuntime } from '../plugins/runtimes/python.js';
import { ShellRuntime } from '../plugins/runtimes/shell.js';
import { RubyRuntime } from '../plugins/runtimes/ruby.js';
import { GoRuntime } from '../plugins/runtimes/go.js';
import { RustRuntime } from '../plugins/runtimes/rust.js';
import { PhpRuntime } from '../plugins/runtimes/php.js';
import { PerlRuntime } from '../plugins/runtimes/perl.js';
import { RRuntime } from '../plugins/runtimes/r.js';
import { ElixirRuntime } from '../plugins/runtimes/elixir.js';
// Core modules
import { BudgetManager } from './budget.js';
import { EventTracker } from './events.js';
import { SessionManager } from './session.js';
import { ContentStore } from '../plugins/storage/content-store.js';
import { KnowledgeBase } from '../plugins/knowledge/knowledge-base.js';
import { LifecycleManager } from './lifecycle.js';
import { Dreamer } from './dreamer.js';
import { GlobalKnowledgeStore } from './global-store.js';
import { PluginLoader } from './plugin-loader.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { AgentRegistry } from './agent-registry.js';
import type { VectorSearch } from '../plugins/search/vector.js';
import type {
  SessionContext,
  ContextMemConfig,
  SearchResult,
  SearchPlugin,
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
  dreamer!: Dreamer;
  globalStore?: GlobalKnowledgeStore;
  knowledgeGraph!: KnowledgeGraph;
  agentRegistry?: AgentRegistry;
  llmService?: LLMService;
  feedbackEngine?: import('./feedback-engine.js').FeedbackEngine;

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

    // 3a. LLM service (optional — based on ai_curation config)
    this.llmService = await createLLMService(this.config.ai_curation ?? { enabled: false });
    this.knowledgeBase = new KnowledgeBase(this.storage, this.llmService);

    // 3b. Knowledge graph
    this.knowledgeGraph = new KnowledgeGraph(this.storage);

    // 3b2. Feedback engine
    try {
      const { FeedbackEngine } = await import('./feedback-engine.js');
      this.feedbackEngine = new FeedbackEngine(this.storage);
    } catch { /* non-critical */ }

    // 3c. Dreamer background agent
    this.dreamer = new Dreamer(this.knowledgeBase, this.storage);
    this.dreamer.start();

    // 3d. Global knowledge store
    if (this.config.global_knowledge?.enabled !== false) {
      try {
        this.globalStore = new GlobalKnowledgeStore();
        this.globalStore.open();
      } catch {
        // Non-critical — continue without global store
      }
    }

    // 3e. Agent registry for multi-agent coordination
    this.agentRegistry = new AgentRegistry(this.projectDir, this.session.session_id);

    // Session chain — link to previous session
    try {
      const latest = this.sessionManager.getLatestChainEntry(this.projectDir);
      if (latest) {
        // created_at is INTEGER (unixepoch seconds)
        const chainCreatedMs = (latest.created_at as unknown as number) * 1000;
        const hoursSince = (Date.now() - chainCreatedMs) / (1000 * 60 * 60);
        const lightThreshold = this.config.session_continuity?.light_restore_threshold_hours ?? 24;

        // Chain to parent if within light threshold (24h), otherwise start fresh
        this.sessionManager.createChainEntry(
          this.session.session_id,
          this.projectDir,
          hoursSince < lightThreshold ? latest.session_id : null,
          'auto',
        );
      } else {
        this.sessionManager.createChainEntry(
          this.session.session_id,
          this.projectDir,
          null,
          'auto',
        );
      }
    } catch {
      // Chain init is non-critical
    }

    // 4. Pipeline (with budget + session integration)
    this.pipeline = new Pipeline(this.registry, this.storage, privacy, this.session.session_id);
    this.pipeline.setBudgetManager(this.budgetManager);
    this.pipeline.setSessionManager(this.sessionManager);
    this.pipeline.setLLMService(this.llmService);
    this.pipeline.setKnowledgeGraph(this.knowledgeGraph);

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

    // 5b. External summarizer plugins
    try {
      const loader = new PluginLoader();
      const external = loader.loadSummarizers(this.projectDir, this.config);
      for (const ext of external) {
        await this.registry.register(ext);
      }
    } catch {
      // Non-critical — continue without external plugins
    }

    // 6. Search plugins (with Levenshtein fallback + optional vector)
    const bm25 = new BM25Search(this.storage);
    const trigram = new TrigramSearch(this.storage);
    const levenshtein = new LevenshteinSearch(this.storage);
    await this.registry.register(bm25);
    await this.registry.register(trigram);
    await this.registry.register(levenshtein);

    let vectorPlugin: VectorSearch | null = null;
    if (this.config.plugins.search.includes('vector')) {
      try {
        const { Embedder } = await import('../plugins/search/embedder.js');
        if (await Embedder.isAvailable()) {
          const { VectorSearch: VS } = await import('../plugins/search/vector.js');
          vectorPlugin = new VS(this.storage);
          await this.registry.register(vectorPlugin);
          this.pipeline.setEmbedder(Embedder);
        } else {
          console.error('context-mem: Vector search configured but @huggingface/transformers not installed.');
          console.error('  Install it with: npm install @huggingface/transformers');
          console.error('  Falling back to BM25 + Trigram + Levenshtein search.');
        }
      } catch {
        console.error('context-mem: Vector search configured but @huggingface/transformers not available.');
        console.error('  Install it with: npm install @huggingface/transformers');
      }
    }

    const searchPlugins: SearchPlugin[] = [bm25, trigram, levenshtein];
    if (vectorPlugin) searchPlugins.push(vectorPlugin);
    this.searchFusion = new SearchFusion(searchPlugins, this.config.search_weights);

    // 7. Runtime plugins
    const runtimes = [
      new JavaScriptRuntime(),
      new TypeScriptRuntime(),
      new PythonRuntime(),
      new ShellRuntime(),
      new RubyRuntime(),
      new GoRuntime(),
      new RustRuntime(),
      new PhpRuntime(),
      new PerlRuntime(),
      new RRuntime(),
      new ElixirRuntime(),
    ];
    for (const rt of runtimes) {
      await this.registry.register(rt);
    }

    // 8. Lifecycle cleanup (on_startup)
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

  private fileAccessCounts = new Map<string, number>();

  async observe(content: string, type: Observation['type'], source: string, filePath?: string): Promise<Observation> {
    const obs = await this.pipeline.observe(content, type, source, filePath);
    // Auto-emit event
    this.eventTracker.emit(this.session.session_id, type === 'error' ? 'error' : 'file_read', {
      observation_id: obs.id,
      type,
      source,
      file_path: filePath,
    });
    // Auto-extract knowledge from observations
    this.autoExtractKnowledge(obs, type, source, filePath);
    return obs;
  }

  private autoExtractKnowledge(obs: Observation, type: Observation['type'], _source: string, filePath?: string): void {
    // Fire-and-forget: async save is non-critical, errors are swallowed
    this._doAutoExtractKnowledge(obs, type, filePath).catch(() => {});
  }

  private async _doAutoExtractKnowledge(obs: Observation, type: Observation['type'], filePath?: string): Promise<void> {
    try {
      const body = obs.summary || obs.content.slice(0, 500);

      // Decision observations → knowledge
      if (type === 'decision') {
        const title = obs.content.split('\n')[0].slice(0, 120);
        await this.knowledgeBase.save({ category: 'decision', title, content: body, tags: ['auto-extracted'] });
        return;
      }

      // Error observations → knowledge (dedup by title)
      if (type === 'error') {
        const title = obs.content.split('\n')[0].slice(0, 120);
        const existing = this.knowledgeBase.search(title, { category: 'error', limit: 1 });
        if (existing.length === 0) {
          await this.knowledgeBase.save({ category: 'error', title, content: body, tags: ['auto-extracted'] });
        }
        return;
      }

      // Commit observations → pattern knowledge
      if (type === 'commit') {
        await this.knowledgeBase.save({
          category: 'pattern',
          title: obs.content.split('\n')[0].slice(0, 120),
          content: body,
          tags: ['commit', 'auto-extracted'],
        });
        return;
      }

      // Frequently-accessed files → component knowledge
      if (type === 'code' && filePath) {
        const count = (this.fileAccessCounts.get(filePath) || 0) + 1;
        this.fileAccessCounts.set(filePath, count);
        if (count === 5) {
          const fileName = filePath.split('/').pop() || filePath;
          await this.knowledgeBase.save({
            category: 'component',
            title: `Frequently accessed: ${fileName}`,
            content: body,
            tags: [filePath, 'auto-extracted'],
          });
        }
      }
    } catch {
      // Auto-extraction is non-critical — never block observe
    }
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
    // Stop Dreamer background agent
    if (this.dreamer) {
      this.dreamer.stop();
    }

    // Deregister agent from multi-agent registry
    if (this.agentRegistry) {
      try { this.agentRegistry.deregister(); } catch {}
    }

    // Update session chain with summary before shutdown
    if (this.storage && this.sessionManager) {
      try {
        const tokenEstimate = this.budgetManager.getTokenEstimate(this.session.session_id);
        this.sessionManager.updateChainEntry(this.session.session_id, {
          summary: `Session ended after ${Math.round((Date.now() - this.session.started_at) / 60000)}m`,
          token_estimate: tokenEstimate.used,
        });
      } catch {
        // Non-critical
      }
    }

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
    // Close global store
    if (this.globalStore) {
      try { this.globalStore.close(); } catch {}
    }

    await this.registry.shutdown();
  }

  async restoreSession(sessionId: string): Promise<{ snapshot: Record<string, unknown>; condensed: boolean } | null> {
    this.ensureStarted();
    return this.sessionManager.restoreSnapshot(sessionId);
  }
}
