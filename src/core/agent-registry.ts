import fs from 'node:fs';
import path from 'node:path';
import { ulid } from './utils.js';
import type { AgentInfo } from './types.js';
import type { EventTracker } from './events.js';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// AgentRegistry — file-based multi-agent coordination
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private registryPath: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private agentId: string;

  constructor(private projectDir: string, private sessionId: string) {
    this.registryPath = path.join(projectDir, '.context-mem', 'agents.json');
    this.agentId = ulid();
  }

  /** Expose agent ID for external use */
  getId(): string {
    return this.agentId;
  }

  register(name: string, task?: string): AgentInfo {
    const agents = this.load();
    this.pruneStale(agents);
    const agent: AgentInfo = {
      id: this.agentId,
      name,
      session_id: this.sessionId,
      pid: process.pid,
      started_at: Date.now(),
      last_heartbeat: Date.now(),
      status: 'active',
      current_task: task || '',
      files_claimed: [],
    };
    agents.push(agent);
    this.save(agents);
    this.startHeartbeat();
    return agent;
  }

  deregister(): void {
    this.stopHeartbeat();
    const agents = this.load().filter(a => a.id !== this.agentId);
    this.save(agents);
  }

  getActive(includeStale?: boolean): AgentInfo[] {
    const agents = this.load();
    if (!includeStale) this.pruneStale(agents);
    return agents;
  }

  claimFiles(files: string[]): { claimed: string[]; conflicts: Array<{ file: string; agent: string }> } {
    const agents = this.load();
    this.pruneStale(agents);
    const conflicts: Array<{ file: string; agent: string }> = [];
    const claimed: string[] = [];

    for (const file of files) {
      const owner = agents.find(a => a.id !== this.agentId && a.files_claimed.includes(file));
      if (owner) {
        conflicts.push({ file, agent: owner.name });
      } else {
        claimed.push(file);
      }
    }

    // Update our agent's claimed files
    const self = agents.find(a => a.id === this.agentId);
    if (self) {
      self.files_claimed = [...new Set([...self.files_claimed, ...claimed])];
      this.save(agents);
    }

    return { claimed, conflicts };
  }

  releaseFiles(files: string[]): void {
    const agents = this.load();
    const self = agents.find(a => a.id === this.agentId);
    if (self) {
      self.files_claimed = self.files_claimed.filter(f => !files.includes(f));
      this.save(agents);
    }
  }

  updateTask(task: string): void {
    const agents = this.load();
    const self = agents.find(a => a.id === this.agentId);
    if (self) {
      self.current_task = task;
      this.save(agents);
    }
  }

  broadcast(message: string, priority: number, eventTracker?: EventTracker): void {
    if (!eventTracker) return;
    eventTracker.emit(
      this.sessionId,
      'agent_broadcast',
      { message, agent_id: this.agentId },
      this.agentId,
    );
  }

  /** Visible for testing */
  _getHeartbeatInterval(): NodeJS.Timeout | null {
    return this.heartbeatInterval;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const agents = this.load();
      const self = agents.find(a => a.id === this.agentId);
      if (self) {
        self.last_heartbeat = Date.now();
        this.save(agents);
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatInterval.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private pruneStale(agents: AgentInfo[]): void {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    const stale = agents.filter(a => a.last_heartbeat < cutoff);
    for (const s of stale) {
      agents.splice(agents.indexOf(s), 1);
    }
    if (stale.length > 0) this.save(agents);
  }

  private load(): AgentInfo[] {
    try {
      if (!fs.existsSync(this.registryPath)) return [];
      return JSON.parse(fs.readFileSync(this.registryPath, 'utf8')).agents || [];
    } catch {
      return [];
    }
  }

  private save(agents: AgentInfo[]): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to tmp then rename
    const tmpPath = this.registryPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify({ agents }, null, 2));
    fs.renameSync(tmpPath, this.registryPath);
  }
}
