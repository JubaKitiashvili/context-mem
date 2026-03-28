#!/usr/bin/env node
'use strict';

/**
 * context-mem update checker
 *
 * Modeled after gstack's update-check mechanism.
 *
 * Output codes (stdout, single line):
 *   JUST_UPGRADED <old> <new>      — User just upgraded
 *   UPGRADE_AVAILABLE <old> <new>  — Newer version on npm
 *   (empty)                        — Up to date, snoozed, disabled, or cached
 *
 * State files (in ~/.context-mem/):
 *   last-update-check   — Cache: "STATUS LOCAL REMOTE"
 *   update-snoozed      — Snooze: "VERSION LEVEL EPOCH"
 *   just-upgraded-from   — Marker: old version string
 *   config.yaml          — User settings (update_check, auto_upgrade)
 *
 * Always exits 0. Never blocks. Network timeout: 5s.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIR = process.env.CONTEXT_MEM_STATE_DIR || path.join(os.homedir(), '.context-mem');
const CACHE_FILE = path.join(STATE_DIR, 'last-update-check');
const SNOOZE_FILE = path.join(STATE_DIR, 'update-snoozed');
const MARKER_FILE = path.join(STATE_DIR, 'just-upgraded-from');
const CONFIG_FILE = path.join(STATE_DIR, 'config.yaml');

// TTLs in minutes
const TTL_UP_TO_DATE = 60;        // 1 hour — detect new releases fast
const TTL_UPGRADE_AVAILABLE = 720; // 12 hours — keep reminding

// Snooze durations in seconds
const SNOOZE_DURATIONS = {
  1: 86400,   // 24 hours
  2: 172800,  // 48 hours
  3: 604800,  // 7 days (level 3+)
};

// --- Helpers ---

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

function writeFile(p, content) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(p, content);
  } catch {}
}

function getConfig(key) {
  const content = readFile(CONFIG_FILE);
  if (!content) return null;
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function fileAgeMinutes(filepath) {
  try {
    const stat = fs.statSync(filepath);
    return (Date.now() - stat.mtimeMs) / 60000;
  } catch { return Infinity; }
}

function isValidVersion(v) {
  return v && /^\d+\.\d+\.\d+/.test(v);
}

// --- Main ---

function main() {
  // Step 0: Check if disabled
  if (getConfig('update_check') === 'false') {
    process.exit(0);
  }

  // Step 1: Read local version
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkgContent = readFile(pkgPath);
  if (!pkgContent) process.exit(0);

  let local;
  try { local = JSON.parse(pkgContent).version; } catch { process.exit(0); }
  if (!isValidVersion(local)) process.exit(0);

  let justUpgradedOutput = null;

  // Step 2: Check "just upgraded" marker
  const markerContent = readFile(MARKER_FILE);
  if (markerContent && isValidVersion(markerContent) && markerContent !== local) {
    try { fs.unlinkSync(MARKER_FILE); } catch {}
    try { fs.unlinkSync(SNOOZE_FILE); } catch {} // Clear snooze on upgrade
    justUpgradedOutput = `JUST_UPGRADED ${markerContent} ${local}`;
    // Don't exit — fall through to check for even newer remote
  }

  const forceFlag = process.argv.includes('--force');

  // Step 3: Check snooze (unless --force)
  if (!forceFlag) {
    const snoozeContent = readFile(SNOOZE_FILE);
    if (snoozeContent) {
      const parts = snoozeContent.split(' ');
      if (parts.length === 3) {
        const [snoozedVer, levelStr, epochStr] = parts;
        const level = parseInt(levelStr, 10);
        const epoch = parseInt(epochStr, 10);
        if (!isNaN(level) && !isNaN(epoch) && isValidVersion(snoozedVer)) {
          // New version resets snooze
          // But if same version, check if still snoozed
          const duration = SNOOZE_DURATIONS[Math.min(level, 3)] || SNOOZE_DURATIONS[3];
          const expiresAt = epoch + duration;
          const now = Math.floor(Date.now() / 1000);
          if (snoozedVer === local || now < expiresAt) {
            // Still snoozed for this version
            if (justUpgradedOutput) console.log(justUpgradedOutput);
            process.exit(0);
          }
        }
      }
    }
  }

  // Step 4: Check cache freshness (unless --force)
  if (!forceFlag) {
    const cacheContent = readFile(CACHE_FILE);
    if (cacheContent) {
      const parts = cacheContent.split(' ');
      const status = parts[0];
      const cachedLocal = parts[1];

      let ttl = 0;
      if (status === 'UP_TO_DATE') ttl = TTL_UP_TO_DATE;
      else if (status === 'UPGRADE_AVAILABLE') ttl = TTL_UPGRADE_AVAILABLE;

      const age = fileAgeMinutes(CACHE_FILE);

      if (ttl > 0 && age < ttl && cachedLocal === local) {
        // Cache is fresh and version matches
        if (status === 'UPGRADE_AVAILABLE' && parts[2]) {
          if (justUpgradedOutput) console.log(justUpgradedOutput);
          console.log(`UPGRADE_AVAILABLE ${local} ${parts[2]}`);
        } else if (justUpgradedOutput) {
          console.log(justUpgradedOutput);
        }
        process.exit(0);
      }
    }
  }

  // Step 5: Slow path — fetch remote version from npm
  let remote;
  try {
    const { execSync } = require('child_process');
    remote = execSync('npm view context-mem version 2>/dev/null', {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Network failure — treat as up to date
    writeFile(CACHE_FILE, `UP_TO_DATE ${local}`);
    if (justUpgradedOutput) console.log(justUpgradedOutput);
    process.exit(0);
  }

  // Validate response
  if (!isValidVersion(remote)) {
    writeFile(CACHE_FILE, `UP_TO_DATE ${local}`);
    if (justUpgradedOutput) console.log(justUpgradedOutput);
    process.exit(0);
  }

  // Step 6: Compare versions
  if (compareVersions(remote, local) > 0) {
    writeFile(CACHE_FILE, `UPGRADE_AVAILABLE ${local} ${remote}`);
    if (justUpgradedOutput) console.log(justUpgradedOutput);
    console.log(`UPGRADE_AVAILABLE ${local} ${remote}`);
  } else {
    writeFile(CACHE_FILE, `UP_TO_DATE ${local}`);
    if (justUpgradedOutput) console.log(justUpgradedOutput);
  }
}

try {
  main();
} catch {
  // Never fail, never block
  process.exit(0);
}
