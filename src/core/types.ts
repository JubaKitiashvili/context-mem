// Plugin system types
export const PLUGIN_TYPES = ['summarizer', 'search', 'storage', 'runtime', 'platform', 'memory'] as const;
export type PluginType = typeof PLUGIN_TYPES[number];

export const OBSERVATION_TYPES = ['code', 'error', 'log', 'test', 'commit', 'decision', 'context'] as const;
export type ObservationType = typeof OBSERVATION_TYPES[number];

export interface PluginConfig {
  [key: string]: unknown;
}

export interface Plugin {
  name: string;
  version: string;
  type: PluginType;
  init(config: PluginConfig): Promise<void>;
  destroy(): Promise<void>;
}

export function isPlugin(obj: unknown): obj is Plugin {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.name === 'string' &&
    typeof p.version === 'string' &&
    typeof p.type === 'string' &&
    PLUGIN_TYPES.includes(p.type as PluginType) &&
    typeof p.init === 'function' &&
    typeof p.destroy === 'function'
  );
}

// Observation
export interface ObservationMetadata {
  source: string;
  file_path?: string;
  language?: string;
  tokens_original: number;
  tokens_summarized: number;
  privacy_level: 'public' | 'private' | 'redacted';
  session_id?: string;
  correlation_id?: string;
  files_modified?: string[];
}

export interface Observation {
  id: string;
  type: ObservationType;
  content: string;
  summary?: string;
  content_hash?: string;
  metadata: ObservationMetadata;
  embeddings?: Float32Array;
  indexed_at: number;
}

// Truncation result
export interface TruncationResult {
  content: string;
  tier: 1 | 2 | 3 | 4;
  original_length: number;
  truncated_length: number;
}

// Budget types
export type OverflowStrategy = 'aggressive_truncation' | 'warn' | 'hard_stop';

export interface BudgetConfig {
  session_limit: number;
  overflow_strategy: OverflowStrategy;
  agent_limits?: Record<string, number>;
}

export interface BudgetStatus {
  used: number;
  limit: number;
  percentage: number;
  strategy: OverflowStrategy;
  throttled: boolean;
  blocked: boolean;
  signal?: string;
}

// Knowledge types
export type KnowledgeCategory = 'pattern' | 'decision' | 'error' | 'api' | 'component';
export type SourceType = 'explicit' | 'inferred' | 'observed';

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  shareable: boolean;
  relevance_score: number;
  access_count: number;
  created_at: number;
  last_accessed: number;
  archived: boolean;
  source_type: SourceType;
}

export interface ContradictionWarning {
  id: string;
  title: string;
  content: string;
  similarity_reason: string;
  source_type?: SourceType;
}

// Knowledge Graph types
export const ENTITY_TYPES = ['file', 'module', 'pattern', 'decision', 'bug', 'person', 'library', 'service', 'api', 'config'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const RELATIONSHIP_TYPES = ['uses', 'depends-on', 'fixed-by', 'contradicts', 'supersedes', 'implements', 'tests', 'documents'] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

export interface Entity {
  id: string;
  name: string;
  entity_type: EntityType;
  metadata: Record<string, unknown>;
  knowledge_id?: string;
  created_at: number;
  updated_at: number;
}

export interface Relationship {
  id: string;
  from_entity: string;
  to_entity: string;
  relationship_type: RelationshipType;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface GraphResult {
  entities: Entity[];
  relationships: Relationship[];
}

// Agent types
export interface AgentInfo {
  id: string;
  name: string;
  session_id: string;
  pid: number;
  started_at: number;
  last_heartbeat: number;
  status: 'active' | 'idle' | 'stopped';
  current_task: string;
  files_claimed: string[];
}

// Event types
export type EventPriority = 1 | 2 | 3 | 4;

export interface ContextEvent {
  id: string;
  session_id: string;
  event_type: string;
  priority: EventPriority;
  agent?: string;
  data: Record<string, unknown>;
  context_bytes: number;
  timestamp: number;
}

// Session snapshot
export interface SessionSnapshot {
  session_id: string;
  snapshot: string;
  created_at: number;
}

// Storage plugin
export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface StoragePlugin extends Plugin {
  type: 'storage';
  open(dbPath: string): Promise<void>;
  exec(sql: string, params?: unknown[]): void;
  prepare(sql: string): Statement;
  close(): Promise<void>;
  readonly supportsJSON: boolean;
  readonly supportsFTS5: boolean;
}

// Summarizer plugin
export interface SummaryResult {
  summary: string;
  tokens_original: number;
  tokens_summarized: number;
  savings_pct: number;
  content_type: string;
}

export interface SummarizeOpts {
  max_length?: number;
  include_metadata?: boolean;
}

export interface SummarizerPlugin extends Plugin {
  type: 'summarizer';
  contentTypes: string[];
  detect(content: string): boolean;
  summarize(content: string, opts: SummarizeOpts): Promise<SummaryResult>;
  /** Priority ordering (lower = checked first). Built-ins use 100-900. Plugins: 50 (before) or 950 (after). */
  priority?: number;
}

// Search plugin
export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  relevance_score: number;
  type: ObservationType;
  timestamp: number;
  access_count?: number;
}

export interface SearchOpts {
  limit?: number;
  type_filter?: ObservationType[];
  type_boosts?: Partial<Record<ObservationType, number>>;
  from?: number;
  to?: number;
}

export interface SearchPlugin extends Plugin {
  type: 'search';
  strategy: 'bm25' | 'trigram' | 'vector' | 'levenshtein';
  priority: number;
  search(query: string, opts: SearchOpts): Promise<SearchResult[]>;
  shouldFallback(results: SearchResult[]): boolean;
}

export interface SearchIntent {
  keywords: string[];
  type_boosts: Partial<Record<ObservationType, number>>;
  intent_type: 'causal' | 'lookup' | 'temporal' | 'general';
}

export interface SearchOrchestrator {
  classify(query: string): SearchIntent;
  execute(query: string, opts: SearchOpts): Promise<SearchResult[]>;
}

// Runtime plugin
export interface ExecOpts {
  timeout?: number;
  memory_limit?: number;
  env?: Record<string, string>;
  stdin?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  truncated: boolean;
}

export interface RuntimePlugin extends Plugin {
  type: 'runtime';
  language: string;
  extensions: string[];
  detect(): Promise<boolean>;
  execute(code: string, opts: ExecOpts): Promise<ExecResult>;
}

// Platform adapter
export interface HookConfig {
  type: 'subprocess' | 'direct_mcp';
  hook_script?: string;
  settings_path?: string;
}

export interface MCPServerConfig {
  port: number;
  transport: 'stdio' | 'http';
}

export interface ToolNameMap {
  [generic: string]: string;
}

export interface PlatformAdapter extends Plugin {
  type: 'platform';
  platform: string;
  detectPlatform(): boolean;
  getHookFormat(): HookConfig;
  getToolNames(): ToolNameMap;
  wrapMCPServer(): MCPServerConfig;
}

// Token economics
export interface TokenEconomics {
  session_id: string;
  observations_stored: number;
  total_content_bytes: number;
  total_summary_bytes: number;
  searches_performed: number;
  discovery_tokens: number;
  read_tokens: number;
  tokens_saved: number;
  savings_percentage: number;
}

// Session
export interface SessionContext {
  session_id: string;
  platform: string;
  started_at: number;
}

// Session chaining
export interface SessionChain {
  chain_id: string;
  session_id: string;
  parent_session: string | null;
  project_path: string;
  created_at: string;
  handoff_reason: 'auto' | 'manual' | 'compaction' | 'session_end';
  summary: string | null;
  token_estimate: number;
}

export interface HandoffResult {
  continuation_prompt: string;
  chain_id: string;
  snapshot_id: string;
  token_estimate: TokenEstimate;
}

export interface TokenEstimate {
  used: number;
  limit: number;
  percentage: number;
}

export interface SessionContinuityConfig {
  enabled: boolean;
  auto_restore_threshold_hours: number;
  light_restore_threshold_hours: number;
  snapshot_max_bytes: number;
  recovery_injection_max_bytes: number;
  recovery_cooldown_minutes: number;
}

export interface TokenEstimationConfig {
  model_context_limit: number;
  bytes_per_token: number;
  system_prompt_tokens: number;
  tool_definitions_tokens: number;
  per_message_overhead: number;
}

// Search fusion weight config
export interface SearchWeights {
  bm25?: number;
  trigram?: number;
  levenshtein?: number;
  vector?: number;
}

export const DEFAULT_SEARCH_WEIGHTS: Required<SearchWeights> = {
  bm25: 0.5,
  trigram: 0.3,
  levenshtein: 0.15,
  vector: 0.05,
};

// Global knowledge store config
export interface GlobalKnowledgeStoreConfig {
  enabled?: boolean;  // default true
  auto_suggest?: boolean;  // default true
}

// Proactive injection config
export interface ProactiveInjectionConfig {
  enabled?: boolean;                    // default true
  max_injections_per_minute?: number;   // default 3
  file_cooldown_seconds?: number;       // default 300
  relevance_threshold?: number;         // default 0.6
  max_injection_chars?: number;         // default 500
  inject_on?: string[];                 // default ['Read', 'Edit']
}

// Config
export interface ContextMemConfig {
  storage: string;
  plugins: {
    summarizers: string[];
    search: string[];
    runtimes: string[];
    custom?: string[];
    external_summarizers?: Record<string, {
      enabled?: boolean;
      priority?: number;
    }>;
  };
  privacy: {
    strip_tags: boolean;
    redact_patterns: string[];
    disabled_detectors?: string[];
  };
  token_economics: boolean;
  lifecycle: {
    ttl_days: number;
    max_db_size_mb: number;
    max_observations: number;
    cleanup_schedule: 'on_startup' | 'hourly' | 'manual';
    preserve_types: ObservationType[];
  };
  search_weights?: SearchWeights;
  global_knowledge?: GlobalKnowledgeStoreConfig;
  proactive_injection?: ProactiveInjectionConfig;
  session_continuity?: SessionContinuityConfig;
  token_estimation?: TokenEstimationConfig;
  port: number;
  api_port: number;
  db_path: string;
  execute_enabled: boolean;
}

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') deepFreeze(val as object);
  }
  return Object.freeze(obj);
}

export const DEFAULT_CONFIG: ContextMemConfig = deepFreeze({
  storage: 'auto',
  plugins: {
    summarizers: ['shell', 'json', 'error', 'log', 'code'],
    search: ['bm25', 'trigram'],
    runtimes: ['javascript', 'python'],
    custom: [],
  },
  privacy: {
    strip_tags: true,
    redact_patterns: [],
  },
  token_economics: true,
  lifecycle: {
    ttl_days: 30,
    max_db_size_mb: 500,
    max_observations: 50000,
    cleanup_schedule: 'on_startup',
    preserve_types: ['decision', 'commit'],
  },
  port: 51893,
  api_port: 51894,
  db_path: '.context-mem/store.db',
  execute_enabled: false,
  session_continuity: {
    enabled: true,
    auto_restore_threshold_hours: 2,
    light_restore_threshold_hours: 24,
    snapshot_max_bytes: 16384,
    recovery_injection_max_bytes: 2048,
    recovery_cooldown_minutes: 10,
  },
  token_estimation: {
    model_context_limit: 1_000_000,
    bytes_per_token: 4,
    system_prompt_tokens: 4000,
    tool_definitions_tokens: 2000,
    per_message_overhead: 500,
  },
});
