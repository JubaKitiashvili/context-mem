#!/usr/bin/env node
'use strict';

/**
 * context-mem dashboard auto-start hook
 *
 * Fires on SessionStart — starts the dashboard server as a background process
 * if it's not already running.
 *
 * Hook type: SessionStart
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const PORT = parseInt(process.env.CONTEXT_MEM_DASHBOARD_PORT || '51893', 10);
const PROJECT_DIR = process.cwd();
const DB_PATH = path.join(PROJECT_DIR, '.context-mem', 'store.db');
const PID_FILE = path.join(PROJECT_DIR, '.context-mem', 'dashboard.pid');
const SERVER_SCRIPT = path.join(__dirname, '..', 'dashboard', 'server.js');

// Skip if server script missing
if (!fs.existsSync(SERVER_SCRIPT)) process.exit(0);

// Check if already running via PID file
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Check if port is in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(300, () => { s.destroy(); resolve(false); });
  });
}

async function main() {
  // Check PID file
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid && isRunning(pid)) {
      // Already running
      process.exit(0);
    }
    // Stale PID file
    fs.unlinkSync(PID_FILE);
  }

  // Check if port is already in use (maybe started manually)
  if (await isPortInUse(PORT)) {
    process.exit(0);
  }

  // Start dashboard in background
  const child = spawn('node', [
    SERVER_SCRIPT,
    '--port', String(PORT),
    '--db', DB_PATH,
    '--project', PROJECT_DIR,
    '--no-open', // Don't auto-open browser on hook start
  ], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();

  // Write PID
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, String(child.pid));

  // Output for hook feedback
  console.log(JSON.stringify({
    result: `Dashboard started on port ${PORT} (pid: ${child.pid})`
  }));
}

main().catch(() => process.exit(0));
