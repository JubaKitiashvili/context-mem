'use strict';

/**
 * context-mem dashboard — main() orchestration
 * DB open, HTTP server setup, WS attach, graceful shutdown.
 */

const http_mod = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// WebSocket is optional — dashboard works with HTTP polling alone
let WebSocketServer;
try { WebSocketServer = require('ws').WebSocketServer; } catch {}

const { createHTTPServer, sseClients } = require('./http.js');
const q = require('./queries.js');

// --- Instance registry (multi-project support) ---
const INSTANCES_DIR = path.join(os.homedir(), '.context-mem', 'instances');

function getRegisteredInstances() {
  if (!fs.existsSync(INSTANCES_DIR)) return [];
  const instances = [];
  for (const file of fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, file), 'utf8'));
      // DB must exist to show in dashboard
      if (!fs.existsSync(info.dbPath)) {
        try { fs.unlinkSync(path.join(INSTANCES_DIR, file)); } catch {}
        continue;
      }
      // Check if process is still alive — mark status but don't delete
      let active = false;
      try { process.kill(info.pid, 0); active = true; } catch {}
      info.active = active;
      instances.push(info);
    } catch {}
  }
  return instances.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// --- Resolve DB path ---
function findDb(DB_PATH, MULTI_MODE, PROJECT_DIR) {
  if (DB_PATH && fs.existsSync(DB_PATH)) return DB_PATH;

  // In multi mode, use first registered instance
  if (MULTI_MODE) {
    const instances = getRegisteredInstances();
    if (instances.length > 0) return instances[0].dbPath;
  }

  // Try standard locations
  const candidates = [
    path.join(PROJECT_DIR, '.context-mem', 'store.db'),
    path.join(process.cwd(), '.context-mem', 'store.db'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  // --- CLI args ---
  const args = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const PORT = parseInt(process.env.CONTEXT_MEM_DASHBOARD_PORT || getArg('--port', '51893'), 10);
  const DB_PATH = process.env.CONTEXT_MEM_DB || getArg('--db', '');
  const PROJECT_DIR = process.env.CONTEXT_MEM_PROJECT || getArg('--project', process.cwd());
  const NO_OPEN = args.includes('--no-open');
  const MULTI_MODE = args.includes('--multi');

  const dbPath = findDb(DB_PATH, MULTI_MODE, PROJECT_DIR);
  if (!dbPath) {
    console.error('context-mem dashboard: No database found.');
    console.error('Run `context-mem init` in your project first.');
    process.exit(1);
  }

  // --- Open SQLite (read-only) ---
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    // Try from context-mem's own node_modules
    const cmPath = path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3');
    if (fs.existsSync(cmPath)) {
      Database = require(cmPath);
    } else {
      console.error('context-mem dashboard: better-sqlite3 not found. Run: npm install better-sqlite3');
      process.exit(1);
    }
  }

  let db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');

  console.error(`context-mem dashboard: Reading from ${dbPath}`);

  /** Switch active DB to a different project */
  function switchProject(newDbPath) {
    try {
      const newDb = new Database(newDbPath, { readonly: true });
      newDb.pragma('journal_mode = WAL');
      db.close();
      db = newDb;
      state.db = db;
      return true;
    } catch {
      return false;
    }
  }

  // Shared mutable state object — passed to all modules so they always
  // read the live db/currentProject references.
  const state = {
    db,
    dbPath,
    currentProject: PROJECT_DIR,
    PROJECT_DIR,
    PORT,
    path,
    fs,
    os,
    Database,
    getRegisteredInstances,
    switchProject,
  };

  // --- HTTP Server + SSE ---
  const { server, sseHeartbeatInterval, sseStatsPushInterval } = createHTTPServer(state);

  // --- WebSocket for real-time push (optional, requires 'ws' package) ---
  // Uses ObservationStream-compatible protocol: { type: string, data: unknown }
  // Event types: 'observation:new', 'stats:update'
  let wsClients = new Set();
  let wsHeartbeatInterval = null;

  if (WebSocketServer) {
    try {
      const wss = new WebSocketServer({ server, path: '/ws' });

      wss.on('connection', (ws) => {
        wsClients.add(ws);
        // Send initial stats on connect
        try { ws.send(JSON.stringify({ type: 'stats:update', data: q.getStats(state) })); } catch {}

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('close', () => { wsClients.delete(ws); });
        ws.on('error', () => {
          wsClients.delete(ws);
          try { ws.close(); } catch {}
        });
      });

      // Heartbeat ping/pong every 30s (RFC 6455)
      wsHeartbeatInterval = setInterval(() => {
        for (const ws of wsClients) {
          if (!ws.isAlive) {
            wsClients.delete(ws);
            try { ws.terminate(); } catch {}
            continue;
          }
          ws.isAlive = false;
          try { ws.ping(); } catch {}
        }
      }, 30000);
      wsHeartbeatInterval.unref();

      // Broadcast stats every 3s to connected WS clients
      const statsPushInterval = setInterval(() => {
        if (wsClients.size === 0) return;
        try {
          const data = JSON.stringify({ type: 'stats:update', data: q.getStats(state) });
          for (const ws of wsClients) {
            if (ws.readyState === 1) ws.send(data);
          }
        } catch {}
      }, 3000);
      statsPushInterval.unref();
    } catch {}
  }

  // --- Start ---
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.error(`context-mem dashboard: ${url}`);
    console.error(`context-mem dashboard: Database ${dbPath}`);

    // Auto-open in browser (unless --no-open)
    if (!NO_OPEN) {
      try {
        const { spawn: spawnProc } = require('child_process');
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        spawnProc(opener, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
      } catch {}
    }
  });

  // Graceful shutdown
  function shutdown() {
    if (wsHeartbeatInterval) clearInterval(wsHeartbeatInterval);
    for (const ws of wsClients) { try { ws.close(1000, 'server stopping'); } catch {} }
    wsClients.clear();
    clearInterval(sseHeartbeatInterval);
    clearInterval(sseStatsPushInterval);
    for (const res of sseClients) { try { res.end(); } catch {} }
    sseClients.clear();
    db.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { main };
