import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentRegistry } from '../../core/agent-registry.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-agent-test-'));
}

describe('AgentRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  // ---- Registration ----

  it('register creates agent entry', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    const agent = reg.register('test-agent', 'doing stuff');
    assert.ok(agent.id, 'agent should have an id');
    assert.equal(agent.name, 'test-agent');
    assert.equal(agent.current_task, 'doing stuff');
    assert.equal(agent.status, 'active');
    assert.equal(agent.session_id, 'sess-1');
    assert.equal(agent.pid, process.pid);
    assert.deepEqual(agent.files_claimed, []);
    reg.deregister();
  });

  it('deregister removes agent', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('test-agent');
    assert.equal(reg.getActive().length, 1);
    reg.deregister();
    assert.equal(reg.getActive().length, 0);
  });

  // ---- getActive ----

  it('getActive returns only active agents', () => {
    const reg1 = new AgentRegistry(tmpDir, 'sess-1');
    const reg2 = new AgentRegistry(tmpDir, 'sess-2');
    reg1.register('agent-1');
    reg2.register('agent-2');
    const active = reg1.getActive();
    assert.equal(active.length, 2);
    reg1.deregister();
    reg2.deregister();
  });

  it('stale agents are pruned', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('fresh-agent');

    // Manually inject a stale agent into the registry file
    const registryPath = path.join(tmpDir, '.context-mem', 'agents.json');
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    data.agents.push({
      id: 'stale-id',
      name: 'stale-agent',
      session_id: 'sess-old',
      pid: 99999,
      started_at: Date.now() - 600_000,
      last_heartbeat: Date.now() - 600_000, // 10 min ago
      status: 'active',
      current_task: '',
      files_claimed: [],
    });
    fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));

    // getActive should prune the stale one
    const active = reg.getActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].name, 'fresh-agent');
    reg.deregister();
  });

  // ---- File claiming ----

  it('claimFiles succeeds when unclaimed', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('agent-1');
    const result = reg.claimFiles(['src/foo.ts', 'src/bar.ts']);
    assert.deepEqual(result.claimed, ['src/foo.ts', 'src/bar.ts']);
    assert.equal(result.conflicts.length, 0);

    // Verify files are in the agent entry
    const active = reg.getActive();
    const self = active.find(a => a.id === reg.getId());
    assert.ok(self);
    assert.ok(self.files_claimed.includes('src/foo.ts'));
    assert.ok(self.files_claimed.includes('src/bar.ts'));
    reg.deregister();
  });

  it('claimFiles returns conflicts when claimed by another agent', () => {
    const reg1 = new AgentRegistry(tmpDir, 'sess-1');
    const reg2 = new AgentRegistry(tmpDir, 'sess-2');
    reg1.register('agent-1');
    reg2.register('agent-2');

    reg1.claimFiles(['src/shared.ts']);

    const result = reg2.claimFiles(['src/shared.ts', 'src/unique.ts']);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].file, 'src/shared.ts');
    assert.equal(result.conflicts[0].agent, 'agent-1');
    assert.deepEqual(result.claimed, ['src/unique.ts']);

    reg1.deregister();
    reg2.deregister();
  });

  it('releaseFiles works', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('agent-1');
    reg.claimFiles(['src/a.ts', 'src/b.ts']);

    reg.releaseFiles(['src/a.ts']);

    const active = reg.getActive();
    const self = active.find(a => a.id === reg.getId());
    assert.ok(self);
    assert.deepEqual(self.files_claimed, ['src/b.ts']);
    reg.deregister();
  });

  // ---- updateTask ----

  it('updateTask updates current_task', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('agent-1', 'initial task');
    reg.updateTask('new task');

    const active = reg.getActive();
    const self = active.find(a => a.id === reg.getId());
    assert.ok(self);
    assert.equal(self.current_task, 'new task');
    reg.deregister();
  });

  // ---- Multiple agents ----

  it('multiple agents can coexist', () => {
    const agents: AgentRegistry[] = [];
    for (let i = 0; i < 3; i++) {
      const reg = new AgentRegistry(tmpDir, `sess-${i}`);
      reg.register(`agent-${i}`, `task-${i}`);
      agents.push(reg);
    }

    const active = agents[0].getActive();
    assert.equal(active.length, 3);
    const names = active.map(a => a.name).sort();
    assert.deepEqual(names, ['agent-0', 'agent-1', 'agent-2']);

    for (const a of agents) a.deregister();
  });

  // ---- Heartbeat ----

  it('heartbeat interval created and cleaned up on deregister', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('agent-1');
    assert.ok(reg._getHeartbeatInterval(), 'heartbeat should be running after register');

    reg.deregister();
    assert.equal(reg._getHeartbeatInterval(), null, 'heartbeat should be null after deregister');
  });

  // ---- Atomic write ----

  it('atomic write produces valid JSON', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    reg.register('agent-1');

    const registryPath = path.join(tmpDir, '.context-mem', 'agents.json');
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed.agents), 'agents should be an array');
    assert.equal(parsed.agents.length, 1);
    assert.equal(parsed.agents[0].name, 'agent-1');

    // Ensure no .tmp file left behind
    assert.ok(!fs.existsSync(registryPath + '.tmp'), 'tmp file should not exist after atomic write');

    reg.deregister();
  });

  // ---- getId uses ULID format ----

  it('agent ID uses ULID format', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    const agent = reg.register('agent-1');
    // ULID is 26 chars, uppercase alphanumeric (Crockford base32)
    assert.equal(agent.id.length, 26, 'ULID should be 26 characters');
    assert.match(agent.id, /^[0-9A-Z]{26}$/, 'ULID should be uppercase alphanumeric');
    reg.deregister();
  });

  // ---- register with no task defaults to empty string ----

  it('register with no task defaults to empty string', () => {
    const reg = new AgentRegistry(tmpDir, 'sess-1');
    const agent = reg.register('agent-1');
    assert.equal(agent.current_task, '');
    reg.deregister();
  });
});
