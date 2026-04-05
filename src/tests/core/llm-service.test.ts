import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLMService } from '../../core/llm-provider.js';
import type { LLMProvider } from '../../core/llm-provider.js';

function mockProvider(responses: Record<string, unknown>): LLMProvider {
  return {
    name: 'mock',
    async isAvailable() { return true; },
    async complete(prompt: string) {
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
