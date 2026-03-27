# Phase 5 Design Spec — Time-Travel, NL Query, Dashboard 2.0

**Goal:** Complete the v2.0.0 Intelligence Layer with the final 3 features.

**Architecture:** Three independent subsystems, all building on existing infrastructure.

---

## Feature 1: Time-Travel Debugging

### Problem
"What was the project state 3 days ago?" — currently impossible without git log.

### Design

**New MCP tool: `time_travel`**

```typescript
{
  name: 'time_travel',
  inputSchema: {
    properties: {
      date: { type: 'string', description: 'ISO date or relative ("3 days ago", "last week")' },
      scope: { type: 'string', enum: ['knowledge', 'observations', 'events', 'all'], description: 'What to show (default: all)' },
      compare: { type: 'boolean', description: 'Compare then vs now (show delta)' },
    },
    required: ['date'],
  },
}
```

**Handler logic:**
1. Parse date (ISO or relative via simple parser: "N days/hours/weeks ago")
2. Query observations/knowledge/events WHERE created_at <= target_date
3. If compare=true, also query current state and compute delta:
   - Knowledge added/removed/changed since then
   - Observations count then vs now
   - Events timeline between then and now

**New file: `src/core/time-travel.ts`**

```typescript
export class TimeTraveler {
  constructor(private storage: StoragePlugin) {}

  snapshot(targetDate: number, scope: string): TimeSnapshot {
    // Query each table with WHERE created_at <= targetDate
  }

  compare(targetDate: number): TimeDelta {
    // Diff between targetDate state and current state
  }

  parseDate(input: string): number {
    // "3 days ago" → Date.now() - 3*24*60*60*1000
    // "2026-03-25" → new Date('2026-03-25').getTime()
    // "last week" → Date.now() - 7*24*60*60*1000
  }
}
```

### Files
- Create: `src/core/time-travel.ts`
- Create: `src/tests/core/time-travel.test.ts`
- Modify: `src/mcp-server/tools.ts` — add time_travel tool + handler
- Modify: `src/mcp-server/server.ts` — register tool

---

## Feature 2: Natural Language Query Engine

### Problem
"What did we decide about authentication?" requires knowing exact keywords. Users want to ask questions naturally.

### Design

**Approach:** Query decomposition + multi-strategy search. No external LLM required — uses existing search infrastructure intelligently.

**New MCP tool: `ask`**

```typescript
{
  name: 'ask',
  inputSchema: {
    properties: {
      question: { type: 'string', description: 'Natural language question about the project' },
    },
    required: ['question'],
  },
}
```

**Handler logic:**
1. Extract key terms from question (remove stop words, extract nouns/verbs)
2. Classify question intent:
   - "what" → search knowledge + observations
   - "when" → search events + timeline
   - "who" → search agents + graph (person entities)
   - "why" → search decisions + knowledge
   - "how" → search patterns + code observations
3. Run parallel searches:
   - Knowledge base search (FTS5)
   - Observation search (FTS5)
   - Graph query (if entities match)
   - Event query (if time-related)
4. Merge and rank results by relevance
5. Format as a coherent answer

**New file: `src/core/nl-query.ts`**

```typescript
export class NaturalLanguageQuery {
  constructor(
    private storage: StoragePlugin,
    private knowledgeBase: KnowledgeBase,
    private knowledgeGraph: KnowledgeGraph,
    private eventTracker: EventTracker,
  ) {}

  async ask(question: string): Promise<NLAnswer> {
    const intent = this.classifyIntent(question);
    const terms = this.extractTerms(question);
    const results = await this.parallelSearch(terms, intent);
    return this.formatAnswer(question, results);
  }

  private classifyIntent(q: string): 'what' | 'when' | 'who' | 'why' | 'how' | 'general' {
    const lower = q.toLowerCase();
    if (lower.startsWith('what') || lower.includes('what ')) return 'what';
    if (lower.startsWith('when') || lower.includes('when ')) return 'when';
    if (lower.startsWith('who') || lower.includes('who ')) return 'who';
    if (lower.startsWith('why') || lower.includes('why ')) return 'why';
    if (lower.startsWith('how') || lower.includes('how ')) return 'how';
    return 'general';
  }

  private extractTerms(q: string): string[] {
    const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'did', 'does', 'have', 'has', 'had', 'been', 'being', 'be', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'about', 'we', 'our', 'us', 'i', 'you', 'it', 'this', 'that']);
    return q.toLowerCase().replace(/[?!.,;:]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
  }
}
```

### Files
- Create: `src/core/nl-query.ts`
- Create: `src/tests/core/nl-query.test.ts`
- Modify: `src/mcp-server/tools.ts` — add ask tool + handler
- Modify: `src/mcp-server/server.ts` — register tool
- Modify: `src/core/kernel.ts` — initialize NaturalLanguageQuery

---

## Feature 3: Dashboard 2.0

### Problem
Current dashboard is functional but basic. Needs graph visualization, timeline explorer, and search analytics.

### Design

**Additive changes to `dashboard/server.js`:**

### 3a. Knowledge Graph Visualization
- New API: `/api/graph?entity=<name>&depth=<n>`
- Returns nodes + edges JSON for D3.js
- Client-side: Force-directed graph using inline D3 (no build step)
- Interactive: click node to see details, drag to rearrange

### 3b. Timeline Explorer
- New API: `/api/timeline-range?from=<ts>&to=<ts>&type=<filter>`
- Client-side: Zoomable timeline with time range selector
- Filter by observation type, search within range
- Show knowledge deltas between dates (time-travel integration)

### 3c. Search Analytics
- New API: `/api/search-analytics`
- Track: top queries, cache hit rate, average response time
- Store in a simple `search_stats` table
- Dashboard panel with top 10 queries, hit/miss ratio

### 3d. Agent Status Panel
- New API: `/api/agents` — reads agents.json
- Shows active agents, their tasks, claimed files
- Live updates via WebSocket

### 3e. Dark/Light Theme
- CSS variables for theme colors
- Toggle button in header
- Preference saved in localStorage

### Files
- Modify: `dashboard/server.js` — new APIs + client-side visualizations
- No new dependencies (D3.js loaded via CDN or inline minimal version)

---

## Summary: 3 New MCP Tools

| Tool | Purpose |
|------|---------|
| `time_travel` | View/compare project state at any point in time |
| `ask` | Natural language questions about the project |
| (Dashboard 2.0 is API-only, no MCP tool) | |

**Total after Phase 5: 29 MCP tools**

---

## Tests Target

- Time-Travel: 8 tests (date parsing, snapshot, compare, scopes)
- NL Query: 10 tests (intent classification, term extraction, parallel search, answer formatting)
- Dashboard: manual testing (visual features)

Total: 18+ new tests
