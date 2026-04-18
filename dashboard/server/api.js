'use strict';

const q = require('./queries.js');

// --- API router ---
function handleApi(req, res, state) {
  const { PORT, dbPath, db, currentProject, PROJECT_DIR, path, fs, os, Database, getRegisteredInstances, switchProject } = state;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  try {
    let data;
    switch (route) {
      case '/api/stats':
        data = q.getStats(state);
        break;
      case '/api/timeline':
        data = q.getTimeline(
          state,
          Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000),
          url.searchParams.get('type') || null,
          url.searchParams.get('session') || null
        );
        break;
      case '/api/observation':
        data = q.getObservation(state, url.searchParams.get('id') || '');
        break;
      case '/api/compression':
        data = q.getCompressionByType(state);
        break;
      case '/api/top-files':
        data = q.getTopFiles(state, Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 1000));
        break;
      case '/api/privacy':
        data = q.getPrivacyBreakdown(state);
        break;
      case '/api/activity':
        data = q.getSessionActivity(state);
        break;
      case '/api/db-health':
        data = q.getDbHealth(state);
        break;
      case '/api/export':
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="context-mem-export.json"',
          'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT,
        });
        res.end(JSON.stringify(q.exportObservations(
          state,
          Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 10000)
        ), null, 2));
        return;
      case '/api/search':
        data = q.searchObservations(
          state,
          url.searchParams.get('q') || '',
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 1000),
          url.searchParams.get('type') || null
        );
        break;
      case '/api/tokens':
        data = q.getTokenHistory(state);
        break;
      case '/api/sessions':
        data = q.getSessionList(state);
        break;
      case '/api/knowledge':
        data = q.getKnowledgeEntries(
          state,
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 1000),
          url.searchParams.get('category') || null
        );
        break;
      case '/api/knowledge-stats':
        data = q.getKnowledgeStats(state);
        break;
      case '/api/budget':
        data = q.getBudgetStatus(state);
        break;
      case '/api/events':
        data = q.getEvents(
          state,
          Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000),
          url.searchParams.get('session') || null
        );
        break;
      case '/api/event-stats':
        data = q.getEventStats(state);
        break;
      case '/api/snapshots':
        data = q.getSnapshots(state);
        break;
      case '/api/content-sources':
        data = q.getContentSources(state);
        break;
      case '/api/health':
        data = { status: 'ok', db: dbPath, uptime: process.uptime() };
        break;
      case '/api/init-status': {
        // Check if full init has been run for current project
        const projectDir = currentProject || PROJECT_DIR;
        const hasConfig = fs.existsSync(path.join(projectDir, '.context-mem.json'));
        const hasMarker = fs.existsSync(path.join(projectDir, '.context-mem', '.initialized'));
        const hasGitignore = (() => {
          const gp = path.join(projectDir, '.gitignore');
          if (!fs.existsSync(gp)) return false;
          return fs.readFileSync(gp, 'utf8').includes('.context-mem');
        })();
        // Detect which editors are present
        const editors = [];
        if (fs.existsSync(path.join(projectDir, '.cursor')) || fs.existsSync(path.join(os.homedir(), '.cursor'))) editors.push('Cursor');
        if (fs.existsSync(path.join(projectDir, '.windsurf')) || fs.existsSync(path.join(os.homedir(), '.windsurf'))) editors.push('Windsurf');
        if (fs.existsSync(path.join(projectDir, '.vscode'))) editors.push('Copilot');
        if (fs.existsSync(path.join(os.homedir(), '.cline'))) editors.push('Cline');
        if (fs.existsSync(path.join(os.homedir(), '.roo-code'))) editors.push('Roo Code');
        if (fs.existsSync(path.join(projectDir, 'CLAUDE.md'))) editors.push('Claude Code');
        if (fs.existsSync(path.join(projectDir, 'GEMINI.md'))) editors.push('Gemini CLI');
        data = {
          initialized: hasConfig,
          firstRunDone: hasMarker,
          gitignoreOk: hasGitignore,
          detectedEditors: editors,
          projectDir,
        };
        break;
      }
      case '/api/run-init': {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
          res.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        // Run context-mem init in the project directory
        const { execSync } = require('child_process');
        const initProjectDir = currentProject || PROJECT_DIR;
        try {
          const output = execSync('npx context-mem init', {
            cwd: initProjectDir,
            timeout: 30000,
            encoding: 'utf8',
            env: { ...process.env },
          });
          data = { ok: true, output: output.trim(), projectDir: initProjectDir };
        } catch (initErr) {
          data = { ok: false, error: initErr.message, output: initErr.stdout || '' };
        }
        break;
      }
      case '/api/instances':
        data = getRegisteredInstances().map(i => ({
          ...i,
          active: i.dbPath === db.name,
        }));
        break;
      case '/api/stats-all': {
        const allInstances = getRegisteredInstances();
        const allStats = [];
        let totalObs = 0, totalContentLen = 0, totalSummaryLen = 0;
        for (const inst of allInstances) {
          let tmpDb;
          try {
            tmpDb = new Database(inst.dbPath, { readonly: true });
            const obsCount = tmpDb.prepare('SELECT COUNT(*) as v FROM observations').get();
            const sizes = tmpDb.prepare('SELECT COALESCE(SUM(LENGTH(content)),0) as raw, COALESCE(SUM(LENGTH(summary)),0) as comp FROM observations').get();
            const obs = obsCount?.v || 0;
            const raw = sizes?.raw || 0;
            const comp = sizes?.comp || 0;
            totalObs += obs;
            totalContentLen += raw;
            totalSummaryLen += comp;
            allStats.push({ project: inst.projectName, projectDir: inst.projectDir, observations: obs, rawBytes: raw, compressedBytes: comp, savings: raw > 0 ? Math.round((1 - comp / raw) * 100) : 0 });
          } catch {} finally {
            try { if (tmpDb) tmpDb.close(); } catch {}
          }
        }
        data = {
          projects: allStats,
          total: {
            projectCount: allInstances.length,
            observations: totalObs,
            rawBytes: totalContentLen,
            compressedBytes: totalSummaryLen,
            savings: totalContentLen > 0 ? Math.round((1 - totalSummaryLen / totalContentLen) * 100) : 0,
          },
        };
        break;
      }
      case '/api/vector-status': {
        const vectorProjectDir = currentProject || PROJECT_DIR;
        const vectorConfigPath = path.join(vectorProjectDir, '.context-mem.json');
        let vectorEnabled = false;
        let hfInstalled = false;
        let embeddedCount = 0;
        let totalCount = 0;

        // Check config
        try {
          const cfg = JSON.parse(fs.readFileSync(vectorConfigPath, 'utf8'));
          vectorEnabled = Array.isArray(cfg.plugins?.search) && cfg.plugins.search.includes('vector');
        } catch {}

        // Check if @huggingface/transformers is importable
        try {
          require.resolve('@huggingface/transformers');
          hfInstalled = true;
        } catch {
          // Also check project-local node_modules
          try {
            require.resolve(path.join(vectorProjectDir, 'node_modules', '@huggingface/transformers'));
            hfInstalled = true;
          } catch {}
        }

        // Count embedded observations
        try {
          embeddedCount = db.prepare('SELECT COUNT(*) as v FROM observations WHERE embeddings IS NOT NULL').get().v;
          totalCount = db.prepare('SELECT COUNT(*) as v FROM observations').get().v;
        } catch {}

        // Determine status level:
        // "active"     — vector configured + HF installed + embeddings exist
        // "ready"      — vector configured + HF installed, but no embeddings yet
        // "missing-pkg" — vector configured but HF not installed
        // "available"  — vector not configured (upsell opportunity)
        let status = 'available';
        if (vectorEnabled && hfInstalled && embeddedCount > 0) status = 'active';
        else if (vectorEnabled && hfInstalled) status = 'ready';
        else if (vectorEnabled && !hfInstalled) status = 'missing-pkg';

        data = { status, vectorEnabled, hfInstalled, embeddedCount, totalCount, projectDir: vectorProjectDir };
        break;
      }
      case '/api/enable-vector': {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
          res.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        const enableProjectDir = currentProject || PROJECT_DIR;
        const enableConfigPath = path.join(enableProjectDir, '.context-mem.json');
        try {
          const cfg = JSON.parse(fs.readFileSync(enableConfigPath, 'utf8'));
          if (!Array.isArray(cfg.plugins?.search)) {
            cfg.plugins = cfg.plugins || {};
            cfg.plugins.search = ['bm25', 'trigram'];
          }
          if (!cfg.plugins.search.includes('vector')) {
            cfg.plugins.search.push('vector');
            fs.writeFileSync(enableConfigPath, JSON.stringify(cfg, null, 2) + '\n');
          }
          data = { ok: true, search: cfg.plugins.search };
        } catch (cfgErr) {
          data = { ok: false, error: cfgErr.message };
        }
        break;
      }
      case '/api/switch-project': {
        const targetDb = url.searchParams.get('db');
        const registeredInstances = getRegisteredInstances();
        const targetInstance = targetDb ? registeredInstances.find(i => i.dbPath === targetDb) : null;
        if (targetInstance && switchProject(targetDb)) {
          state.currentProject = targetInstance.projectDir;
          data = { ok: true, db: targetDb, project: state.currentProject };
        } else {
          data = { ok: false, error: 'Failed to switch' };
        }
        break;
      }
      case '/api/knowledge/search':
        data = q.searchKnowledge(
          state,
          url.searchParams.get('q') || '',
          Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000)
        );
        break;
      case '/api/graph': {
        const entity = url.searchParams.get('entity') || '';
        const depth = Math.min(parseInt(url.searchParams.get('depth') || '2', 10), 5);
        data = q.getGraphData(state, entity, depth);
        // Clamp total nodes+edges to 1000
        if (data.nodes.length > 1000) data.nodes = data.nodes.slice(0, 1000);
        if (data.edges.length > 1000) data.edges = data.edges.slice(0, 1000);
        break;
      }
      case '/api/timeline-range': {
        const from = parseInt(url.searchParams.get('from') || '0', 10);
        const to = parseInt(url.searchParams.get('to') || String(Date.now()), 10);
        const trType = url.searchParams.get('type') || '';
        data = q.getTimelineRange(state, from, to, trType || null, Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 1000));
        break;
      }
      case '/api/agents': {
        data = q.getAgents(state);
        break;
      }
      case '/api/search-analytics': {
        const topEntries = db.prepare(
          'SELECT id, title, category, access_count FROM knowledge WHERE archived = 0 ORDER BY access_count DESC LIMIT 10'
        ).all();
        const categoryBreakdown = db.prepare(
          'SELECT category, COUNT(*) as count FROM knowledge WHERE archived = 0 GROUP BY category'
        ).all();
        let totalSearches = 0;
        try {
          const row = db.prepare("SELECT COUNT(*) as count FROM token_stats WHERE event_type = 'search'").get();
          totalSearches = row?.count || 0;
        } catch {}
        data = { top_entries: topEntries, category_breakdown: categoryBreakdown, total_searches: totalSearches };
        break;
      }
      case '/api/health-score': {
        const now = Date.now();
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        const sevenDays = 7 * 24 * 60 * 60 * 1000;

        const totalK = db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE archived = 0').get();
        const freshK = db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE archived = 0 AND last_accessed > ?').get(now - fourteenDays);
        const freshness = totalK.cnt > 0 ? (freshK.cnt / totalK.cnt) : 0;

        const cats = db.prepare('SELECT COUNT(DISTINCT category) as cnt FROM knowledge WHERE archived = 0').get();
        const coverage = Math.min(1, (cats.cnt || 0) / 5);

        const recentObs = db.prepare('SELECT COUNT(*) as cnt FROM observations WHERE indexed_at > ?').get(now - sevenDays);
        const activity = Math.min(1, (recentObs.cnt || 0) / 100);

        let staleRatio = 1;
        try {
          const staleCount = db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE stale = 1').get();
          staleRatio = totalK.cnt > 0 ? 1 - Math.min(1, (staleCount.cnt || 0) / totalK.cnt) : 1;
        } catch {}

        let sessionCont = 0;
        try {
          const totalSess = db.prepare('SELECT COUNT(DISTINCT session_id) as cnt FROM token_stats').get();
          const chainedSess = db.prepare('SELECT COUNT(*) as cnt FROM session_chains').get();
          sessionCont = totalSess.cnt > 0 ? Math.min(1, (chainedSess.cnt || 0) / totalSess.cnt) : 0;
        } catch {}

        const score = Math.round(freshness * 30 + coverage * 25 + activity * 20 + staleRatio * 15 + sessionCont * 10);

        data = {
          score,
          breakdown: {
            knowledge_freshness: Math.round(freshness * 100),
            knowledge_coverage: Math.round(coverage * 100),
            observation_activity: Math.round(activity * 100),
            contradiction_free: Math.round(staleRatio * 100),
            session_continuity: Math.round(sessionCont * 100),
          },
        };
        break;
      }
      case '/api/time-diff': {
        const from = parseInt(url.searchParams.get('from') || '0');
        const to = parseInt(url.searchParams.get('to') || String(Date.now()));
        const added = db.prepare(
          'SELECT id, title, category, created_at FROM knowledge WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 50'
        ).all(from, to);
        const obsRows = db.prepare(
          'SELECT type, COUNT(*) as cnt FROM observations WHERE indexed_at >= ? AND indexed_at <= ? GROUP BY type'
        ).all(from, to);
        data = { knowledge_added: added, observations: obsRows };
        break;
      }
      // --- Intelligence layer endpoints (v2.6.0) ---
      case '/api/search-fusion':
        data = q.searchWithPipeline(
          state,
          url.searchParams.get('q') || '',
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100),
          url.searchParams.get('type') || null
        );
        break;
      case '/api/contradictions':
        data = q.getContradictions(
          state,
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
        );
        break;
      case '/api/llm-status':
        data = q.getLLMStatus(state);
        break;
      case '/api/knowledge-authority':
        data = q.getKnowledgeWithAuthority(
          state,
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100),
          url.searchParams.get('category') || null
        );
        break;
      // --- Total Recall API routes ---
      case '/api/importance-distribution':
        data = q.getImportanceDistribution(state);
        break;
      case '/api/compression-tiers':
        data = q.getCompressionTiers(state);
        break;
      case '/api/significance-flags':
        data = q.getSignificanceFlags(state);
        break;
      case '/api/topics':
        data = q.getTopicsList(state, Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200));
        break;
      case '/api/topic-observations':
        data = q.getTopicObservations(
          state,
          url.searchParams.get('topic') || '',
          Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
        );
        break;
      case '/api/entities-summary':
        data = q.getEntitiesSummary(state);
        break;
      case '/api/people':
        data = q.getPeopleList(state, Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100));
        break;
      case '/api/temporal-facts':
        data = q.getTemporalFacts(state);
        break;
      case '/api/pressure':
        data = q.getPressureEntries(state, Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50));
        break;
      case '/api/wake-up-preview':
        data = q.getWakeUpPreview(state);
        break;
      case '/api/decision-trail':
        data = q.getDecisionTrail(state, url.searchParams.get('q') || '');
        break;
      case '/api/narrative': {
        const narrative = q.generateNarrativeApi(
          state,
          url.searchParams.get('format') || 'pr',
          url.searchParams.get('session') || null,
          url.searchParams.get('topic') || null
        );
        data = { narrative, format: url.searchParams.get('format') || 'pr' };
        break;
      }
      case '/api/pinned':
        data = q.getPinnedObservations(state, Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100));
        break;
      case '/api/tunnels':
        data = q.getTunnels(state);
        break;
      case '/api/compression-analytics':
        data = q.getCompressionAnalytics(state);
        break;
      case '/api/diagnostics': {
        const mode = url.searchParams.get('mode') === 'list' ? 'list' : 'summary';
        const since = parseInt(url.searchParams.get('since') || String(Date.now() - 3600000), 10);
        const severity = url.searchParams.get('severity');
        const category = url.searchParams.get('category');
        const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '50', 10)));

        let rows;
        if (mode === 'list') {
          const clauses = ['timestamp >= ?'];
          const args = [since];
          if (severity) { clauses.push('severity = ?'); args.push(severity); }
          if (category) { clauses.push('category = ?'); args.push(category); }
          rows = db.prepare(
            `SELECT id, timestamp, severity, category, message, occurrences, first_seen, last_seen, stack
             FROM error_log
             WHERE ${clauses.join(' AND ')}
             ORDER BY timestamp DESC
             LIMIT ?`
          ).all(...args, limit);
        } else {
          const clauses = ['timestamp >= ?'];
          const args = [since];
          if (severity) { clauses.push('severity = ?'); args.push(severity); }
          if (category) { clauses.push('category = ?'); args.push(category); }
          rows = db.prepare(
            `SELECT category, message, severity,
                    SUM(occurrences) as count,
                    MIN(first_seen) as first_seen,
                    MAX(last_seen) as last_seen
             FROM error_log
             WHERE ${clauses.join(' AND ')}
             GROUP BY category, message_hash, severity
             ORDER BY last_seen DESC
             LIMIT ?`
          ).all(...args, limit);
        }
        data = { mode, rows };
        break;
      }
      default:
        // Path-based observation lookup: /api/observation/<id>
        if (route.startsWith('/api/observation/')) {
          const obsId = decodeURIComponent(route.split('/').pop());
          data = q.getObservation(state, obsId);
          break;
        }
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = { handleApi };
