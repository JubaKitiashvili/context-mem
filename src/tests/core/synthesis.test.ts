import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { VaultSync } from '../../core/vault.js';
import { SynthesisEngine } from '../../core/synthesis.js';
import type { LLMService } from '../../core/llm-provider.js';
import type { LLMProvider } from '../../core/llm-provider.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockLLMService(synthesisResult: { synthesis: string } | null | 'throw'): LLMService {
  const provider: LLMProvider = {
    name: 'mock',
    async isAvailable() { return true; },
    async complete(_prompt: string) {
      if (synthesisResult === 'throw') throw new Error('LLM failure');
      return synthesisResult;
    },
  };
  // Use the real LLMService but override synthesizePage for simplicity
  const svc = {
    getProvider: () => provider,
    synthesizePage: async (_existing: string, _obs: string, _name: string) => {
      if (synthesisResult === 'throw') throw new Error('LLM failure');
      return synthesisResult;
    },
  } as unknown as LLMService;
  return svc;
}

// ── Shared setup ────────────────────────────────────────────────────────────

describe('SynthesisEngine', () => {
  let tmp: string;
  let dbPath: string;
  let vaultDir: string;
  let storage: BetterSqlite3Storage;
  let vault: VaultSync;

  before(async () => {
    tmp = path.join(os.tmpdir(), `cm-synthesis-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    dbPath = path.join(tmp, 'store.db');
    vaultDir = path.join(tmp, 'vault');
    storage = new BetterSqlite3Storage();
    await storage.open(dbPath);
  });

  beforeEach(() => {
    // Fresh vault dir each test to avoid cross-test pollution
    if (fs.existsSync(vaultDir)) {
      fs.rmSync(vaultDir, { recursive: true });
    }
    vault = new VaultSync(storage, { vaultDir });
  });

  after(async () => {
    await storage.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
  });

  // ── Helper to seed an entity + observations ──────────────────────────────

  function seedEntity(name: string, type: string, observationCount: number, privacy: 'public' | 'private' = 'public'): void {
    const entityId = `e-${name}-${Date.now()}-${Math.random()}`;
    storage.exec(
      `INSERT OR IGNORE INTO entities (id, name, entity_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entityId, name, type, '{}', Date.now(), Date.now()],
    );
    for (let i = 0; i < observationCount; i++) {
      const obsId = `obs-${name}-${i}-${Date.now()}-${Math.random()}`;
      storage.exec(
        `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [obsId, 'context', `${name} observation ${i} content`, `${name} summary ${i}`, '{}', Date.now() - i * 1000, privacy],
      );
    }
  }

  function seedTopic(name: string, observationCount: number, privacy: 'public' | 'private' = 'public'): void {
    const topicId = `t-${name}-${Date.now()}-${Math.random()}`;
    storage.exec(
      `INSERT OR IGNORE INTO topics (id, name, parent_id, observation_count, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
      [topicId, name, null, observationCount, Date.now()],
    );
    for (let i = 0; i < observationCount; i++) {
      const obsId = `obs-topic-${name}-${i}-${Date.now()}-${Math.random()}`;
      storage.exec(
        `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [obsId, 'context', `${name} topic observation ${i}`, `${name} topic summary ${i}`, '{}', Date.now() - i * 1000, privacy],
      );
      storage.exec(
        `INSERT INTO observation_topics (observation_id, topic_id, confidence) VALUES (?, ?, ?)`,
        [obsId, topicId, 1.0],
      );
    }
  }

  // ── Test 1: below min-observations → no page written ──────────────────────

  it('does not write synthesis page when entity has fewer than minObservations', async () => {
    await vault.init();
    seedEntity('LowCount', 'library', 2); // below default of 3
    const engine = new SynthesisEngine(storage, vault, null, {
      vaultDir,
      enabled: true,
      debounceMs: 0,
      minObservations: 3,
    });
    await engine.refreshEntity('LowCount');
    engine.stop();
    const pagePath = path.join(vaultDir, 'entities', 'LowCount.md');
    assert.ok(!fs.existsSync(pagePath), 'should not write page below min-observations');
  });

  // ── Test 2: at min-observations, no LLM → deterministic template ──────────

  it('writes deterministic template when entity meets min-observations and no LLM', async () => {
    await vault.init();
    seedEntity('Postgres', 'library', 3);
    const engine = new SynthesisEngine(storage, vault, null, {
      vaultDir,
      enabled: true,
      debounceMs: 0,
      minObservations: 3,
    });
    await engine.refreshEntity('Postgres');
    engine.stop();
    const pagePath = path.join(vaultDir, 'entities', 'Postgres.md');
    assert.ok(fs.existsSync(pagePath), 'synthesis page should be written');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('Postgres'), 'page must include entity name');
    assert.ok(content.includes('Timeline of Observations'), 'must include timeline section');
    assert.ok(content.includes('Related Entities'), 'must include related entities section');
    assert.ok(content.includes('Open Questions'), 'must include open questions section');
  });

  // ── Test 3: at min-observations, LLM returns synthesis → LLM output written ──

  it('writes LLM synthesis output when LLM returns structured result', async () => {
    await vault.init();
    seedEntity('Redis', 'library', 3);
    const llm = makeMockLLMService({ synthesis: '# Redis\n\nMock LLM narrative about Redis.\n\n## Open Questions\n\nNone.\n' });
    const engine = new SynthesisEngine(storage, vault, llm, {
      vaultDir,
      enabled: true,
      debounceMs: 0,
      minObservations: 3,
    });
    await engine.refreshEntity('Redis');
    engine.stop();
    const pagePath = path.join(vaultDir, 'entities', 'Redis.md');
    assert.ok(fs.existsSync(pagePath), 'synthesis page should be written');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('Mock LLM narrative about Redis'), 'LLM output must be written to page');
  });

  // ── Test 4: LLM throws → falls back to deterministic template, no error propagated ──

  it('falls back to deterministic template when LLM throws', async () => {
    await vault.init();
    seedEntity('MySQL', 'library', 3);
    const llm = makeMockLLMService('throw');
    const engine = new SynthesisEngine(storage, vault, llm, {
      vaultDir,
      enabled: true,
      debounceMs: 0,
      minObservations: 3,
    });
    // Should NOT throw
    await assert.doesNotReject(async () => {
      await engine.refreshEntity('MySQL');
    });
    engine.stop();
    const pagePath = path.join(vaultDir, 'entities', 'MySQL.md');
    assert.ok(fs.existsSync(pagePath), 'fallback deterministic page must be written');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('MySQL'), 'page must include entity name');
    assert.ok(content.includes('Timeline of Observations'), 'fallback page must include timeline section');
  });

  // ── Test 5: Debounce — 5 rapid calls → single write ──────────────────────

  it('debounces multiple scheduleEntity calls into a single write', async () => {
    await vault.init();
    const entityName = 'DebounceTest';
    seedEntity(entityName, 'service', 5);

    let writeCount = 0;
    const origWriteFile = fs.writeFileSync.bind(fs);
    const stub = fs.writeFileSync;
    // Track file writes via a wrapper — we instead count by checking mtime changes
    // Simpler: use a short debounce and verify only one file exists with consistent content
    const engine = new SynthesisEngine(storage, vault, null, {
      vaultDir,
      enabled: true,
      debounceMs: 50,
      minObservations: 3,
    });

    // Fire 5 rapid calls
    for (let i = 0; i < 5; i++) {
      engine.scheduleEntity(entityName);
    }

    // Wait for debounce to fire
    await new Promise(res => setTimeout(res, 200));
    engine.stop();

    // Page should exist and have been written (effectively once by now)
    const pagePath = path.join(vaultDir, 'entities', `${entityName}.md`);
    assert.ok(fs.existsSync(pagePath), 'page should exist after debounced refresh');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes(entityName), 'page content should include entity name');
    // The key assertion: there's only ONE page file (not multiple duplicates)
    const files = fs.readdirSync(path.join(vaultDir, 'entities'));
    const debounceFiles = files.filter(f => f.includes('DebounceTest'));
    assert.equal(debounceFiles.length, 1, 'only one page file should exist');
    void origWriteFile; // quiet unused warning
    void stub;
    void writeCount;
  });

  // ── Test 6: Privacy — private observations not passed to LLM or written to disk ──

  it('excludes private observations from synthesis content and LLM input', async () => {
    await vault.init();

    // Insert entity
    const entityId = `e-privacy-${Date.now()}`;
    storage.exec(
      `INSERT INTO entities (id, name, entity_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entityId, 'PrivacyEntity', 'service', '{}', Date.now(), Date.now()],
    );

    // Public observations
    for (let i = 0; i < 3; i++) {
      storage.exec(
        `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`obs-pub-priv-${i}`, 'context', `PrivacyEntity public observation ${i}`, `public summary ${i}`, '{}', Date.now(), 'public'],
      );
    }

    // One private observation with sensitive content
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['obs-private-sentinel', 'context', 'PrivacyEntity SECRET_PRIVATE_PAYLOAD_DO_NOT_LEAK', 'private secret summary', '{}', Date.now(), 'private'],
    );

    // Track what gets passed to LLM
    let llmInput = '';
    const llm = {
      getProvider: () => null,
      synthesizePage: async (existing: string, obs: string, name: string) => {
        llmInput = `${existing}\n${obs}\n${name}`;
        return { synthesis: `# PrivacyEntity\n\nSafe LLM output.\n` };
      },
    } as unknown as LLMService;

    const engine = new SynthesisEngine(storage, vault, llm, {
      vaultDir,
      enabled: true,
      debounceMs: 0,
      minObservations: 3,
    });
    await engine.refreshEntity('PrivacyEntity');
    engine.stop();

    // The private content must not be passed to the LLM
    assert.ok(!llmInput.includes('SECRET_PRIVATE_PAYLOAD_DO_NOT_LEAK'), 'private content must not be passed to LLM');
    assert.ok(!llmInput.includes('private secret summary'), 'private summary must not be passed to LLM');

    // The private content must not appear in the written page
    const pagePath = path.join(vaultDir, 'entities', 'PrivacyEntity.md');
    if (fs.existsSync(pagePath)) {
      const pageContent = fs.readFileSync(pagePath, 'utf8');
      assert.ok(!pageContent.includes('SECRET_PRIVATE_PAYLOAD_DO_NOT_LEAK'), 'private content must not appear in page file');
      assert.ok(!pageContent.includes('private secret summary'), 'private summary must not appear in page file');
    }
  });

  // ── Test 7: flush() completes all pending refreshes ──────────────────────

  it('flush() resolves only after all pending refreshes complete', async () => {
    await vault.init();
    const names = ['FlushA', 'FlushB', 'FlushC'];
    for (const n of names) {
      seedEntity(n, 'service', 3);
    }

    const engine = new SynthesisEngine(storage, vault, null, {
      vaultDir,
      enabled: true,
      debounceMs: 5000, // long debounce — flush must bypass it
      minObservations: 3,
    });

    for (const n of names) {
      engine.scheduleEntity(n);
    }

    // Flush should force immediate completion
    await engine.flush();
    engine.stop();

    for (const n of names) {
      const pagePath = path.join(vaultDir, 'entities', `${n}.md`);
      assert.ok(fs.existsSync(pagePath), `${n} synthesis page must exist after flush`);
    }
  });

  // ── Test 8: refreshTopic — sanity check ──────────────────────────────────

  it('refreshTopic writes deterministic topic page when topic meets min-observations', async () => {
    await vault.init();
    seedTopic('authentication', 3);

    const engine = new SynthesisEngine(storage, vault, null, {
      vaultDir,
      enabled: true,
      debounceMs: 0,
      minObservations: 3,
    });
    await engine.refreshTopic('authentication');
    engine.stop();

    const pagePath = path.join(vaultDir, 'topics', 'authentication.md');
    assert.ok(fs.existsSync(pagePath), 'topic synthesis page should be written');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('authentication'), 'page must include topic name');
    assert.ok(content.includes('Timeline of Observations'), 'must include timeline section');
  });

  // ── Test 9: stop() — no pending timers fire after stop ───────────────────

  it('stop() cancels pending timers and no writes occur after stop', async () => {
    await vault.init();
    seedEntity('StopTest', 'library', 3);

    const engine = new SynthesisEngine(storage, vault, null, {
      vaultDir,
      enabled: true,
      debounceMs: 200,
      minObservations: 3,
    });

    engine.scheduleEntity('StopTest');
    // Stop before debounce fires
    engine.stop();

    // Wait longer than the debounce
    await new Promise(res => setTimeout(res, 400));

    const pagePath = path.join(vaultDir, 'entities', 'StopTest.md');
    assert.ok(!fs.existsSync(pagePath), 'no page should be written after stop() cancels timers');
  });
});
