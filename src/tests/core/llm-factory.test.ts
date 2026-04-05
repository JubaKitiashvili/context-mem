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
    const service = await createLLMService({ enabled: true, provider: 'ollama', endpoint: 'http://localhost:99999' });
    const result = await service.expandQuery('test');
    assert.equal(result, null, 'unavailable provider should return null');
  });

  it('creates Claude provider when provider is "claude" with key', async () => {
    const service = await createLLMService({ enabled: true, provider: 'claude' }, 'fake-key');
    assert.ok(service, 'should create service with claude provider');
  });

  it('creates OpenRouter provider when provider is "openrouter" with key', async () => {
    const service = await createLLMService({ enabled: true, provider: 'openrouter' }, undefined, 'fake-key');
    assert.ok(service, 'should create service with openrouter provider');
  });
});
