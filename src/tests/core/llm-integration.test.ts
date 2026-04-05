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
