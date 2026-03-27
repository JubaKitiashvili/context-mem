#!/usr/bin/env node
'use strict';

/**
 * context-mem dashboard stop hook
 *
 * Fires on Stop — gracefully shuts down the dashboard server.
 *
 * Hook type: Stop
 */

const path = require('path');
const fs = require('fs');

const PROJECT_DIR = process.cwd();
const PID_FILE = path.join(PROJECT_DIR, '.context-mem', 'dashboard.pid');

if (!fs.existsSync(PID_FILE)) process.exit(0);

const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
if (!pid) {
  fs.unlinkSync(PID_FILE);
  process.exit(0);
}

try {
  if (process.platform === 'win32') {
    try {
      require('child_process').execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } catch {}
  } else {
    process.kill(pid, 'SIGTERM');
  }
  fs.unlinkSync(PID_FILE);
} catch {
  // Process already dead
  try { fs.unlinkSync(PID_FILE); } catch {}
}
