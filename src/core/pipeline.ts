import type { Observation, SummarizerPlugin, StoragePlugin, ObservationType } from './types.js';
import { PluginRegistry } from './plugin-registry.js';
import { PrivacyEngine } from '../plugins/privacy/privacy-engine.js';
import { ulid, estimateTokens } from './utils.js';

export class Pipeline {
  constructor(
    private registry: PluginRegistry,
    private storage: StoragePlugin,
    private privacy: PrivacyEngine,
    private sessionId: string,
  ) {}

  async observe(content: string, type: ObservationType, source: string, filePath?: string): Promise<Observation> {
    // 1. Privacy (fail-closed)
    const { cleaned, redactions, had_private_tags } = this.privacy.process(content);
    const privacyLevel = had_private_tags ? 'private' as const : redactions > 0 ? 'redacted' as const : 'public' as const;

    // 2. Find summarizer
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

    // 3. Build observation
    const obs: Observation = {
      id: ulid(),
      type,
      content: cleaned,
      summary,
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

    // 4. Store
    this.storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [obs.id, obs.type, obs.content, obs.summary || null, JSON.stringify(obs.metadata), obs.indexed_at, privacyLevel, this.sessionId]
    );

    // 5. Track token economics
    this.storage.exec(
      `INSERT INTO token_stats (session_id, event_type, tokens_in, tokens_out, timestamp)
       VALUES (?, 'store', ?, ?, ?)`,
      [this.sessionId, tokensOriginal, tokensSummarized, Date.now()]
    );

    return obs;
  }
}
