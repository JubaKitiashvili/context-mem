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
