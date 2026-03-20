import http from 'node:http';
import net from 'node:net';
import type { Kernel } from './kernel.js';
import { ObserveQueue, type QueueItem } from './observe-queue.js';
import { OBSERVATION_TYPES, type ObservationType } from './types.js';

const MAX_BODY_SIZE = 512 * 1024; // 512KB

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(300, () => { s.destroy(); resolve(false); });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, data: object): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

export async function startHttpBridge(kernel: Kernel, port: number): Promise<http.Server | null> {
  if (await isPortInUse(port)) {
    console.error(`context-mem: API port ${port} already in use, skipping HTTP bridge`);
    return null;
  }

  const queue = new ObserveQueue(async (items: QueueItem[]) => {
    for (const item of items) {
      try {
        await kernel.observe(item.content, item.type, item.source, item.filePath);
      } catch {
        // Individual observation failures shouldn't crash the bridge
      }
    }
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/observe') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);

        if (!data.content || typeof data.content !== 'string') {
          json(res, 400, { ok: false, error: 'Missing or invalid "content" field' });
          return;
        }
        if (!data.type || !OBSERVATION_TYPES.includes(data.type as ObservationType)) {
          json(res, 400, { ok: false, error: `Invalid "type" — must be one of: ${OBSERVATION_TYPES.join(', ')}` });
          return;
        }

        const enqueued = await queue.enqueue({
          content: data.content,
          type: data.type as ObservationType,
          source: data.source || 'http-bridge',
          filePath: data.filePath,
        });

        // Flush immediately for single observations (hook fire-and-forget pattern)
        if (enqueued) await queue.flush();

        json(res, 200, { ok: true, enqueued });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bad request';
        json(res, 400, { ok: false, error: msg });
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      json(res, 200, { ok: true, pid: process.pid, uptime: process.uptime() });
      return;
    }

    json(res, 404, { ok: false, error: 'Not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      console.error(`context-mem: HTTP bridge listening on http://127.0.0.1:${addr.port}`);
      resolve(server);
    });
    server.on('error', (err) => {
      console.error(`context-mem: HTTP bridge failed to start — ${err.message}`);
      resolve(null);
    });
  });
}
