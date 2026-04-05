# Optional LLM Integration — Design Specification

> Adds optional LLM-powered enhancement to context-mem's deterministic pipeline.
> Core principle: LLM enhances but is never required — deterministic fallback always works.

**Created:** 2026-04-06
**Version:** v2.5.0 (next release)
**Scope:** Provider abstraction, 5 prompt templates, auto-detect, setup wizard

---

## Background

context-mem v2.4.0 operates entirely on deterministic algorithms — 14 summarizers, 4-layer hybrid search, AttnRes-inspired adaptive reranking, and softmax block attention. This gives zero token cost and predictable behavior.

Adding optional LLM support enhances quality at every layer without breaking the deterministic foundation. When LLM is unavailable or returns invalid output, the system falls back to existing deterministic logic with zero regression.

### Current State

- `OllamaClient` in `src/core/ollama-client.ts` — 3 methods (generateTitle, generateTags, suggestMerge), Ollama-only
- `AICurationConfig` in `src/core/types.ts` — `enabled`, `model`, `endpoint` fields
- Default: `ai_curation.enabled = false`

---

## Architecture

### Provider Interface

Single generic interface with one `complete()` method. All domain logic lives in prompt templates, not providers.

```typescript
interface LLMProvider {
  name: string;
  complete(prompt: string, schema: Record<string, unknown>): Promise<unknown | null>;
  isAvailable(): Promise<boolean>;
}
```

- `complete()` sends a prompt + expected JSON schema, returns parsed JSON or null
- `isAvailable()` checks if the provider is reachable (cached after first check)
- null return = LLM unavailable or invalid response → deterministic fallback

### 3 Providers

| Provider | Endpoint | Auth | Default Model | Cost |
|----------|----------|------|---------------|------|
| `OllamaProvider` | `POST localhost:11434/api/generate` | none | llama3.2 | free |
| `OpenRouterProvider` | `POST openrouter.ai/api/v1/chat/completions` | `OPENROUTER_API_KEY` env | free model | free/paid |
| `ClaudeProvider` | `POST api.anthropic.com/v1/messages` | `ANTHROPIC_API_KEY` env | claude-haiku-4-5-20251001 | ~$0.25/1M input |

Each provider implements `complete()` by:
1. Formatting the prompt for its API (Ollama uses `/api/generate`, OpenRouter/Claude use chat completions format)
2. Including "Return ONLY valid JSON" instruction
3. Parsing the response as JSON
4. Returning parsed object or null on any failure

### LLMService (Facade)

```typescript
class LLMService {
  private provider: LLMProvider | null;
  
  // Auto-detect provider on first use
  async getProvider(): Promise<LLMProvider | null>;
  
  // Domain methods using prompt templates
  async expandQuery(query: string): Promise<{ expanded: string[], original: string } | null>;
  async generateTitle(content: string): Promise<string | null>;
  async generateTags(content: string): Promise<string[] | null>;
  async explainContradiction(entryA: string, entryB: string): Promise<{ conflict: string, merged_content: string } | null>;
  async summarize(content: string): Promise<{ summary: string, key_terms: string[] } | null>;
}
```

Each domain method:
1. Gets provider (auto-detect if needed)
2. Loads prompt template from registry
3. Calls `provider.complete(prompt, schema)`
4. Validates response structure (JSON.parse + typeof checks)
5. Returns typed result or null

### Auto-Detect Priority

```
1. ANTHROPIC_API_KEY in env? → ClaudeProvider (Haiku 4.5)
2. Ollama running on localhost:11434? → OllamaProvider
3. OPENROUTER_API_KEY in env? → OpenRouterProvider
4. None found → null (deterministic only, log warning)
```

Claude Code users get LLM features automatically — `ANTHROPIC_API_KEY` is already in the environment.

---

## Prompt Template Registry

5 structured templates. Every template enforces:
- "Return ONLY valid JSON" in the prompt
- Explicit JSON schema with field types and constraints
- Max lengths on all string outputs

### 1. Query Expansion

```typescript
{
  name: 'expand_query',
  prompt: (query: string) => `Expand this search query with 3-5 semantically related terms that would help find relevant results. Return ONLY valid JSON.\n\nQuery: "${query}"`,
  schema: { expanded: 'string[]', original: 'string' },
  validate: (r) => Array.isArray(r.expanded) && r.expanded.length <= 5 && typeof r.original === 'string',
}
```

### 2. Generate Title

```typescript
{
  name: 'generate_title',
  prompt: (content: string) => `Generate a concise title (max 80 chars) for this knowledge entry. Return ONLY valid JSON.\n\n${content.slice(0, 500)}`,
  schema: { title: 'string (max 80 chars)' },
  validate: (r) => typeof r.title === 'string' && r.title.length > 0 && r.title.length <= 80,
}
```

### 3. Generate Tags

```typescript
{
  name: 'generate_tags',
  prompt: (content: string) => `Extract 3-5 keyword tags from this text. Lowercase, single words or short phrases. Return ONLY valid JSON.\n\n${content.slice(0, 500)}`,
  schema: { tags: 'string[] (3-5 items, lowercase)' },
  validate: (r) => Array.isArray(r.tags) && r.tags.length >= 1 && r.tags.length <= 5,
}
```

### 4. Explain Contradiction

```typescript
{
  name: 'explain_contradiction',
  prompt: (a: string, b: string) => `These two knowledge entries may contradict each other. Explain the conflict in one sentence and suggest a merged version (max 200 chars). Return ONLY valid JSON.\n\nEntry A: ${a.slice(0, 300)}\nEntry B: ${b.slice(0, 300)}`,
  schema: { conflict: 'string', merged_content: 'string (max 200 chars)' },
  validate: (r) => typeof r.conflict === 'string' && typeof r.merged_content === 'string' && r.merged_content.length <= 200,
}
```

### 5. Smart Summarization

```typescript
{
  name: 'summarize',
  prompt: (content: string) => `Summarize this development observation in 1-2 sentences. Preserve technical details (file names, error codes, function names). Return ONLY valid JSON.\n\n${content.slice(0, 1000)}`,
  schema: { summary: 'string (max 200 chars)', key_terms: 'string[]' },
  validate: (r) => typeof r.summary === 'string' && r.summary.length <= 200 && Array.isArray(r.key_terms),
}
```

---

## Integration Points

### 1. Search Enhancement (query expansion)

**Where:** `src/mcp-server/tools.ts` — `handleSearch()`, before `kernel.search.execute()`

```
User query → LLMService.expandQuery(query)
  → success: combine original + expanded terms → execute search
  → null: execute search with original query (current behavior)
```

### 2. Knowledge Curation (title + tags)

**Where:** `src/plugins/knowledge/knowledge-base.ts` — `save()`, before auto-tagger fallback

```
save(entry) → title too short?
  → LLMService.generateTitle(content) → got title? use it
  → null? → auto-tagger.ts generateTitle() (current behavior)

save(entry) → tags empty?
  → LLMService.generateTags(content) → got tags? use them
  → null? → auto-tagger.ts generateTags() (current behavior)
```

### 3. Contradiction Reasoning

**Where:** `src/plugins/knowledge/knowledge-base.ts` — `checkContradictions()`, after authority scoring

```
authority computed → LLMService.explainContradiction(entryA, entryB)
  → success: add explanation + suggested_merge to ContradictionWarning
  → null: ContradictionWarning without explanation (current behavior)
```

**Type extension:**
```typescript
interface ContradictionWarning {
  // ... existing fields + authority fields from v2.4.0
  explanation?: string;        // LLM-generated conflict description
  suggested_merge?: string;    // LLM-suggested merged content
}
```

### 4. Smart Summarization

**Where:** `src/core/pipeline.ts` — summarization step, before deterministic summarizers

```
observation → LLMService.summarize(content)
  → success: use LLM summary + key_terms
  → null: run 14 deterministic summarizers (current behavior)
```

---

## Configuration

### Updated AICurationConfig

```typescript
interface AICurationConfig {
  enabled: boolean;                    // default false
  provider?: 'auto' | 'ollama' | 'openrouter' | 'claude';  // default 'auto'
  model?: string;                      // provider-specific model override
  endpoint?: string;                   // custom endpoint URL
}
```

### Setup Wizard

On `context-mem init` or first run, interactive prompt:

```
? Choose context-mem mode:
  ❯ Free (deterministic only — zero token cost)
    Enhanced (+ LLM features — requires API key or local Ollama)

[if Enhanced selected]
? LLM provider:
  ❯ Auto-detect (recommended)
    Ollama (local, free)
    OpenRouter (free/paid models)
    Claude API (requires ANTHROPIC_API_KEY)
```

Result writes to config: `ai_curation: { enabled: true, provider: 'auto' }`

Can also be enabled post-install via MCP tool: `configure({ ai_curation: { enabled: true } })`

---

## Safety Guarantees

1. **Default disabled** — no tokens spent without explicit user opt-in
2. **Validate every response** — JSON.parse + typeof checks, invalid → null
3. **Null = fallback** — every integration point has deterministic fallback
4. **No corrupted data** — invalid LLM output never reaches the database
5. **Timeout** — all API calls have 10s timeout (AbortSignal.timeout)
6. **Rate awareness** — reuses existing search throttle window for LLM calls

---

## Migration

- **`OllamaClient`** → refactored into `OllamaProvider` implementing `LLMProvider` interface
- **`AICurationConfig`** → extended with `provider` field (backwards compatible, defaults to 'auto' which checks Ollama first)
- **`ContradictionWarning`** → 2 optional fields added (`explanation`, `suggested_merge`)
- **Database schema** → no changes needed
- **Existing behavior** → zero regression when `ai_curation.enabled = false`

---

## Files

### New files
- `src/core/llm-provider.ts` — LLMProvider interface + LLMService facade
- `src/core/providers/ollama-provider.ts` — Ollama implementation
- `src/core/providers/openrouter-provider.ts` — OpenRouter implementation
- `src/core/providers/claude-provider.ts` — Claude API implementation
- `src/core/prompt-templates.ts` — 5 prompt templates with schemas and validators
- `src/tests/core/llm-provider.test.ts` — provider interface tests
- `src/tests/core/prompt-templates.test.ts` — template validation tests

### Modified files
- `src/core/types.ts` — AICurationConfig + ContradictionWarning extensions
- `src/core/ollama-client.ts` — removed (replaced by ollama-provider.ts)
- `src/plugins/knowledge/knowledge-base.ts` — LLM integration in save() and checkContradictions()
- `src/mcp-server/tools.ts` — query expansion in handleSearch()
- `src/core/pipeline.ts` — LLM summarization before deterministic
- `src/cli/index.ts` — setup wizard in init command

---

## Testing Strategy

- **Unit tests:** each provider's complete() with mocked HTTP responses
- **Template tests:** validate() functions on good/bad/edge-case JSON
- **Integration tests:** LLMService with mock provider → verify fallback chain
- **Regression tests:** all existing tests must pass with ai_curation.enabled = false
- **Live test:** temp project with real Ollama (if available) or mocked responses
