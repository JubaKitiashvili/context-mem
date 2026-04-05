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
