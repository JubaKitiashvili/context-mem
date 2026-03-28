---
name: context-mem-status
description: Show session status — estimated token usage, session duration, observation count, and session chain
allowed-tools: Bash
---

Show the current session status including token estimation and session chain.

1. Query the database for session stats:
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const path = require('path');
   const db = new Database('.context-mem/store.db', { readonly: true });

   // Observations
   const obs = db.prepare('SELECT COUNT(*) as c FROM observations').get();

   // Token stats
   const stats = db.prepare('SELECT COALESCE(SUM(tokens_in),0) as used FROM token_stats').get();
   const limit = 1000000;
   const pct = Math.round((stats.used / limit) * 100);

   // Session chain
   let chainInfo = 'No chain data';
   try {
     const tableExists = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='session_chains'\").get();
     if (tableExists) {
       const chains = db.prepare('SELECT session_id, summary, token_estimate, created_at FROM session_chains WHERE project_path = ? ORDER BY created_at DESC LIMIT 5').all(process.cwd());
       if (chains.length) {
         chainInfo = chains.map((c, i) => {
           const label = i === 0 ? '(current)' : '';
           const tokens = c.token_estimate ? Math.round(c.token_estimate / 1000) + 'K' : '?';
           return c.session_id.slice(0,8) + ' ' + label + ' — ' + (c.summary || 'no summary') + ' [' + tokens + ' tokens]';
         }).join('\\n  ');
       }
     }
   } catch {}

   // Compactions
   const compactions = db.prepare(\"SELECT COUNT(*) as c FROM token_stats WHERE event_type = 'compaction'\").get();

   console.log(JSON.stringify({
     tokens_used: stats.used,
     tokens_limit: limit,
     tokens_pct: pct,
     observations: obs.c,
     compactions: compactions.c,
     chain: chainInfo
   }));
   db.close();
   "
   ```

2. Present results in a clean format:
   ```
   context-mem session status
   ──────────────────────────
   Estimated tokens: ~340K / 1M (34%)
   Observations:     47 stored
   Compactions:      1
   Chain:
     abc12345 (current) — Session handoff design [340K tokens]
     def67890 — Multi-agent system, v1.4.0 release [280K tokens]
   ```
