/**
 * Global instance registry — tracks all active context-mem instances.
 * Each serve process registers itself at startup, deregisters at shutdown.
 * Dashboard reads this to discover all projects.
 *
 * Storage: ~/.context-mem/instances/{hash}.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export interface InstanceInfo {
  projectDir: string;
  projectName: string;
  dbPath: string;
  pid: number;
  startedAt: string;
}

const INSTANCES_DIR = path.join(os.homedir(), '.context-mem', 'instances');

function hashProject(projectDir: string): string {
  return createHash('sha256').update(projectDir).digest('hex').slice(0, 12);
}

function instancePath(projectDir: string): string {
  return path.join(INSTANCES_DIR, `${hashProject(projectDir)}.json`);
}

export function registerInstance(projectDir: string, dbPath: string): void {
  fs.mkdirSync(INSTANCES_DIR, { recursive: true });

  const info: InstanceInfo = {
    projectDir,
    projectName: path.basename(projectDir),
    dbPath: path.resolve(projectDir, dbPath),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  fs.writeFileSync(instancePath(projectDir), JSON.stringify(info, null, 2) + '\n');
}

export function deregisterInstance(projectDir: string): void {
  const file = instancePath(projectDir);
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone
  }
}

/** Get all active instances, pruning stale ones */
export function getActiveInstances(): InstanceInfo[] {
  if (!fs.existsSync(INSTANCES_DIR)) return [];

  const instances: InstanceInfo[] = [];
  const files = fs.readdirSync(INSTANCES_DIR).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(INSTANCES_DIR, file);
    try {
      const info: InstanceInfo = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Check if process is still alive
      if (isProcessAlive(info.pid) && fs.existsSync(info.dbPath)) {
        instances.push(info);
      } else {
        // Stale — remove
        try { fs.unlinkSync(filePath); } catch {}
      }
    } catch {
      // Corrupt file — remove
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  return instances.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
