/**
 * Real-Kernel Benchmark Adapter (T5.1)
 * =====================================
 *
 * Wraps the ACTUAL context-mem Kernel (src/core/kernel.ts → dist/core/kernel.js)
 * with a BenchKernel-compatible interface, so benchmarks can exercise the FULL
 * v4.0 product: pipeline.observe() with entity extraction + topic detection +
 * synthesis scheduling + vault sync + knowledge graph, plus the real fusion
 * search over observations + knowledge + content.
 *
 * Interface contract:
 *   const k = await new RealKernelBench({...}).open();
 *   await k.ingest(sessionId, content, { date, type, source });
 *   await k.flushAll();            // await synthesis + embeddings before search
 *   const hits = await k.searchAsync(query, limit, { referenceDate });
 *   k.close();
 *
 * Design choices:
 *   - Kernel is expensive to start (plugin registration ~1s), so reuse it across
 *     questions via resetObservations() between each benchmark item.
 *   - Synthesis is ON by default — that's the whole point.
 *   - Vector search is OFF by default (heavy; benchmark baseline w/o it first).
 *   - Custom session IDs: kernel.observe() generates ulid; we map session→obs
 *     and translate search results back for benchmark comparison.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const projectRoot = path.resolve(__dirname, '..', '..');
const { Kernel } = require(path.join(projectRoot, 'dist/core/kernel.js'));

class RealKernelBench {
  constructor(opts = {}) {
    this.opts = {
      synthesis: opts.synthesis ?? true,
      vault: opts.vault ?? true,
      vector: opts.vector ?? false,
      llmJudge: opts.llmJudge ?? false,
      ...opts,
    };
    this.sessionToObs = new Map(); // sessionId → obs.id
    this.obsToSession = new Map(); // obs.id → sessionId
  }

  async open() {
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-real-bench-'));

    // Write a minimal config that enables v4.0 features for full-product measurement
    const config = {
      db_path: '.context-mem/store.db',
      storage: 'auto',
      plugins: {
        summarizers: [],  // skip summarizers — they don't affect retrieval, only compression
        search: this.opts.vector
          ? ['bm25', 'trigram', 'levenshtein', 'vector']
          : ['bm25', 'trigram', 'levenshtein'],
        runtimes: [],
      },
      privacy: { strip_tags: true, redact_patterns: [] },
      vault: {
        enabled: this.opts.vault,
        synthesis: this.opts.synthesis,
        dir: '.context-mem/vault',
      },
      ai_curation: this.opts.llmJudge ? { enabled: true } : { enabled: false },
      token_economics: false,  // disable for benchmark speed
      lifecycle: { ttl_days: 999999, max_db_size_mb: 10000, max_observations: 1000000, cleanup_schedule: 'manual', preserve_types: [] },
      global_knowledge: { enabled: false },  // no cross-project pollution in benchmark
      port: 0,
      api_port: 0,
      execute_enabled: false,
    };
    fs.writeFileSync(path.join(this.tmpDir, '.context-mem.json'), JSON.stringify(config, null, 2));

    this.kernel = new Kernel(this.tmpDir);
    await this.kernel.start();
    this.storage = this.kernel.getStorage();

    // Prepared statement for fast id rewrites (benchmark dates are overridden)
    this._updateIndexedAtStmt = this.storage.prepare('UPDATE observations SET indexed_at = ? WHERE id = ?');

    return this;
  }

  /**
   * Reset all state between benchmark questions. Faster than tearing down
   * and rebuilding the Kernel.
   */
  async resetObservations() {
    this.sessionToObs.clear();
    this.obsToSession.clear();

    const tables = [
      'observations',
      'obs_fts',
      'obs_trigram',
      'entities',
      'relationships',
      'topics',
      'observation_topics',
      'knowledge',
      'knowledge_fts',
      'content_store',
      'content_fts',
      'session_snapshots',
      'event_log',
      'token_stats',
      'topic_observations',
      'facts',
      'observation_entities',
    ];
    for (const t of tables) {
      try { this.storage.exec(`DELETE FROM ${t}`); } catch {}
    }

    // Clear vault directory between questions
    if (this.opts.vault) {
      const vaultDir = path.join(this.tmpDir, '.context-mem', 'vault');
      try { fs.rmSync(vaultDir, { recursive: true, force: true }); } catch {}
      if (this.kernel.getVaultSync && typeof this.kernel.getVaultSync === 'function') {
        const v = this.kernel.getVaultSync();
        if (v) await v.init();
      }
    }
  }

  /**
   * Ingest one session via the REAL pipeline. Runs entity extraction, topic
   * detection, synthesis scheduling, vault sync, knowledge graph updates.
   *
   * @param {string} sessionId — benchmark session id (mapped to obs.id internally)
   * @param {string} content — text content
   * @param {object} metadata — { date?, type?, source? }
   * @returns {string} obs.id
   */
  async ingest(sessionId, content, metadata = {}) {
    const type = metadata.type || 'context';
    const source = metadata.source || 'benchmark';
    const obs = await this.kernel.observe(content, type, source);
    this.sessionToObs.set(sessionId, obs.id);
    this.obsToSession.set(obs.id, sessionId);

    // Override indexed_at with the session date (benchmark dates are in the past)
    if (metadata.date !== undefined && metadata.date !== null) {
      const ts = typeof metadata.date === 'number'
        ? metadata.date
        : new Date(String(metadata.date).replace(/\s*\([^)]*\)/, '')).getTime();
      if (!isNaN(ts)) {
        this._updateIndexedAtStmt.run(ts, obs.id);
      }
    }
    return obs.id;
  }

  /**
   * Wait for all deferred work (synthesis refreshes, embedding jobs).
   * Call before search when you need consistent state.
   */
  async flushAll() {
    // Synthesis engine (T4.4) has an explicit flush
    if (this.kernel.synthesisEngine && typeof this.kernel.synthesisEngine.flush === 'function') {
      try { await this.kernel.synthesisEngine.flush(); } catch {}
    }
    // Give setImmediate-scheduled embeddings a chance to complete
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
  }

  /**
   * Search via the REAL fusion. Returns hits with `id` mapped back to session
   * ids for benchmark scoring.
   */
  async searchAsync(query, limit = 10, opts = {}) {
    const results = await this.kernel.search(query, { ...opts, limit });
    return results.map(r => ({
      ...r,
      obs_id: r.id,
      id: this.obsToSession.get(r.id) || r.id,
    }));
  }

  /** Compatibility shim — benchmarks sometimes call .search() sync. Real Kernel is async. */
  search(query, limit = 10, opts = {}) {
    // Return a Promise; callers that `await` it get correct result.
    return this.searchAsync(query, limit, opts);
  }

  /**
   * Hybrid-search compatibility shim — real Kernel's fusion already blends BM25
   * + trigram + levenshtein + vector (when plugin enabled). `--vector` in the
   * benchmark maps to the `vector` plugin being in the search list at `open()`.
   */
  async hybridSearch(query, limit = 10, opts = {}) {
    return this.searchAsync(query, limit, opts);
  }

  /** No-op: real Kernel embeds asynchronously in the pipeline (if vector is enabled). */
  async embedAll() { /* embeddings happen during observe() */ }

  /** ID resolver — BenchKernel stored alternate ids on dedup; RealKernelBench doesn't dedup differently. */
  resolveId(id) { return id; }

  /** Read-through for direct DB access (benchmark uses this to fetch content by id). */
  get db() { return this.storage; }

  /**
   * Look up observation content by the original session id (benchmark uses this
   * to build E2E QA context).
   */
  getContentBySessionId(sessionId) {
    const obsId = this.sessionToObs.get(sessionId);
    if (!obsId) return null;
    const row = this.storage.prepare('SELECT content FROM observations WHERE id = ?').get(obsId);
    return row ? row.content : null;
  }

  /**
   * Look up observation content by obs.id — used by benchmark search result
   * context extraction (where the returned hit.obs_id is the kernel-native id).
   */
  getContentByObsId(obsId) {
    const row = this.storage.prepare('SELECT content FROM observations WHERE id = ?').get(obsId);
    return row ? row.content : null;
  }

  async close() {
    if (this.kernel) {
      try { await this.kernel.stop(); } catch {}
    }
    if (this.tmpDir) {
      try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = { RealKernelBench };
