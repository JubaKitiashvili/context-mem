#!/usr/bin/env node
'use strict';

/**
 * context-mem dashboard auto-start hook
 *
 * Fires on SessionStart:
 * 1. Registers this project in the global instance registry (~/.context-mem/instances/)
 * 2. Starts a central dashboard if not already running (shared across projects)
 * 3. Shows the dashboard URL to the user via stderr
 *
 * Multiple projects share ONE dashboard on the same port.
 * The dashboard reads the instance registry to show all active projects.
 *
 * Hook type: SessionStart
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const net = require('net');

const PORT = parseInt(process.env.CONTEXT_MEM_DASHBOARD_PORT || '51893', 10);
const PROJECT_DIR = process.cwd();
const DB_PATH = path.join(PROJECT_DIR, '.context-mem', 'store.db');
const SERVER_SCRIPT = path.join(__dirname, '..', 'dashboard', 'server.js');

// Central state — shared across all projects
const STATE_DIR = path.join(os.homedir(), '.context-mem');
const INSTANCES_DIR = path.join(STATE_DIR, 'instances');
const CENTRAL_PID_FILE = path.join(STATE_DIR, 'dashboard.pid');

// Skip if server script or DB missing
if (!fs.existsSync(SERVER_SCRIPT)) process.exit(0);
if (!fs.existsSync(DB_PATH)) process.exit(0);

// --- Instance registry (register this project) ---
function registerInstance() {
  try {
    fs.mkdirSync(INSTANCES_DIR, { recursive: true });
    const hash = crypto.createHash('sha256').update(PROJECT_DIR).digest('hex').slice(0, 12);
    const info = {
      projectDir: PROJECT_DIR,
      projectName: path.basename(PROJECT_DIR),
      dbPath: DB_PATH,
      pid: process.ppid || process.pid,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(INSTANCES_DIR, `${hash}.json`), JSON.stringify(info, null, 2) + '\n');
  } catch {}
}

// --- Process helpers ---
function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(300, () => { s.destroy(); resolve(false); });
  });
}

async function main() {
  // Step 1: Always register this project in the instance registry
  registerInstance();

  // Step 2: Check if central dashboard is already running
  if (fs.existsSync(CENTRAL_PID_FILE)) {
    const pid = parseInt(fs.readFileSync(CENTRAL_PID_FILE, 'utf8').trim(), 10);
    if (pid && isRunning(pid)) {
      // Dashboard already running — just show URL
      process.stderr.write(`Dashboard: http://localhost:${PORT}\n`);
      process.exit(0);
    }
    // Stale PID
    try { fs.unlinkSync(CENTRAL_PID_FILE); } catch {}
  }

  // Check if port is in use (maybe started manually or by another tool)
  if (await isPortInUse(PORT)) {
    process.stderr.write(`Dashboard: http://localhost:${PORT}\n`);
    process.exit(0);
  }

  // Step 3: Start central dashboard
  const lockFile = CENTRAL_PID_FILE + '.lock';
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  } catch {
    // Another process is starting the dashboard
    process.stderr.write(`Dashboard: http://localhost:${PORT}\n`);
    process.exit(0);
  }

  const child = spawn('node', [
    SERVER_SCRIPT,
    '--port', String(PORT),
    '--db', DB_PATH,
    '--project', PROJECT_DIR,
    '--no-open',
  ], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();

  // Write central PID
  fs.writeFileSync(CENTRAL_PID_FILE, String(child.pid));
  try { fs.unlinkSync(lockFile); } catch {}

  process.stderr.write(`Dashboard: http://localhost:${PORT}\n`);
}

main().catch(() => {
  try { fs.unlinkSync(CENTRAL_PID_FILE + '.lock'); } catch {}
  process.exit(0);
});
