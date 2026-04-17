import type { Pipeline } from '../../core/pipeline.js';
import type { SearchFusion } from '../../plugins/search/fusion.js';
import type { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import type {
  ObservationType,
  ContextMemConfig,
} from '../../core/types.js';
import { OBSERVATION_TYPES } from '../../core/types.js';
import type { PluginRegistry } from '../../core/plugin-registry.js';
import type { BudgetManager } from '../../core/budget.js';
import type { EventTracker } from '../../core/events.js';
import type { SessionManager } from '../../core/session.js';
import type { ContentStore } from '../../plugins/storage/content-store.js';
import type { KnowledgeBase } from '../../plugins/knowledge/knowledge-base.js';
import type { GlobalKnowledgeStore } from '../../core/global-store.js';
import type { KnowledgeGraph } from '../../core/knowledge-graph.js';
import type { AgentRegistry } from '../../core/agent-registry.js';
import type { LLMService } from '../../core/llm-provider.js';

// Minimal kernel interface used by tool handlers
export interface ToolKernel {
  pipeline: Pipeline;
  search: SearchFusion;
  storage: BetterSqlite3Storage;
  registry: PluginRegistry;
  sessionId: string;
  config: ContextMemConfig;
  projectDir: string;
  budgetManager: BudgetManager;
  eventTracker: EventTracker;
  sessionManager: SessionManager;
  contentStore: ContentStore;
  knowledgeBase: KnowledgeBase;
  globalStore?: GlobalKnowledgeStore;
  knowledgeGraph?: KnowledgeGraph;
  agentRegistry?: AgentRegistry;
  llmService?: LLMService;
  feedbackEngine?: import('../../core/feedback-engine.js').FeedbackEngine;
  errorLogger?: import('../../core/error-logger.js').ErrorLogger;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Input validation helpers (shared across domain files)
// ---------------------------------------------------------------------------

export const MAX_CONTENT_LENGTH = 512 * 1024; // 512KB
export const MAX_LIMIT = 100;
export const MIN_LIMIT = 1;

export function validateLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 5;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, n));
}

export function validateTimestamp(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function validateObservationType(v: unknown): ObservationType {
  const s = String(v || 'context');
  return (OBSERVATION_TYPES as readonly string[]).includes(s) ? (s as ObservationType) : 'context';
}
