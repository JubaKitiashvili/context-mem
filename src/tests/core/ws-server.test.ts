import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ObservationStream } from '../../core/ws-server.js';

// Dynamic import for ws — same package the server uses
let WebSocket: any;

describe('ObservationStream', () => {
  let server: http.Server;
  let stream: ObservationStream;
  let port: number;

  before(async () => {
    const ws = await import('ws');
    WebSocket = ws.default;

    server = http.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as { port: number }).port;
    stream = new ObservationStream(server);
  });

  after(async () => {
    stream.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('can be created and stopped without error', () => {
    // The fact that before() succeeded proves creation works.
    // Verify clientCount starts at 0.
    assert.equal(stream.clientCount, 0);
  });

  it('broadcast sends to connected clients', async () => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      client.on('open', () => resolve());
      client.on('error', reject);
      setTimeout(() => reject(new Error('connection timeout')), 3000);
    });

    client.on('message', (data: any) => {
      received.push(data.toString());
    });

    // Give the server a tick to register the client
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(stream.clientCount, 1);

    stream.broadcast({ type: 'observation:new', data: { id: 'test-1', type: 'shell_command' } });
    stream.broadcast({ type: 'stats:update', data: { observations: 42 } });

    // Wait for messages to arrive
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(received.length, 2);

    const msg1 = JSON.parse(received[0]);
    assert.equal(msg1.type, 'observation:new');
    assert.equal(msg1.data.id, 'test-1');

    const msg2 = JSON.parse(received[1]);
    assert.equal(msg2.type, 'stats:update');
    assert.equal(msg2.data.observations, 42);

    client.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('stop() cleans up interval and closes server', async () => {
    // Create a second ObservationStream on a separate server to test stop()
    const server2 = http.createServer();
    await new Promise<void>((resolve) => {
      server2.listen(0, '127.0.0.1', () => resolve());
    });
    const port2 = (server2.address() as { port: number }).port;
    const stream2 = new ObservationStream(server2);

    // Connect a client
    const client = new WebSocket(`ws://127.0.0.1:${port2}/ws`);
    await new Promise<void>((resolve, reject) => {
      client.on('open', () => resolve());
      client.on('error', reject);
      setTimeout(() => reject(new Error('connection timeout')), 3000);
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stream2.clientCount, 1);

    // Stop should close all clients and clean up
    stream2.stop();
    assert.equal(stream2.clientCount, 0);

    // Broadcast after stop should not throw
    stream2.broadcast({ type: 'test', data: null });

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });
});
