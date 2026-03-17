import { createHash } from 'node:crypto';
import type { Observation, SummarizerPlugin, StoragePlugin, ObservationType } from './types.js';
import { PluginRegistry } from './plugin-registry.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
import { truncate, MAX_PASSTHROUGH } from './truncation.js';
import { ulid, estimateTokens } from './utils.js';
import type { BudgetManager } from './budget.js';

export class Pipeline {
  private budgetManager?: BudgetManager;

  constructor(
    private registry: PluginRegistry,
    private storage: StoragePlugin,
    private privacy: PrivacyEngine,
    private sessionId: string,
  ) {}

  setBudgetManager(budget: BudgetManager): void {
    this.budgetManager = budget;
  }

  async observe(content: string, type: ObservationType, source: string, filePath?: string): Promise<Observation> {
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

    // 3. Find summarizer
    const summarizers = this.registry.getAll('summarizer') as SummarizerPlugin[];
    let summary: string | undefined;
    let tokensOriginal = estimateTokens(cleaned);
    let tokensSummarized = tokensOriginal;

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
      const aggressive = this.budgetManager ? this.budgetManager.getStatus(this.sessionId).throttled : false;
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
      },
      indexed_at: Date.now(),
    };

    // 6. Store
    this.storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [obs.id, obs.type, obs.content, obs.summary || null, JSON.stringify(obs.metadata), obs.indexed_at, privacyLevel, this.sessionId, contentHash]
    );

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

    return obs;
  }
}
