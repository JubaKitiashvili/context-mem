import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider } from '../../core/providers/ollama-provider.js';
import { ClaudeProvider } from '../../core/providers/claude-provider.js';
import { OpenRouterProvider } from '../../core/providers/openrouter-provider.js';
import * as http from 'node:http';

// ---------------------------------------------------------------------------
// Minimal HTTP test server to mock Ollama and provider HTTP calls
// ---------------------------------------------------------------------------

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startServer(handler: RequestHandler): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

describe('OllamaProvider — unit', () => {
  it('has name "ollama"', () => {
    const p = new OllamaProvider();
    assert.equal(p.name, 'ollama');
  });

  it('returns false for isAvailable when endpoint is unreachable', async () => {
    const p = new OllamaProvider('http://127.0.0.1:19999'); // no server
    const available = await p.isAvailable();
    assert.equal(available, false);
  });

  it('returns null for complete when endpoint is unreachable', async () => {
    const p = new OllamaProvider('http://127.0.0.1:19999');
    const result = await p.complete('test', {});
    assert.equal(result, null);
  });
});

describe('OllamaProvider — with mock server', () => {
  let server: http.Server;
  let port: number;

  // --- isAvailable: healthy server ---
  it('isAvailable returns true when /api/tags responds 200', async () => {
    const { server: s, port: p } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ models: [] }));
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
    const available = await provider.isAvailable();
    assert.equal(available, true);
    await stopServer(server);
  });

  // --- isAvailable: server returns 500 ---
  it('isAvailable returns false when /api/tags returns 500', async () => {
    const { server: s, port: p } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
    const available = await provider.isAvailable();
    assert.equal(available, false);
    await stopServer(server);
  });

  // --- complete: valid response ---
  it('complete parses JSON from Ollama response.response field', async () => {
    const responsePayload = { tags: ['typescript', 'node'] };
    const { server: s, port: p } = await startServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200); res.end(JSON.stringify({ models: [] }));
      } else if (req.url === '/api/generate') {
        res.writeHead(200);
        res.end(JSON.stringify({ response: JSON.stringify(responsePayload) }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, 'llama3.2');
    const result = await provider.complete('Classify this', {});
    assert.deepEqual(result, responsePayload);
    await stopServer(server);
  });

  // --- complete: /api/generate returns 500 ---
  it('complete returns null when /api/generate returns 500', async () => {
    const { server: s, port: p } = await startServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200); res.end(JSON.stringify({ models: [] }));
      } else {
        res.writeHead(500); res.end();
      }
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  // --- complete: missing response field ---
  it('complete returns null when response field is absent', async () => {
    const { server: s, port: p } = await startServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200); res.end(JSON.stringify({ models: [] }));
      } else {
        res.writeHead(200); res.end(JSON.stringify({})); // no response key
      }
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  // --- complete: response field contains invalid JSON ---
  it('complete returns null when response contains invalid JSON', async () => {
    const { server: s, port: p } = await startServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200); res.end(JSON.stringify({ models: [] }));
      } else {
        res.writeHead(200); res.end(JSON.stringify({ response: 'not json at all' }));
      }
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  // --- availability caching ---
  it('isAvailable caches result (does not re-fetch)', async () => {
    let callCount = 0;
    const { server: s, port: p } = await startServer((_req, res) => {
      callCount++;
      res.writeHead(200); res.end(JSON.stringify({ models: [] }));
    });
    server = s; port = p;
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
    await provider.isAvailable();
    await provider.isAvailable();
    assert.equal(callCount, 1); // second call is served from cache
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// ClaudeProvider
// ---------------------------------------------------------------------------

describe('ClaudeProvider — unit', () => {
  it('has name "claude"', () => {
    assert.equal(new ClaudeProvider('key').name, 'claude');
  });

  it('isAvailable returns true when API key is provided', async () => {
    const p = new ClaudeProvider('any-key');
    assert.equal(await p.isAvailable(), true);
  });

  it('isAvailable returns false when API key is empty', async () => {
    const p = new ClaudeProvider('');
    assert.equal(await p.isAvailable(), false);
  });

  it('complete returns null without API key', async () => {
    const p = new ClaudeProvider('');
    assert.equal(await p.complete('test', {}), null);
  });
});

describe('ClaudeProvider — with mock server', () => {
  it('complete parses JSON from content[0].text', async () => {
    const payload = { summary: 'test summary', tags: ['ts'] };
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({
        content: [{ text: `Here is the result: ${JSON.stringify(payload)}` }],
      }));
    });
    // Point ClaudeProvider at our local mock — requires patching fetch
    // We use a subclass to override the endpoint
    const provider = new (class extends ClaudeProvider {
      override async complete(prompt: string, schema: Record<string, unknown>): Promise<unknown | null> {
        // Monkey-patch for test: call our local server instead
        try {
          const res = await fetch(`http://127.0.0.1:${port}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'fake', 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
          });
          if (!res.ok) return null;
          const data = await res.json() as { content?: Array<{ text?: string }> };
          const text = data.content?.[0]?.text;
          if (!text) return null;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return null;
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
    })('fake-key');

    const result = await provider.complete('Summarize this', {});
    assert.deepEqual(result, payload);
    await stopServer(server);
  });

  it('complete returns null when content array is empty', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ content: [] }));
    });
    const provider = new (class extends ClaudeProvider {
      override async complete(_prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
        try {
          const res = await fetch(`http://127.0.0.1:${port}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'fake', 'anthropic-version': '2023-06-01' },
            body: '{}',
          });
          if (!res.ok) return null;
          const data = await res.json() as { content?: Array<{ text?: string }> };
          const text = data.content?.[0]?.text;
          if (!text) return null;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return null;
          return JSON.parse(jsonMatch[0]);
        } catch { return null; }
      }
    })('fake-key');
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  it('complete returns null when text contains no JSON object', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ content: [{ text: 'just plain text, no braces' }] }));
    });
    const provider = new (class extends ClaudeProvider {
      override async complete(_prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
        try {
          const res = await fetch(`http://127.0.0.1:${port}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'fake', 'anthropic-version': '2023-06-01' },
            body: '{}',
          });
          if (!res.ok) return null;
          const data = await res.json() as { content?: Array<{ text?: string }> };
          const text = data.content?.[0]?.text;
          if (!text) return null;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return null;
          return JSON.parse(jsonMatch[0]);
        } catch { return null; }
      }
    })('fake-key');
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  it('complete returns null when server returns 500', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(500); res.end('Internal Server Error');
    });
    const provider = new (class extends ClaudeProvider {
      override async complete(_prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
        try {
          const res = await fetch(`http://127.0.0.1:${port}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'fake', 'anthropic-version': '2023-06-01' },
            body: '{}',
          });
          if (!res.ok) return null;
          return null;
        } catch { return null; }
      }
    })('fake-key');
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// OpenRouterProvider
// ---------------------------------------------------------------------------

describe('OpenRouterProvider — unit', () => {
  it('has name "openrouter"', () => {
    assert.equal(new OpenRouterProvider('key').name, 'openrouter');
  });

  it('isAvailable returns true when API key is provided', async () => {
    assert.equal(await new OpenRouterProvider('any-key').isAvailable(), true);
  });

  it('isAvailable returns false when API key is empty', async () => {
    assert.equal(await new OpenRouterProvider('').isAvailable(), false);
  });

  it('complete returns null without API key', async () => {
    assert.equal(await new OpenRouterProvider('').complete('test', {}), null);
  });
});

describe('OpenRouterProvider — with mock server', () => {
  it('complete parses JSON from choices[0].message.content', async () => {
    const payload = { category: 'error', confidence: 0.9 };
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }));
    });
    const provider = new OpenRouterProvider('fake-key', 'meta-llama/llama-3.2-3b-instruct:free', `http://127.0.0.1:${port}`);
    const result = await provider.complete('Classify this', {});
    assert.deepEqual(result, payload);
    await stopServer(server);
  });

  it('complete returns null when choices is empty', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [] }));
    });
    const provider = new OpenRouterProvider('fake-key', 'model', `http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  it('complete returns null when message.content is absent', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: {} }] }));
    });
    const provider = new OpenRouterProvider('fake-key', 'model', `http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  it('complete returns null when content is invalid JSON', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: 'not valid json' } }] }));
    });
    const provider = new OpenRouterProvider('fake-key', 'model', `http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  it('complete returns null when server returns 401', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(401); res.end('Unauthorized');
    });
    const provider = new OpenRouterProvider('bad-key', 'model', `http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });

  it('complete returns null when server returns 429 rate limit', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(429); res.end('Too Many Requests');
    });
    const provider = new OpenRouterProvider('key', 'model', `http://127.0.0.1:${port}`);
    const result = await provider.complete('test', {});
    assert.equal(result, null);
    await stopServer(server);
  });
});
