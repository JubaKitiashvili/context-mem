#!/usr/bin/env node
'use strict';

/**
 * context-mem dashboard stop hook
 *
 * Fires on Stop:
 * 1. Deregisters this project from the instance registry
 * 2. If no other projects are active, shuts down the central dashboard
 *
 * Hook type: Stop
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const PROJECT_DIR = process.cwd();
const STATE_DIR = path.join(os.homedir(), '.context-mem');
const INSTANCES_DIR = path.join(STATE_DIR, 'instances');
const CENTRAL_PID_FILE = path.join(STATE_DIR, 'dashboard.pid');

// Step 1: Deregister this project
try {
  const hash = crypto.createHash('sha256').update(PROJECT_DIR).digest('hex').slice(0, 12);
  const instanceFile = path.join(INSTANCES_DIR, `${hash}.json`);
  if (fs.existsSync(instanceFile)) {
    fs.unlinkSync(instanceFile);
  }
} catch {}

// Step 2: Check if any other projects are still active
function hasActiveInstances() {
  if (!fs.existsSync(INSTANCES_DIR)) return false;
  const files = fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, file), 'utf8'));
      try { process.kill(info.pid, 0); return true; } catch {}
      // Stale — clean up
      try { fs.unlinkSync(path.join(INSTANCES_DIR, file)); } catch {}
    } catch {}
  }
  return false;
}

// Step 3: If no other projects active, stop the central dashboard
if (!hasActiveInstances()) {
  if (fs.existsSync(CENTRAL_PID_FILE)) {
    const pid = parseInt(fs.readFileSync(CENTRAL_PID_FILE, 'utf8').trim(), 10);
    if (pid) {
      try {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch {}
    }
    try { fs.unlinkSync(CENTRAL_PID_FILE); } catch {}
  }
}
