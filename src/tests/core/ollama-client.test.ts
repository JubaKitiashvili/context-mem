import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaClient } from '../../core/ollama-client.js';

describe('OllamaClient', () => {
  it('returns false for isAvailable when server is not running', async () => {
    const client = new OllamaClient('http://localhost:99999');
    const available = await client.isAvailable();
    assert.equal(available, false);
  });

  it('returns null for generateTitle when unavailable', async () => {
    const client = new OllamaClient('http://localhost:99999');
    const title = await client.generateTitle('Test content');
    assert.equal(title, null);
  });

  it('returns null for generateTags when unavailable', async () => {
    const client = new OllamaClient('http://localhost:99999');
    const tags = await client.generateTags('Test content');
    assert.equal(tags, null);
  });

  it('returns null for suggestMerge when unavailable', async () => {
    const client = new OllamaClient('http://localhost:99999');
    const merged = await client.suggestMerge('Entry A', 'Entry B');
    assert.equal(merged, null);
  });
});
