# Proactive Context Injection Design Spec — v2.0.0 Phase 3

**Goal:** Auto-inject relevant knowledge and observations into Claude's context when it reads/edits files, without Claude explicitly calling `search`. Like GitHub Copilot's contextual suggestions but for memory.

**Architecture:** PostToolUse hook analyzes tool activity and injects relevant context via hook stdout. Rate-limited to prevent noise. Configurable threshold.

**Tech Stack:** Node.js hooks (existing infrastructure), SQLite queries, no new dependencies

---

## How It Works

### Trigger: PostToolUse Hook

When Claude reads or edits a file, the existing `context-mem-hook.js` fires. We add a new hook `proactive-inject.js` that:

1. Detects what file/module Claude is working on
2. Searches knowledge base + graph for related entries
3. Returns relevant context as hook stdout (injected into Claude's context)

### Injection Flow

```
Claude reads auth.ts
  → PostToolUse fires
  → proactive-inject.js receives { tool_name: "Read", tool_input: { file_path: "src/auth.ts" } }
  → Queries: knowledge entries about "auth", graph neighbors of "auth.ts" entity
  → Returns: "Context: Last session fixed JWT refresh bug in auth.ts. Known edge case: token expiry during SSO flow."
```

### What Gets Injected

| Tool Action | Query Strategy |
|------------|---------------|
| Read file | Search knowledge by filename + module name, graph neighbors |
| Edit file | Search for past edits to same file, related decisions |
| Bash (test) | Search for known test failures, error patterns |
| Bash (build) | Search for build issues, dependency notes |
| Search (repeated) | Skip — Claude is already searching |

### Rate Limiting

- Max 3 injections per minute (prevent flooding)
- Cooldown per file — same file only injected once per 5 minutes
- Minimum relevance score threshold: 0.6 (configurable)
- Max injection size: 500 chars (configurable)

---

## New Hook: `hooks/proactive-inject.js`

```javascript
// PostToolUse hook — proactive context injection
// Fires after Read, Edit, Bash
// Returns relevant context as stdout

const toolName = data.tool_name;
const toolInput = data.tool_input || {};

// Skip if not a relevant tool
if (!['Read', 'Edit', 'Bash'].includes(toolName)) process.exit(0);

// Rate limit check
const now = Date.now();
if (recentInjections >= MAX_INJECTIONS_PER_MINUTE) process.exit(0);
if (lastInjectionForFile[filePath] > now - COOLDOWN_MS) process.exit(0);

// Extract context query
const filePath = toolInput.file_path;
const query = extractQueryFromAction(toolName, toolInput);

// Search knowledge + graph
const results = searchRelevantContext(query, filePath);

// Filter by relevance threshold
const relevant = results.filter(r => r.score >= THRESHOLD);
if (relevant.length === 0) process.exit(0);

// Format and output
const injection = formatInjection(relevant);
console.log(injection);
```

### Query Strategy

```javascript
function extractQueryFromAction(toolName, input) {
  switch (toolName) {
    case 'Read':
    case 'Edit':
      // Extract filename, module name, directory context
      const parts = input.file_path.split('/');
      const filename = parts[parts.length - 1].replace(/\.\w+$/, '');
      const dirContext = parts.slice(-3, -1).join(' ');
      return `${filename} ${dirContext}`;

    case 'Bash':
      // Extract command context
      const cmd = input.command || '';
      if (cmd.includes('test')) return 'test failures known issues';
      if (cmd.includes('build') || cmd.includes('npm run')) return 'build errors dependencies';
      return null; // Skip other bash commands
  }
}
```

### Search Pipeline

```javascript
function searchRelevantContext(query, filePath) {
  const results = [];

  // 1. Knowledge base search (uses existing FTS5 + decay)
  const knowledge = db.prepare(`
    SELECT title, content, category, access_count
    FROM knowledge WHERE archived = 0
    AND knowledge_fts MATCH ?
    ORDER BY access_count DESC LIMIT 3
  `).all(sanitizeFTS5(query));

  // 2. Graph neighbors (if file entity exists)
  const fileEntity = db.prepare(
    "SELECT id FROM entities WHERE name = ? AND entity_type = 'file'"
  ).get(filePath);

  if (fileEntity) {
    const neighbors = db.prepare(`
      SELECT e.name, e.entity_type, r.relationship_type
      FROM relationships r
      JOIN entities e ON (e.id = r.from_entity OR e.id = r.to_entity) AND e.id != ?
      WHERE r.from_entity = ? OR r.to_entity = ?
      LIMIT 5
    `).all(fileEntity.id, fileEntity.id, fileEntity.id);
    results.push(...neighbors.map(n => ({
      text: `${n.relationship_type}: ${n.name} (${n.entity_type})`,
      score: 0.7,
    })));
  }

  // 3. Recent observations about this file
  const recentObs = db.prepare(`
    SELECT substr(COALESCE(summary, content), 1, 200) as text
    FROM observations
    WHERE json_extract(metadata, '$.file_path') = ?
    AND type IN ('error', 'decision')
    ORDER BY indexed_at DESC LIMIT 2
  `).all(filePath);

  return [...knowledge.map(k => ({ text: `${k.category}: ${k.title}`, score: 0.8 })), ...results, ...recentObs.map(o => ({ text: o.text, score: 0.6 }))];
}
```

### Output Format

```javascript
function formatInjection(results) {
  const lines = results.slice(0, 3).map(r => `- ${r.text}`);
  return `[context-mem] Relevant context:\n${lines.join('\n')}`;
}
```

---

## Configuration

```json
// .context-mem.json
{
  "proactive_injection": {
    "enabled": true,
    "max_injections_per_minute": 3,
    "file_cooldown_seconds": 300,
    "relevance_threshold": 0.6,
    "max_injection_chars": 500,
    "inject_on": ["Read", "Edit"]
  }
}
```

Default: enabled with conservative settings. Users can disable or tune.

---

## Hook Registration

Add to `hooks/hooks.json`:

```json
{
  "PostToolUse": [
    {
      "matcher": "Read|Edit|Bash",
      "hooks": [
        // ... existing hooks ...
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/proactive-inject.js\"",
          "timeout": 3
        }
      ]
    }
  ]
}
```

---

## State Management

Rate limiting state stored in memory (per-process) via a simple JSON file:

```
.context-mem/inject-state.json
{
  "last_injections": [1711500000000, 1711500010000],
  "file_cooldowns": {
    "src/auth.ts": 1711500000000
  }
}
```

Written atomically on each injection. Read at hook start. Cleaned up periodically.

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `hooks/proactive-inject.js` |
| Modify | `hooks/hooks.json` — add proactive-inject to PostToolUse |
| Modify | `src/core/types.ts` — add proactive_injection config |
| Modify | `.context-mem.json.example` — document new config |
| Create | `src/tests/hooks/proactive-inject.test.ts` |

---

## Tests

- Injects context when reading a file with known knowledge entries
- Respects rate limit (no injection after 3 in 1 minute)
- Respects file cooldown (no re-injection within 5 minutes)
- Respects relevance threshold (low-score results filtered)
- Returns nothing for unknown files
- Graph neighbors included when entity exists
- Disabled when config says false
- Max chars truncation works
- Bash test/build commands trigger appropriate searches

---

## Backwards Compatibility

- New hook is additive (existing hooks unchanged)
- Disabled by default in config: no — **enabled by default** with conservative settings
- If .context-mem/store.db doesn't exist, hook exits silently
- If no relevant context found, hook outputs nothing (no noise)
