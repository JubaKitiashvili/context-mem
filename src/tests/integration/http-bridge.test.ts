import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type net from 'node:net';
import { Kernel } from '../../core/kernel.js';
import { startHttpBridge } from '../../core/http-bridge.js';

function post(port: number, path: string, body: object): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode!, data: { raw: data } }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(port: number, urlPath: string): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode!, data: { raw: data } }); }
      });
    }).on('error', reject);
  });
}

describe('HTTP Bridge Integration', () => {
  let kernel: Kernel;
  let server: http.Server | null;
  let tmpDir: string;
  let bridgePort: number;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    if (kernel) await kernel.stop();
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  });

  async function setup(): Promise<void> {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-bridge-'));
    kernel = new Kernel(tmpDir);
    await kernel.start();
    server = await startHttpBridge(kernel, 0); // port 0 = random available port
    assert.ok(server, 'Bridge should start');
    bridgePort = (server!.address() as net.AddressInfo).port;
  }

  it('POST /api/observe stores observation via kernel pipeline', async () => {
    await setup();
    const res = await post(bridgePort, '/api/observe', {
      content: 'function hello() { return "world"; } // some test code for the bridge',
      type: 'code',
      source: 'test-bridge',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.enqueued, true);
  });

  it('POST /api/observe deduplicates identical content', async () => {
    await setup();
    const body = {
      content: 'duplicate content for dedup testing in http bridge integration test',
      type: 'log',
      source: 'test-bridge',
    };
    const res1 = await post(bridgePort, '/api/observe', body);
    assert.equal(res1.status, 200);
    assert.equal(res1.data.enqueued, true);

    const res2 = await post(bridgePort, '/api/observe', body);
    assert.equal(res2.status, 200);
    assert.equal(res2.data.enqueued, false); // Duplicate rejected
  });

  it('POST /api/observe returns 400 for missing content', async () => {
    await setup();
    const res = await post(bridgePort, '/api/observe', { type: 'log', source: 'test' });
    assert.equal(res.status, 400);
    assert.equal(res.data.ok, false);
  });

  it('POST /api/observe returns 400 for invalid type', async () => {
    await setup();
    const res = await post(bridgePort, '/api/observe', {
      content: 'some content here for validation test',
      type: 'invalid_type',
      source: 'test',
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.ok, false);
  });

  it('GET /api/health returns 200 with pid and uptime', async () => {
    await setup();
    const res = await get(bridgePort, '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(typeof res.data.pid, 'number');
    assert.equal(typeof res.data.uptime, 'number');
  });

  it('GET unknown route returns 404', async () => {
    await setup();
    const res = await get(bridgePort, '/api/unknown');
    assert.equal(res.status, 404);
    assert.equal(res.data.ok, false);
  });
});
