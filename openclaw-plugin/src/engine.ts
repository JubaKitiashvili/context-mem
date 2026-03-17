/**
 * ContextEngine implementation for OpenClaw.
 *
 * Lifecycle hooks:
 *   bootstrap → ingest → assemble → compact → afterTurn → dispose
 *
 * context-mem handles all context compression, search, and retrieval
 * through its kernel, pipeline, and 14 summarizer plugins.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

interface Message {
  role: string;
  content: string;
}

interface ContextEngineInfo {
  id: string;
  name: string;
  version: string;
  ownsCompaction: boolean;
}

interface IngestParams {
  sessionId: string;
  sessionKey?: string;
  message: Message;
  isHeartbeat?: boolean;
}

interface AssembleParams {
  sessionId: string;
  sessionKey?: string;
  messages: Message[];
  tokenBudget?: number;
}

interface CompactParams {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  tokenBudget?: number;
  force?: boolean;
  currentTokenCount?: number;
}

interface BootstrapParams {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
}

interface AfterTurnParams {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  messages: Message[];
  prePromptMessageCount: number;
  tokenBudget?: number;
}

// Dynamically import context-mem kernel
let KernelClass: any = null;

async function getKernel() {
  if (!KernelClass) {
    const mod = await import('context-mem');
    KernelClass = mod.Kernel;
  }
  return KernelClass;
}

export class ContextMemEngine {
  readonly info: ContextEngineInfo = {
    id: 'context-mem',
    name: 'context-mem Context Engine',
    version: '0.2.0',
    ownsCompaction: true, // We handle compaction ourselves
  };

  private kernel: any = null;
  private api: OpenClawPluginApi;
  private sessionId: string = '';
  private messageCount = 0;
  private compressedMessages: Message[] = [];

  constructor(api: OpenClawPluginApi) {
    this.api = api;
  }

  /** Initialize engine for a new session */
  async bootstrap(params: BootstrapParams): Promise<void> {
    this.sessionId = params.sessionId;

    const Kernel = await getKernel();
    this.kernel = new Kernel(process.cwd());
    await this.kernel.start();

    this.api.logger.info(`[context-mem] Session ${params.sessionId} bootstrapped`);
  }

  /** Ingest a single message — compress tool outputs */
  async ingest(params: IngestParams): Promise<{ ingested: boolean }> {
    if (params.isHeartbeat || !this.kernel) {
      return { ingested: false };
    }

    const { message } = params;
    this.messageCount++;

    // Only compress tool results and assistant messages with tool output
    if (message.role === 'tool' || (message.role === 'assistant' && message.content.length > 2048)) {
      try {
        const result = await this.kernel.pipeline.process(message.content, {
          type: message.role === 'tool' ? 'tool_result' : 'assistant',
        });

        if (result.summary) {
          this.compressedMessages.push({
            role: message.role,
            content: result.summary,
          });
          return { ingested: true };
        }
      } catch (err) {
        this.api.logger.debug(`[context-mem] Ingest error: ${err}`);
      }
    }

    // Store as-is for non-compressible messages
    this.compressedMessages.push(message);
    return { ingested: true };
  }

  /** Assemble context for a model run — return compressed messages */
  async assemble(params: AssembleParams): Promise<{
    messages: Message[];
    estimatedTokens: number;
    systemPromptAddition?: string;
  }> {
    const messages = this.compressedMessages.length > 0
      ? this.compressedMessages
      : params.messages;

    // Estimate tokens (rough: 4 chars per token)
    const estimatedTokens = messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4), 0
    );

    const stats = this.kernel ? await this.getStats() : null;
    const systemAddition = stats
      ? `\n[context-mem: ${stats.observations} observations, ${stats.savings}% token savings]`
      : undefined;

    return {
      messages,
      estimatedTokens,
      systemPromptAddition: systemAddition,
    };
  }

  /** Compact context when window is full */
  async compact(params: CompactParams): Promise<{
    ok: boolean;
    compacted: boolean;
    reason?: string;
    result?: any;
  }> {
    if (!this.kernel) {
      return { ok: false, compacted: false, reason: 'Kernel not initialized' };
    }

    try {
      // Re-compress all stored messages more aggressively
      const recompressed: Message[] = [];
      for (const msg of this.compressedMessages) {
        if (msg.content.length > 512) {
          const result = await this.kernel.pipeline.process(msg.content, {
            type: 'compact',
            aggressive: true,
          });
          recompressed.push({
            role: msg.role,
            content: result.summary || msg.content.substring(0, 256) + '...',
          });
        } else {
          recompressed.push(msg);
        }
      }

      this.compressedMessages = recompressed;

      this.api.logger.info(`[context-mem] Compacted ${this.messageCount} messages`);
      return { ok: true, compacted: true };
    } catch (err) {
      return { ok: false, compacted: false, reason: String(err) };
    }
  }

  /** Post-turn lifecycle — persist state */
  async afterTurn(params: AfterTurnParams): Promise<void> {
    // Save session snapshot for continuity
    if (this.kernel?.getSessionManager()) {
      try {
        await this.kernel.getSessionManager().saveSnapshot(params.sessionId);
      } catch {
        // Non-critical
      }
    }
  }

  /** Search observations */
  async searchObservations(query: string): Promise<any> {
    if (!this.kernel) return { results: [] };
    const search = this.kernel.getSearchFusion();
    return search.search(query, { limit: 10 });
  }

  /** Get token stats */
  async getStats(): Promise<any> {
    if (!this.kernel) return null;
    const storage = this.kernel.getStorage();
    const stats = storage.getStats?.() ?? {};
    return {
      observations: stats.totalObservations ?? 0,
      rawTokens: stats.totalRawTokens ?? 0,
      compressedTokens: stats.totalCompressedTokens ?? 0,
      savings: stats.totalRawTokens
        ? Math.round((1 - (stats.totalCompressedTokens ?? 0) / stats.totalRawTokens) * 100)
        : 0,
    };
  }

  /** Cleanup on shutdown */
  async dispose(): Promise<void> {
    if (this.kernel) {
      await this.kernel.stop();
      this.kernel = null;
    }
    this.api.logger.info('[context-mem] Engine disposed');
  }
}
