import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface StreamEvent {
  type: string;
  data: unknown;
}

/**
 * ObservationStream — WebSocket server for real-time dashboard push.
 *
 * Attaches to an existing http.Server on path '/ws'.
 * Broadcasts typed events (observation:new, stats:update, etc.) to all
 * connected clients. Heartbeat ping/pong every 30s per RFC 6455.
 */
export class ObservationStream {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    // Heartbeat every 30s (RFC 6455) — unref so it doesn't keep the process alive
    this.heartbeatInterval = setInterval(() => this.ping(), 30_000);
    this.heartbeatInterval.unref();
  }

  /**
   * Broadcast an event to all connected clients with open sockets.
   */
  broadcast(event: StreamEvent): void {
    if (this.clients.size === 0) return;
    const msg = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(msg);
        } catch {
          // Ignore send errors on individual clients
        }
      }
    }
  }

  /**
   * Gracefully stop the WebSocket server, clear heartbeat, close all clients.
   */
  stop(): void {
    clearInterval(this.heartbeatInterval);
    for (const ws of this.clients) {
      try { ws.close(1000, 'server stopping'); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.wss.close();
  }

  /** Number of connected clients (useful for diagnostics). */
  get clientCount(): number {
    return this.clients.size;
  }

  // --- private ---

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);

    // Mark alive for heartbeat tracking
    (ws as WebSocket & { isAlive: boolean }).isAlive = true;

    ws.on('pong', () => {
      (ws as WebSocket & { isAlive: boolean }).isAlive = true;
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
      try { ws.close(); } catch { /* ignore */ }
    });
  }

  private ping(): void {
    for (const ws of this.clients) {
      const tagged = ws as WebSocket & { isAlive: boolean };
      if (!tagged.isAlive) {
        // Missed last pong — terminate
        this.clients.delete(ws);
        try { ws.terminate(); } catch { /* ignore */ }
        continue;
      }
      tagged.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }
}
