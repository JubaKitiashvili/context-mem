---
name: status
description: Show context-mem status — observation count, token savings, search capabilities, and dashboard link
allowed-tools: Bash, Read
---

Show the current context-mem status for this project.

1. Read `.context-mem.json` to check configuration (search plugins, lifecycle settings)

2. Read the database directly for stats:
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const db = new Database('.context-mem/store.db', { readonly: true });
   const obs = db.prepare('SELECT COUNT(*) as c FROM observations').get();
   const embedded = db.prepare('SELECT COUNT(*) as c FROM observations WHERE embeddings IS NOT NULL').get();
   const stats = db.prepare('SELECT COALESCE(SUM(tokens_in),0) as t_in, COALESCE(SUM(tokens_out),0) as t_out FROM token_stats').get();
   const pct = stats.t_in > 0 ? Math.round(((stats.t_in - stats.t_out) / stats.t_in) * 100) : 0;
   console.log('Observations:', obs.c, '| Embedded:', embedded.c, '| Savings:', pct + '%');
   db.close();
   "
   ```

3. Check if activity journal exists and report its size:
   ```bash
   wc -l .context-mem/journal.md 2>/dev/null || echo "No journal yet"
   ```

4. Present results in a clean format:
   ```
   context-mem status
   ─────────────────
   Observations:  142
   Embedded:      142 (vector search active)
   Token savings: 83%
   Journal:       47 entries
   Search:        bm25 + trigram + levenshtein + vector
   Dashboard:     http://localhost:51893
   ```
