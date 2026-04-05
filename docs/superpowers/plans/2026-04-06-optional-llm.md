# Optional LLM Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional LLM-powered enhancement to context-mem — provider abstraction, 5 prompt templates, auto-detect, and integration at 4 pipeline points.

**Architecture:** Single `LLMProvider` interface with `complete(prompt, schema)` method. Three providers (Ollama, OpenRouter, Claude). `LLMService` facade with auto-detect. Prompt template registry with structured JSON output and validators. Default disabled — deterministic fallback always works.

**Tech Stack:** TypeScript, Node.js test runner, fetch API (no external deps)

**Spec:** `docs/superpowers/specs/2026-04-06-optional-llm-design.md`

---

## Phase 1: Provider Foundation

### Task 1: LLMProvider interface and prompt templates

**Files:**
- Create: `src/core/llm-provider.ts`
- Create: `src/core/prompt-templates.ts`
- Test: `src/tests/core/prompt-templates.test.ts`

- [ ] **Step 1: Write failing tests for prompt template validators**

Create `src/tests/core/prompt-templates.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_TEMPLATES } from '../../core/prompt-templates.js';

describe('prompt template validators', () => {
  describe('expand_query', () => {
    const t = PROMPT_TEMPLATES.expand_query;

    it('accepts valid expansion', () => {
      assert.equal(t.validate({ expanded: ['auth', 'jwt', 'login'], original: 'auth' }), true);
    });

    it('rejects missing expanded array', () => {
      assert.equal(t.validate({ original: 'auth' }), false);
    });

    it('rejects non-array expanded', () => {
      assert.equal(t.validate({ expanded: 'auth jwt', original: 'auth' }), false);
    });

    it('rejects too many expanded terms', () => {
      assert.equal(t.validate({ expanded: ['a', 'b', 'c', 'd', 'e', 'f'], original: 'x' }), false);
    });
  });

  describe('generate_title', () => {
    const t = PROMPT_TEMPLATES.generate_title;

    it('accepts valid title', () => {
      assert.equal(t.validate({ title: 'JWT Auth Pattern' }), true);
    });

    it('rejects empty title', () => {
      assert.equal(t.validate({ title: '' }), false);
    });

    it('rejects too-long title', () => {
      assert.equal(t.validate({ title: 'x'.repeat(81) }), false);
    });

    it('rejects non-string title', () => {
      assert.equal(t.validate({ title: 123 }), false);
    });
  });

  describe('generate_tags', () => {
    const t = PROMPT_TEMPLATES.generate_tags;

    it('accepts valid tags', () => {
      assert.equal(t.validate({ tags: ['jwt', 'auth', 'security'] }), true);
    });

    it('rejects empty tags', () => {
      assert.equal(t.validate({ tags: [] }), false);
    });

    it('rejects too many tags', () => {
      assert.equal(t.validate({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), false);
    });
  });

  describe('explain_contradiction', () => {
    const t = PROMPT_TEMPLATES.explain_contradiction;

    it('accepts valid explanation', () => {
      assert.equal(t.validate({ conflict: 'JWT vs cookies', merged_content: 'Support both' }), true);
    });

    it('rejects too-long merged content', () => {
      assert.equal(t.validate({ conflict: 'x', merged_content: 'y'.repeat(201) }), false);
    });
  });

  describe('summarize', () => {
    const t = PROMPT_TEMPLATES.summarize;

    it('accepts valid summary', () => {
      assert.equal(t.validate({ summary: 'Fixed JWT bug', key_terms: ['JWT', 'bug'] }), true);
    });

    it('rejects too-long summary', () => {
      assert.equal(t.validate({ summary: 'x'.repeat(201), key_terms: [] }), false);
    });

    it('rejects non-array key_terms', () => {
      assert.equal(t.validate({ summary: 'ok', key_terms: 'jwt' }), false);
    });
  });

  describe('prompt generation', () => {
    it('expand_query generates prompt with query', () => {
      const prompt = PROMPT_TEMPLATES.expand_query.prompt('auth');
      assert.ok(prompt.includes('auth'), 'prompt should contain query');
      assert.ok(prompt.includes('JSON'), 'prompt should mention JSON');
    });

    it('generate_title truncates long content', () => {
      const longContent = 'x'.repeat(1000);
      const prompt = PROMPT_TEMPLATES.generate_title.prompt(longContent);
      assert.ok(prompt.length < 1000, 'prompt should truncate content');
    });

    it('explain_contradiction takes two entries', () => {
      const prompt = PROMPT_TEMPLATES.explain_contradiction.prompt('Entry A content', 'Entry B content');
      assert.ok(prompt.includes('Entry A'), 'prompt should contain entry A');
      assert.ok(prompt.includes('Entry B'), 'prompt should contain entry B');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/core/prompt-templates.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Create the LLMProvider interface**

Create `src/core/llm-provider.ts`:

```typescript
/**
 * Abstract LLM provider interface.
 * Each provider implements one method: complete(prompt, schema) → parsed JSON or null.
 */
export interface LLMProvider {
  name: string;
  complete(prompt: string, schema: Record<string, unknown>): Promise<unknown | null>;
  isAvailable(): Promise<boolean>;
}
```

- [ ] **Step 4: Create prompt templates**

Create `src/core/prompt-templates.ts`:

```typescript
export interface PromptTemplate {
  name: string;
  prompt: (...args: string[]) => string;
  validate: (response: unknown) => boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export const PROMPT_TEMPLATES = {
  expand_query: {
    name: 'expand_query',
    prompt: (query: string) =>
      `Expand this search query with 3-5 semantically related terms that would help find relevant results. Return ONLY valid JSON matching this schema: { "expanded": ["term1", "term2", ...], "original": "the original query" }\n\nQuery: "${query}"`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return Array.isArray(r.expanded) && r.expanded.length >= 1 && r.expanded.length <= 5
        && r.expanded.every((t: unknown) => typeof t === 'string')
        && typeof r.original === 'string';
    },
  },

  generate_title: {
    name: 'generate_title',
    prompt: (content: string) =>
      `Generate a concise title (max 80 chars) for this knowledge entry. Return ONLY valid JSON matching this schema: { "title": "the title" }\n\n${content.slice(0, 500)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return typeof r.title === 'string' && r.title.length > 0 && r.title.length <= 80;
    },
  },

  generate_tags: {
    name: 'generate_tags',
    prompt: (content: string) =>
      `Extract 3-5 keyword tags from this text. Lowercase, single words or short phrases. Return ONLY valid JSON matching this schema: { "tags": ["tag1", "tag2", ...] }\n\n${content.slice(0, 500)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return Array.isArray(r.tags) && r.tags.length >= 1 && r.tags.length <= 5
        && r.tags.every((t: unknown) => typeof t === 'string');
    },
  },

  explain_contradiction: {
    name: 'explain_contradiction',
    prompt: (entryA: string, entryB: string) =>
      `These two knowledge entries may contradict each other. Explain the conflict in one sentence and suggest a merged version (max 200 chars). Return ONLY valid JSON matching this schema: { "conflict": "description", "merged_content": "merged text" }\n\nEntry A: ${entryA.slice(0, 300)}\nEntry B: ${entryB.slice(0, 300)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return typeof r.conflict === 'string' && typeof r.merged_content === 'string'
        && r.merged_content.length <= 200;
    },
  },

  summarize: {
    name: 'summarize',
    prompt: (content: string) =>
      `Summarize this development observation in 1-2 sentences. Preserve technical details (file names, error codes, function names). Return ONLY valid JSON matching this schema: { "summary": "the summary", "key_terms": ["term1", "term2"] }\n\n${content.slice(0, 1000)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return typeof r.summary === 'string' && r.summary.length <= 200
        && Array.isArray(r.key_terms) && r.key_terms.every((t: unknown) => typeof t === 'string');
    },
  },
} as const satisfies Record<string, PromptTemplate>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/core/prompt-templates.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/llm-provider.ts src/core/prompt-templates.ts src/tests/core/prompt-templates.test.ts
git commit -m "feat: LLMProvider interface and 5 prompt templates with validators"
```

---

### Task 2: OllamaProvider (replaces OllamaClient)

**Files:**
- Create: `src/core/providers/ollama-provider.ts`
- Modify: `src/tests/core/ollama-client.test.ts` → rename and update
- Remove: `src/core/ollama-client.ts` (after provider is working)

- [ ] **Step 1: Write failing tests**

Replace contents of `src/tests/core/ollama-client.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider } from '../../core/providers/ollama-provider.js';

describe('OllamaProvider', () => {
  it('returns false for isAvailable when server is not running', async () => {
    const provider = new OllamaProvider('http://localhost:99999');
    const available = await provider.isAvailable();
    assert.equal(available, false);
  });

  it('returns null for complete when unavailable', async () => {
    const provider = new OllamaProvider('http://localhost:99999');
    const result = await provider.complete('test prompt', {});
    assert.equal(result, null);
  });

  it('has name "ollama"', () => {
    const provider = new OllamaProvider();
    assert.equal(provider.name, 'ollama');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/core/ollama-client.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Create OllamaProvider**

Create directory and file `src/core/providers/ollama-provider.ts`:

```typescript
import type { LLMProvider } from '../llm-provider.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private endpoint: string;
  private model: string;
  private available: boolean | null = null;

  constructor(endpoint = 'http://localhost:11434', model = 'llama3.2') {
    this.endpoint = endpoint;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
      this.available = res.ok;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async complete(prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { response?: string };
      if (!data.response) return null;
      return JSON.parse(data.response);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Remove old OllamaClient**

Delete `src/core/ollama-client.ts`. It is fully replaced by `OllamaProvider`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/core/ollama-client.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/ollama-provider.ts src/tests/core/ollama-client.test.ts
git rm src/core/ollama-client.ts
git commit -m "feat: OllamaProvider replacing OllamaClient with LLMProvider interface"
```

---

### Task 3: OpenRouterProvider and ClaudeProvider

**Files:**
- Create: `src/core/providers/openrouter-provider.ts`
- Create: `src/core/providers/claude-provider.ts`
- Test: `src/tests/core/providers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/core/providers.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterProvider } from '../../core/providers/openrouter-provider.js';
import { ClaudeProvider } from '../../core/providers/claude-provider.js';

describe('OpenRouterProvider', () => {
  it('returns false for isAvailable without API key', async () => {
    const provider = new OpenRouterProvider('');
    const available = await provider.isAvailable();
    assert.equal(available, false);
  });

  it('returns null for complete without API key', async () => {
    const provider = new OpenRouterProvider('');
    const result = await provider.complete('test', {});
    assert.equal(result, null);
  });

  it('has name "openrouter"', () => {
    const provider = new OpenRouterProvider('fake-key');
    assert.equal(provider.name, 'openrouter');
  });
});

describe('ClaudeProvider', () => {
  it('returns false for isAvailable without API key', async () => {
    const provider = new ClaudeProvider('');
    const available = await provider.isAvailable();
    assert.equal(available, false);
  });

  it('returns null for complete without API key', async () => {
    const provider = new ClaudeProvider('');
    const result = await provider.complete('test', {});
    assert.equal(result, null);
  });

  it('has name "claude"', () => {
    const provider = new ClaudeProvider('fake-key');
    assert.equal(provider.name, 'claude');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/core/providers.test.js`
Expected: FAIL — modules not found

- [ ] **Step 3: Create OpenRouterProvider**

Create `src/core/providers/openrouter-provider.ts`:

```typescript
import type { LLMProvider } from '../llm-provider.js';

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(apiKey: string, model = 'meta-llama/llama-3.2-3b-instruct:free', endpoint = 'https://openrouter.ai/api/v1/chat/completions') {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async complete(prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/context-mem',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Create ClaudeProvider**

Create `src/core/providers/claude-provider.ts`:

```typescript
import type { LLMProvider } from '../llm-provider.js';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async complete(prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { content?: Array<{ text?: string }> };
      const text = data.content?.[0]?.text;
      if (!text) return null;
      // Extract JSON from response (Claude may wrap in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/core/providers.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/openrouter-provider.ts src/core/providers/claude-provider.ts src/tests/core/providers.test.ts
git commit -m "feat: OpenRouter and Claude LLM providers"
```

---

### Task 4: LLMService facade with auto-detect

**Files:**
- Modify: `src/core/llm-provider.ts` — add LLMService class
- Modify: `src/core/types.ts` — extend AICurationConfig
- Test: `src/tests/core/llm-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/core/llm-service.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLMService } from '../../core/llm-provider.js';
import type { LLMProvider } from '../../core/llm-provider.js';

function mockProvider(responses: Record<string, unknown>): LLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    async isAvailable() { return true; },
    async complete(prompt: string) {
      callCount++;
      // Return based on which template is being called (check prompt content)
      if (prompt.includes('Expand this search query')) return responses.expand ?? null;
      if (prompt.includes('concise title')) return responses.title ?? null;
      if (prompt.includes('keyword tags')) return responses.tags ?? null;
      if (prompt.includes('contradict')) return responses.contradiction ?? null;
      if (prompt.includes('Summarize')) return responses.summarize ?? null;
      return null;
    },
  };
}

describe('LLMService', () => {
  it('expandQuery returns expanded terms', async () => {
    const provider = mockProvider({ expand: { expanded: ['authentication', 'jwt', 'login'], original: 'auth' } });
    const service = new LLMService(provider);
    const result = await service.expandQuery('auth');
    assert.ok(result);
    assert.deepEqual(result.expanded, ['authentication', 'jwt', 'login']);
    assert.equal(result.original, 'auth');
  });

  it('generateTitle returns title string', async () => {
    const provider = mockProvider({ title: { title: 'JWT Auth Pattern' } });
    const service = new LLMService(provider);
    const result = await service.generateTitle('Use JWT for auth...');
    assert.equal(result, 'JWT Auth Pattern');
  });

  it('generateTags returns tag array', async () => {
    const provider = mockProvider({ tags: { tags: ['jwt', 'auth', 'security'] } });
    const service = new LLMService(provider);
    const result = await service.generateTags('JWT authentication content');
    assert.deepEqual(result, ['jwt', 'auth', 'security']);
  });

  it('explainContradiction returns conflict and merge', async () => {
    const provider = mockProvider({ contradiction: { conflict: 'JWT vs cookies', merged_content: 'Support both' } });
    const service = new LLMService(provider);
    const result = await service.explainContradiction('Use JWT', 'Use cookies');
    assert.ok(result);
    assert.equal(result.conflict, 'JWT vs cookies');
    assert.equal(result.merged_content, 'Support both');
  });

  it('summarize returns summary and key terms', async () => {
    const provider = mockProvider({ summarize: { summary: 'Fixed JWT bug in auth.ts', key_terms: ['JWT', 'auth.ts'] } });
    const service = new LLMService(provider);
    const result = await service.summarize('Long observation content...');
    assert.ok(result);
    assert.equal(result.summary, 'Fixed JWT bug in auth.ts');
    assert.deepEqual(result.key_terms, ['JWT', 'auth.ts']);
  });

  it('returns null when provider returns invalid data', async () => {
    const provider = mockProvider({ title: { wrong_field: 'bad' } });
    const service = new LLMService(provider);
    const result = await service.generateTitle('content');
    assert.equal(result, null);
  });

  it('returns null when provider returns null', async () => {
    const provider = mockProvider({});
    const service = new LLMService(provider);
    const result = await service.generateTitle('content');
    assert.equal(result, null);
  });

  it('works with null provider (disabled)', async () => {
    const service = new LLMService(null);
    const result = await service.expandQuery('auth');
    assert.equal(result, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/core/llm-service.test.js`
Expected: FAIL — `LLMService` not exported

- [ ] **Step 3: Extend AICurationConfig in types.ts**

In `src/core/types.ts`, update the `AICurationConfig` interface:

```typescript
export interface AICurationConfig {
  enabled?: boolean;                    // default false (opt-in)
  provider?: 'auto' | 'ollama' | 'openrouter' | 'claude';  // default 'auto'
  model?: string;                       // default depends on provider
  endpoint?: string;                    // default 'http://localhost:11434'
}
```

- [ ] **Step 4: Implement LLMService in llm-provider.ts**

Add to `src/core/llm-provider.ts`:

```typescript
import { PROMPT_TEMPLATES } from './prompt-templates.js';

export interface LLMProvider {
  name: string;
  complete(prompt: string, schema: Record<string, unknown>): Promise<unknown | null>;
  isAvailable(): Promise<boolean>;
}

export class LLMService {
  private provider: LLMProvider | null;

  constructor(provider: LLMProvider | null) {
    this.provider = provider;
  }

  private async call(templateName: keyof typeof PROMPT_TEMPLATES, ...args: string[]): Promise<unknown | null> {
    if (!this.provider) return null;
    const template = PROMPT_TEMPLATES[templateName];
    const prompt = template.prompt(...args);
    const result = await this.provider.complete(prompt, {});
    if (result === null) return null;
    if (!template.validate(result)) return null;
    return result;
  }

  async expandQuery(query: string): Promise<{ expanded: string[]; original: string } | null> {
    const result = await this.call('expand_query', query);
    if (!result) return null;
    const r = result as { expanded: string[]; original: string };
    return { expanded: r.expanded, original: r.original };
  }

  async generateTitle(content: string): Promise<string | null> {
    const result = await this.call('generate_title', content);
    if (!result) return null;
    return (result as { title: string }).title;
  }

  async generateTags(content: string): Promise<string[] | null> {
    const result = await this.call('generate_tags', content);
    if (!result) return null;
    return (result as { tags: string[] }).tags;
  }

  async explainContradiction(entryA: string, entryB: string): Promise<{ conflict: string; merged_content: string } | null> {
    const result = await this.call('explain_contradiction', entryA, entryB);
    if (!result) return null;
    const r = result as { conflict: string; merged_content: string };
    return { conflict: r.conflict, merged_content: r.merged_content };
  }

  async summarize(content: string): Promise<{ summary: string; key_terms: string[] } | null> {
    const result = await this.call('summarize', content);
    if (!result) return null;
    const r = result as { summary: string; key_terms: string[] };
    return { summary: r.summary, key_terms: r.key_terms };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/core/llm-service.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/llm-provider.ts src/core/types.ts src/tests/core/llm-service.test.ts
git commit -m "feat: LLMService facade with auto-detect and template validation"
```

---

## Phase 2: Auto-Detect and Provider Factory

### Task 5: Provider factory with auto-detect

**Files:**
- Create: `src/core/llm-factory.ts`
- Test: `src/tests/core/llm-factory.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/core/llm-factory.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLLMService } from '../../core/llm-factory.js';

describe('createLLMService', () => {
  it('returns service with null provider when disabled', async () => {
    const service = await createLLMService({ enabled: false });
    const result = await service.expandQuery('test');
    assert.equal(result, null, 'disabled service should return null');
  });

  it('returns service with null provider when no provider found', async () => {
    // No ANTHROPIC_API_KEY, no OPENROUTER_API_KEY, Ollama not running
    const service = await createLLMService({ enabled: true, provider: 'ollama', endpoint: 'http://localhost:99999' });
    const result = await service.expandQuery('test');
    assert.equal(result, null, 'unavailable provider should return null');
  });

  it('creates Claude provider when provider is "claude" with key', async () => {
    const service = await createLLMService({ enabled: true, provider: 'claude' }, 'fake-key');
    // Service is created (won't work without real key, but won't crash)
    assert.ok(service, 'should create service with claude provider');
  });

  it('creates OpenRouter provider when provider is "openrouter" with key', async () => {
    const service = await createLLMService({ enabled: true, provider: 'openrouter' }, undefined, 'fake-key');
    assert.ok(service, 'should create service with openrouter provider');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/core/llm-factory.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement provider factory**

Create `src/core/llm-factory.ts`:

```typescript
import type { AICurationConfig } from './types.js';
import { LLMService } from './llm-provider.js';
import type { LLMProvider } from './llm-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { OpenRouterProvider } from './providers/openrouter-provider.js';
import { ClaudeProvider } from './providers/claude-provider.js';

/**
 * Create an LLMService with the appropriate provider based on config and environment.
 * Auto-detect priority: ANTHROPIC_API_KEY → Ollama → OPENROUTER_API_KEY → null
 */
export async function createLLMService(
  config: AICurationConfig,
  anthropicKey?: string,
  openrouterKey?: string,
): Promise<LLMService> {
  if (!config.enabled) return new LLMService(null);

  const aKey = anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const oKey = openrouterKey ?? process.env.OPENROUTER_API_KEY ?? '';

  let provider: LLMProvider | null = null;

  if (config.provider && config.provider !== 'auto') {
    // Explicit provider selection
    switch (config.provider) {
      case 'claude':
        provider = aKey ? new ClaudeProvider(aKey, config.model) : null;
        break;
      case 'ollama':
        provider = new OllamaProvider(config.endpoint, config.model);
        if (!(await provider.isAvailable())) provider = null;
        break;
      case 'openrouter':
        provider = oKey ? new OpenRouterProvider(oKey, config.model) : null;
        break;
    }
  } else {
    // Auto-detect priority: Claude → Ollama → OpenRouter
    if (aKey) {
      provider = new ClaudeProvider(aKey, config.model);
    } else {
      const ollama = new OllamaProvider(config.endpoint, config.model);
      if (await ollama.isAvailable()) {
        provider = ollama;
      } else if (oKey) {
        provider = new OpenRouterProvider(oKey, config.model);
      }
    }
  }

  return new LLMService(provider);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/core/llm-factory.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/llm-factory.ts src/tests/core/llm-factory.test.ts
git commit -m "feat: LLM provider factory with auto-detect (Claude → Ollama → OpenRouter)"
```

---

## Phase 3: Integration Points

### Task 6: Search enhancement — query expansion

**Files:**
- Modify: `src/mcp-server/tools.ts` — add LLMService to ToolKernel, use in handleSearch
- Test: `src/tests/core/llm-integration.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/tests/core/llm-integration.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLMService } from '../../core/llm-provider.js';
import type { LLMProvider } from '../../core/llm-provider.js';

function mockProvider(): LLMProvider {
  return {
    name: 'mock',
    async isAvailable() { return true; },
    async complete(prompt: string) {
      if (prompt.includes('Expand this search query')) {
        const queryMatch = prompt.match(/Query: "(.+?)"/);
        const query = queryMatch?.[1] ?? '';
        return { expanded: [`${query}-expanded1`, `${query}-expanded2`], original: query };
      }
      if (prompt.includes('concise title')) return { title: 'LLM Generated Title' };
      if (prompt.includes('keyword tags')) return { tags: ['llm', 'generated'] };
      if (prompt.includes('contradict')) return { conflict: 'LLM conflict', merged_content: 'LLM merged' };
      if (prompt.includes('Summarize')) return { summary: 'LLM summary', key_terms: ['llm'] };
      return null;
    },
  };
}

describe('LLM integration — query expansion', () => {
  it('expandQuery returns expanded terms for search', async () => {
    const service = new LLMService(mockProvider());
    const result = await service.expandQuery('auth');
    assert.ok(result);
    assert.equal(result.original, 'auth');
    assert.ok(result.expanded.length >= 1);
    assert.ok(result.expanded[0].includes('auth'));
  });

  it('null provider returns null for all methods', async () => {
    const service = new LLMService(null);
    assert.equal(await service.expandQuery('auth'), null);
    assert.equal(await service.generateTitle('content'), null);
    assert.equal(await service.generateTags('content'), null);
    assert.equal(await service.explainContradiction('a', 'b'), null);
    assert.equal(await service.summarize('content'), null);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (this tests LLMService directly, no integration yet)

Run: `npm run build && node --test dist/tests/core/llm-integration.test.js`
Expected: PASS

- [ ] **Step 3: Add LLMService to ToolKernel**

In `src/mcp-server/tools.ts`, add to the `ToolKernel` interface:

```typescript
import type { LLMService } from '../core/llm-provider.js';

export interface ToolKernel {
  // ... existing fields
  llmService?: LLMService;
}
```

- [ ] **Step 4: Add query expansion to handleSearch**

In `src/mcp-server/tools.ts`, update `handleSearch()` to expand the query before search:

```typescript
export async function handleSearch(
  params: { query: string; type?: string; limit?: number },
  kernel: ToolKernel,
): Promise<Array<{ id: string; title: string; snippet: string; relevance_score: number; timestamp: number }>> {
  if (!params.query || typeof params.query !== 'string' || !params.query.trim()) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'query must be a non-empty string' }) }], isError: true } as any;
  }

  // LLM query expansion (optional)
  let searchQuery = params.query;
  if (kernel.llmService) {
    const expansion = await kernel.llmService.expandQuery(params.query);
    if (expansion) {
      searchQuery = [expansion.original, ...expansion.expanded].join(' ');
    }
  }

  const opts: { type_filter?: ObservationType[]; limit?: number } = {
    limit: validateLimit(params.limit ?? 5),
  };
  if (params.type) {
    opts.type_filter = [validateObservationType(params.type)];
  }

  const results: SearchResult[] = await kernel.search.execute(searchQuery, opts);
  // ... rest stays the same
```

- [ ] **Step 5: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS (llmService is optional on ToolKernel, so existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/tools.ts src/tests/core/llm-integration.test.ts
git commit -m "feat: LLM query expansion in search (optional enhancement)"
```

---

### Task 7: Knowledge curation — LLM title and tags

**Files:**
- Modify: `src/plugins/knowledge/knowledge-base.ts`

- [ ] **Step 1: Add LLMService to KnowledgeBase**

In `src/plugins/knowledge/knowledge-base.ts`, update the constructor and save method:

```typescript
import type { LLMService } from '../../core/llm-provider.js';

export class KnowledgeBase {
  private llmService?: LLMService;

  constructor(private storage: StoragePlugin, llmService?: LLMService) {
    this.llmService = llmService;
  }

  async save(entry: {
    category: KnowledgeCategory;
    title: string;
    content: string;
    tags?: string[];
    shareable?: boolean;
    source_type?: SourceType;
  }): Promise<KnowledgeEntry> {
    const now = Date.now();

    // Auto-generate title: try LLM first, then deterministic fallback
    if (!entry.title || entry.title.trim().length < 5) {
      if (this.llmService) {
        const llmTitle = await this.llmService.generateTitle(entry.content);
        if (llmTitle) entry.title = llmTitle;
      }
      if (!entry.title || entry.title.trim().length < 5) {
        entry.title = generateTitle(entry.content);
      }
    }

    // Auto-generate tags: try LLM first, then deterministic fallback
    if (!entry.tags || entry.tags.length === 0) {
      if (this.llmService) {
        const llmTags = await this.llmService.generateTags(entry.content);
        if (llmTags) entry.tags = llmTags;
      }
      if (!entry.tags || entry.tags.length === 0) {
        entry.tags = generateTags(entry.content);
      }
    }

    // ... rest of save() stays the same
```

Note: `save()` changes from sync to `async` — update the return type to `Promise<KnowledgeEntry>` and add `await` at all call sites.

- [ ] **Step 2: Add LLM contradiction explanation**

In `checkContradictions()`, after the authority scoring loop, add LLM explanation:

```typescript
    // After building the warning with authority scores:
    if (this.llmService) {
      const explanation = await this.llmService.explainContradiction(
        `${existingTitle}: ${existingContent}`,
        `${title}: ${content.slice(0, 200)}`
      );
      if (explanation) {
        // Add to warning object — these are optional fields
        (warning as any).explanation = explanation.conflict;
        (warning as any).suggested_merge = explanation.merged_content;
      }
    }
```

- [ ] **Step 3: Extend ContradictionWarning type**

In `src/core/types.ts`, add optional fields to `ContradictionWarning`:

```typescript
export interface ContradictionWarning {
  id: string;
  title: string;
  content: string;
  similarity_reason: string;
  source_type?: SourceType;
  authority_existing: number;
  authority_new: number;
  suggested_action: 'keep_existing' | 'replace' | 'merge';
  explanation?: string;         // LLM-generated conflict description
  suggested_merge?: string;     // LLM-suggested merged content
}
```

- [ ] **Step 4: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS. The `save()` method is now async but all existing callers should handle this (check for sync callers and update them).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/knowledge/knowledge-base.ts src/core/types.ts
git commit -m "feat: LLM-enhanced knowledge curation (title, tags, contradiction explanation)"
```

---

### Task 8: Smart summarization in pipeline

**Files:**
- Modify: `src/core/pipeline.ts`

- [ ] **Step 1: Add LLMService to Pipeline**

In `src/core/pipeline.ts`, add LLM service support:

```typescript
import type { LLMService } from './llm-provider.js';

export class Pipeline {
  private llmService?: LLMService;
  // ... existing fields

  setLLMService(llm: LLMService): void {
    this.llmService = llm;
  }
```

- [ ] **Step 2: Add LLM summarization before deterministic summarizers**

In the `observe()` method, before step 3 (Find summarizer), add LLM summarization:

```typescript
    // 2.5 LLM summarization (optional — try before deterministic)
    if (this.llmService && !summary) {
      const llmResult = await this.llmService.summarize(cleaned);
      if (llmResult) {
        summary = llmResult.summary;
        tokensSummarized = estimateTokens(summary);
      }
    }

    // 3. Find summarizer (deterministic fallback)
    if (!summary) {
      const summarizers = this.registry.getAll('summarizer') as SummarizerPlugin[];
      for (const s of summarizers) {
        // ... existing logic
```

- [ ] **Step 3: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS (llmService is optional, not set in existing tests)

- [ ] **Step 4: Commit**

```bash
git add src/core/pipeline.ts
git commit -m "feat: LLM smart summarization before deterministic summarizers"
```

---

## Phase 4: Wiring and Setup

### Task 9: Wire LLMService into server startup

**Files:**
- Modify: `src/mcp-server/server.ts` or wherever ToolKernel is created
- Modify: `src/cli/commands/init.ts` — setup wizard

- [ ] **Step 1: Find and update server initialization**

Search for where `ToolKernel` is assembled and add LLMService creation:

```typescript
import { createLLMService } from '../core/llm-factory.js';

// In server initialization, after config is loaded:
const llmService = await createLLMService(config.ai_curation ?? { enabled: false });

// Add to kernel:
const kernel: ToolKernel = {
  // ... existing fields
  llmService,
};

// Set on pipeline:
pipeline.setLLMService(llmService);

// Pass to KnowledgeBase constructor:
const knowledgeBase = new KnowledgeBase(storage, llmService);
```

- [ ] **Step 2: Add setup wizard to init command**

In `src/cli/commands/init.ts`, add LLM setup prompt after existing initialization. Use Node.js readline for interactive input:

```typescript
import readline from 'node:readline/promises';

// After existing init logic, before writing config:
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const mode = await rl.question('\n? Choose context-mem mode:\n  1. Free (deterministic only — zero token cost)\n  2. Enhanced (+ LLM features)\n  > ');

if (mode.trim() === '2') {
  const provider = await rl.question('\n? LLM provider:\n  1. Auto-detect (recommended)\n  2. Ollama (local, free)\n  3. OpenRouter\n  4. Claude API\n  > ');

  const providerMap: Record<string, string> = { '1': 'auto', '2': 'ollama', '3': 'openrouter', '4': 'claude' };
  const selectedProvider = providerMap[provider.trim()] || 'auto';

  // Write ai_curation config
  config.ai_curation = { enabled: true, provider: selectedProvider as any };
  console.log(`\n✓ LLM enabled with provider: ${selectedProvider}`);
} else {
  console.log('\n✓ Free mode — deterministic only');
}

rl.close();
```

- [ ] **Step 3: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/mcp-server/server.ts src/cli/commands/init.ts
git commit -m "feat: wire LLMService into server startup + setup wizard"
```

---

### Task 10: Full regression and integration test

**Files:**
- Test: `src/tests/core/llm-integration.test.ts` (extend)

- [ ] **Step 1: Add regression tests**

Add to `src/tests/core/llm-integration.test.ts`:

```typescript
describe('LLM integration — regression', () => {
  // Note: LLMProvider import already exists at top of this file from Task 6

  it('all domain methods return null with null provider', async () => {
    const service = new LLMService(null);
    assert.equal(await service.expandQuery('auth'), null);
    assert.equal(await service.generateTitle('content'), null);
    assert.equal(await service.generateTags('content'), null);
    assert.equal(await service.explainContradiction('a', 'b'), null);
    assert.equal(await service.summarize('content'), null);
  });

  it('invalid provider responses are rejected', async () => {
    const badProvider: LLMProvider = {
      name: 'bad',
      async isAvailable() { return true; },
      async complete() { return { wrong: 'schema' }; },
    };
    const service = new LLMService(badProvider);
    assert.equal(await service.generateTitle('content'), null);
    assert.equal(await service.generateTags('content'), null);
    assert.equal(await service.expandQuery('auth'), null);
  });

  it('provider that throws returns null', async () => {
    const throwProvider: LLMProvider = {
      name: 'throw',
      async isAvailable() { return true; },
      async complete() { throw new Error('crash'); },
    };
    const service = new LLMService(throwProvider);
    assert.equal(await service.generateTitle('content'), null);
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS, 0 failures

- [ ] **Step 3: Commit**

```bash
git add src/tests/core/llm-integration.test.ts
git commit -m "test: LLM integration regression tests — null provider, invalid responses, throws"
```
