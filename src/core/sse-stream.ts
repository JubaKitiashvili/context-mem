import http from 'node:http';

export interface StreamEvent {
  type: string;
  data: unknown;
}

/**
 * SSEStream — Server-Sent Events endpoint for real-time dashboard push.
 *
 * Lightweight alternative to ObservationStream (WebSocket). Attaches to an
 * existing http.Server by handling requests to '/sse'. Broadcasts typed
 * events (observation:new, stats:update, etc.) to all connected clients.
 * Heartbeat comment every 30s to keep connections alive.
 */
export class SSEStream {
  private clients: Set<http.ServerResponse> = new Set();
  private heartbeatInterval: NodeJS.Timeout;

  private static readonly MAX_CLIENTS = 50;

  constructor() {
    // Heartbeat every 30s — SSE comment to keep connection alive, unref so it
    // doesn't prevent process exit.
    this.heartbeatInterval = setInterval(() => this.heartbeat(), 30_000);
    this.heartbeatInterval.unref();
  }

  /**
   * Handle an incoming HTTP request. Returns true if the request was handled
   * (i.e. it was a GET to /sse), false otherwise so the caller can route it
   * elsewhere.
   */
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (req.method !== 'GET' || req.url !== '/sse') return false;

    if (this.clients.size >= SSEStream.MAX_CLIENTS) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Too many clients');
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });

    // Flush headers immediately
    res.flushHeaders();

    this.clients.add(res);

    // Clean up on client disconnect
    req.on('close', () => {
      this.clients.delete(res);
    });

    return true;
  }

  /**
   * Broadcast an event to all connected SSE clients.
   * Format: `event: <type>\ndata: <json>\n\n`
   */
  broadcast(event: StreamEvent): void {
    if (this.clients.size === 0) return;
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        // Ignore write errors on individual clients
      }
    }
  }

  /**
   * Gracefully stop — clear heartbeat, end all client connections.
   */
  stop(): void {
    clearInterval(this.heartbeatInterval);
    for (const res of this.clients) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  /** Number of connected clients (useful for diagnostics). */
  get clientCount(): number {
    return this.clients.size;
  }

  // --- private ---

  private heartbeat(): void {
    for (const res of this.clients) {
      try {
        // SSE comment line — keeps connection alive without triggering events
        res.write(': heartbeat\n\n');
      } catch {
        this.clients.delete(res);
        try { res.end(); } catch { /* ignore */ }
      }
    }
  }
}
