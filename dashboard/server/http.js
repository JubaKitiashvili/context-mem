'use strict';

const http = require('http');
const { handleApi } = require('./api.js');
const {
  getDashboardHtml,
  getGraphPageHtml,
  getTimelinePageHtml,
  getTopicsPageHtml,
  getTrailPageHtml,
  getNarrativePageHtml,
  getDiagnosticsPageHtml,
  getCompressionAnalyticsHtml,
} = require('./html-templates.js');
const q = require('./queries.js');

// --- SSE for real-time push (lightweight alternative to WebSocket) ---
// Uses ObservationStream-compatible protocol: { type: string, data: unknown }
// Event types: 'observation:new', 'stats:update'
const sseClients = new Set();

function sseHandleRequest(req, res, state) {
  if (req.method !== 'GET' || req.url !== '/sse') return false;

  if (sseClients.size >= 50) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Too many clients');
    return true;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  sseClients.add(res);

  // Send initial stats
  try {
    const payload = `event: stats:update\ndata: ${JSON.stringify(q.getStats(state))}\n\n`;
    res.write(payload);
  } catch {}

  req.on('close', () => {
    sseClients.delete(res);
  });

  return true;
}

function sseBroadcast(event) {
  if (sseClients.size === 0) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

function createHTTPServer(state) {
  // SSE heartbeat — comment line every 30s to keep connections alive
  const sseHeartbeatInterval = setInterval(() => {
    for (const res of sseClients) {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        sseClients.delete(res);
        try { res.end(); } catch {}
      }
    }
  }, 30000);
  sseHeartbeatInterval.unref();

  // SSE stats push every 3s (same cadence as WebSocket)
  const sseStatsPushInterval = setInterval(() => {
    if (sseClients.size === 0) return;
    sseBroadcast({ type: 'stats:update', data: q.getStats(state) });
  }, 3000);
  sseStatsPushInterval.unref();

  // --- HTTP Server ---
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      return handleApi(req, res, state);
    }
    // SSE endpoint
    if (sseHandleRequest(req, res, state)) return;

    // Page routing
    const pagePath = req.url.split('?')[0];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (pagePath === '/graph') {
      res.end(getGraphPageHtml());
    } else if (pagePath === '/timeline') {
      res.end(getTimelinePageHtml());
    } else if (pagePath === '/topics') {
      res.end(getTopicsPageHtml());
    } else if (pagePath === '/trail') {
      res.end(getTrailPageHtml());
    } else if (pagePath === '/narrative') {
      res.end(getNarrativePageHtml());
    } else if (pagePath === '/diagnostics') {
      res.end(getDiagnosticsPageHtml());
    } else if (pagePath === '/compression') {
      res.end(getCompressionAnalyticsHtml());
    } else {
      res.end(getDashboardHtml());
    }
  });

  return { server, sseClients, sseHeartbeatInterval, sseStatsPushInterval };
}

module.exports = { createHTTPServer, sseClients, sseBroadcast };
