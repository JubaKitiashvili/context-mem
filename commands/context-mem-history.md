---
name: context-mem-history
description: Show session chain history — previous sessions, their summaries, and token usage
allowed-tools: Bash
---

Show the session chain history for this project.

1. Query the database for chain history:
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const db = new Database('.context-mem/store.db', { readonly: true });

   try {
     const tableExists = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='session_chains'\").get();
     if (!tableExists) {
       console.log('No session chain data. Session chaining is available in context-mem v2.1.0+.');
       process.exit(0);
     }

     const chains = db.prepare('SELECT * FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 20').all(process.cwd());

     if (!chains.length) {
       console.log('No session history for this project yet.');
       process.exit(0);
     }

     console.log(JSON.stringify(chains.map(c => ({
       session_id: c.session_id.slice(0,8),
       summary: c.summary || 'no summary',
       tokens: c.token_estimate ? Math.round(c.token_estimate / 1000) + 'K' : '?',
       reason: c.handoff_reason,
       created: c.created_at,
       parent: c.parent_session ? c.parent_session.slice(0,8) : null
     }))));
   } catch (e) {
     console.log('Error reading chain history: ' + e.message);
   }
   db.close();
   "
   ```

2. Present results as a timeline:
   ```
   context-mem session history
   ───────────────────────────
   Session 3 (current) — 1h 23m, ~340K tokens
     > Session handoff design, PreCompact hook
   Session 2 — 45m, ~280K tokens
     > Multi-agent system, v1.4.0 release
   Session 1 — 2h 10m, ~890K tokens
     > Knowledge graph, proactive injection, v1.2.0-1.3.0
   ```

3. If the user asks about a specific session, offer to restore it using the `restore_session` MCP tool.
