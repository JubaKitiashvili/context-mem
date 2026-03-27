---
name: search
description: Search context-mem observations — find past code, errors, decisions, and context
argument-hint: <query>
allowed-tools: Bash
---

Search stored observations using context-mem's 4-layer search (BM25 + Trigram + Levenshtein + Vector).

Query the database directly using BM25 full-text search:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('.context-mem/store.db', { readonly: true });
const query = process.argv[1];
const sanitized = query.replace(/[^\w\s-]/g, '').split(/\s+/).filter(t => t).map(t => '\"' + t + '\"').join(' OR ');
const rows = db.prepare('SELECT o.id, o.type, substr(COALESCE(o.summary, o.content), 1, 200) as snippet, o.indexed_at FROM obs_fts f JOIN observations o ON o.rowid = f.rowid WHERE obs_fts MATCH ? ORDER BY bm25(obs_fts) LIMIT 10').all(sanitized);
rows.forEach((r, i) => console.log((i+1) + '. [' + r.type + '] ' + r.snippet.replace(/\n/g, ' ')));
if (!rows.length) console.log('No results found for: ' + query);
db.close();
" "ARGUMENTS"
```

Replace `ARGUMENTS` with the user's search query.

Present results clearly with type badges and snippets. If results are found, offer to show full content or `/context-mem:status` for more details.
