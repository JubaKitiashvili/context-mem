import { createHash } from 'node:crypto';
import type { Observation, SummarizerPlugin, StoragePlugin, ObservationType } from './types.js';
import { PluginRegistry } from './plugin-registry.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
import { truncate, MAX_PASSTHROUGH } from './truncation.js';
import { ulid, estimateTokens } from './utils.js';
import type { BudgetManager } from './budget.js';
import type { SessionManager } from './session.js';
import type { LLMService } from './llm-provider.js';
import { classifyImportance } from './importance-classifier.js';

export class Pipeline {
  private budgetManager?: BudgetManager;
  private sessionManager?: SessionManager;
  private observationCount = 0;
  private readonly CHECKPOINT_INTERVAL = 20;
  private embedder: { embed(text: string): Promise<Float32Array | null>; toBuffer(e: Float32Array): Buffer } | null = null;
  private llmService?: LLMService;

  constructor(
    private registry: PluginRegistry,
    private storage: StoragePlugin,
    private privacy: PrivacyEngine,
    private sessionId: string,
  ) {}

  setBudgetManager(budget: BudgetManager): void {
    this.budgetManager = budget;
  }

  setSessionManager(session: SessionManager): void {
    this.sessionManager = session;
  }

  setEmbedder(embedder: typeof this.embedder): void {
    this.embedder = embedder;
  }

  setLLMService(llm: LLMService): void {
    this.llmService = llm;
  }

  private scheduleEmbedding(id: string, text: string): void {
    setImmediate(async () => {
      try {
        const embedding = await this.embedder!.embed(text);
        if (embedding) {
          this.storage.exec('UPDATE observations SET embeddings = ? WHERE id = ?', [this.embedder!.toBuffer(embedding), id]);
        }
      } catch (err) {
        // Non-critical — embedding failure never blocks observe()
        console.error('context-mem: embedding failed:', (err as Error).message);
      }
    });
  }

  async observe(
    content: string,
    type: ObservationType,
    source: string,
    filePath?: string,
    opts?: { correlation_id?: string; files_modified?: string[] },
  ): Promise<Observation> {
    if (!content || !content.trim()) {
      throw new Error('Cannot observe empty content');
    }

    // 0. Budget check
    if (this.budgetManager) {
      const status = this.budgetManager.getStatus(this.sessionId);
      if (status.blocked) {
        throw new Error('Budget limit reached — observation blocked');
      }
    }

    // 1. Privacy (fail-closed)
    const { cleaned, redactions, had_private_tags } = this.privacy.process(content);
    const privacyLevel = had_private_tags ? 'private' as const : redactions > 0 ? 'redacted' as const : 'public' as const;

    // 2. SHA256 deduplication
    const contentHash = createHash('sha256').update(cleaned).digest('hex');
    const existing = this.storage.prepare(
      'SELECT id, type, content, summary, metadata, indexed_at, content_hash FROM observations WHERE content_hash = ?'
    ).get(contentHash) as Record<string, unknown> | undefined;

    if (existing) {
      let metadata: Observation['metadata'];
      try {
        metadata = JSON.parse(existing.metadata as string) as Observation['metadata'];
      } catch {
        metadata = { source, tokens_original: 0, tokens_summarized: 0, privacy_level: privacyLevel };
      }
      return {
        id: existing.id as string,
        type: existing.type as ObservationType,
        content: existing.content as string,
        summary: (existing.summary ?? undefined) as string | undefined,
        content_hash: existing.content_hash as string,
        metadata,
        indexed_at: existing.indexed_at as number,
      };
    }

    // 2.5 Importance classification (zero-LLM, deterministic)
    const importance = classifyImportance(cleaned, type);

    // 3. Find summarizer
    const summarizers = this.registry.getAll('summarizer') as SummarizerPlugin[];
    let summary: string | undefined;
    let tokensOriginal = estimateTokens(cleaned);
    let tokensSummarized = tokensOriginal;

    // 3a. Pinned observations bypass summarization — store content as summary for search compatibility
    if (importance.pinned) {
      summary = cleaned;
      tokensSummarized = tokensOriginal;
    }

    // 3b. LLM summarization (optional — try before deterministic, skip if pinned)
    if (this.llmService && !summary) {
      try {
        const llmResult = await this.llmService.summarize(cleaned);
        if (llmResult) {
          summary = llmResult.summary;
          tokensSummarized = estimateTokens(summary);
        }
      } catch {
        // LLM failure is non-critical — fall through to deterministic
      }
    }

    for (const s of summarizers) {
      if (s.detect(cleaned)) {
        try {
          const result = await s.summarize(cleaned, {});
          summary = result.summary;
          tokensSummarized = result.tokens_summarized;
        } catch {
          // Summarizer failed — store raw
        }
        break;
      }
    }

    // 4. Truncation cascade — if no summarizer matched and content is large
    if (!summary && cleaned.length > MAX_PASSTHROUGH) {
      let aggressive = false;
      if (this.budgetManager) {
        const bs = this.budgetManager.getStatus(this.sessionId);
        // Force aggressive truncation when throttled (80%+) or when strategy is aggressive_truncation and over limit
        aggressive = bs.throttled || (bs.strategy === 'aggressive_truncation' && bs.percentage >= 100);
      }
      const result = truncate(cleaned, aggressive);
      summary = result.content;
      tokensSummarized = estimateTokens(summary);
    }

    // 5. Build observation
    const obs: Observation = {
      id: ulid(),
      type,
      content: cleaned,
      summary,
      content_hash: contentHash,
      metadata: {
        source,
        file_path: filePath,
        tokens_original: tokensOriginal,
        tokens_summarized: tokensSummarized,
        privacy_level: privacyLevel,
        session_id: this.sessionId,
        correlation_id: opts?.correlation_id,
        files_modified: opts?.files_modified,
        importance_score: importance.score,
        significance_flags: importance.flags,
      },
      indexed_at: Date.now(),
    };

    // 6. Store
    this.storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id, content_hash, correlation_id, importance_score, pinned, compression_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [obs.id, obs.type, obs.content, obs.summary || null, JSON.stringify(obs.metadata), obs.indexed_at, privacyLevel, this.sessionId, contentHash, opts?.correlation_id || null, importance.score, importance.pinned ? 1 : 0, 'verbatim']
    );

    // 6b. Async embedding (fire-and-forget)
    if (this.embedder) {
      this.scheduleEmbedding(obs.id, obs.summary || obs.content);
    }

    // 7. Track token economics
    const bytesUsed = Buffer.byteLength(obs.content, 'utf8');
    this.storage.exec(
      `INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp)
       VALUES (?, 'store', ?, ?, ?)`,
      [this.sessionId, tokensOriginal, tokensSummarized, Date.now()]
    );

    // 8. Record budget usage
    if (this.budgetManager) {
      this.budgetManager.record(this.sessionId, bytesUsed);
    }

    // 9. Auto-checkpoint every N observations
    this.observationCount++;
    if (this.observationCount % this.CHECKPOINT_INTERVAL === 0 && this.sessionManager) {
      try {
        const row = this.storage.prepare(`
          SELECT COUNT(*) as cnt, COALESCE(SUM(tokens_in),0) as t_in, COALESCE(SUM(tokens_out),0) as t_out
          FROM token_stats WHERE session_id = ?
        `).get(this.sessionId) as { cnt: number; t_in: number; t_out: number };

        const minimalStats = {
          session_id: this.sessionId,
          observations_stored: row.cnt,
          total_content_bytes: row.t_in,
          total_summary_bytes: row.t_out,
          searches_performed: 0,
          discovery_tokens: 0,
          read_tokens: 0,
          tokens_saved: Math.max(0, row.t_in - row.t_out),
          savings_percentage: row.t_in > 0 ? Math.round(((row.t_in - row.t_out) / row.t_in) * 100) : 0,
        };
        this.sessionManager.saveSnapshot(this.sessionId, minimalStats);
      } catch {
        // Non-fatal — checkpoint is best-effort
      }
    }

    return obs;
  }
}
