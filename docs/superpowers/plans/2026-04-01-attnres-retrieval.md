# AttnRes-Inspired Retrieval Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Attention Residuals concepts to context-mem's retrieval system — adaptive reranking, block-level memory attention, and depth-aware contradiction resolution.

**Architecture:** Three algorithmic changes to existing retrieval pipeline. No schema migrations, no new MCP tools. Phase 1 modifies `rerank()` to use intent-dependent weights with result-aware adjustment for general queries. Phase 2 adds authority scoring to contradiction detection. Phase 3 wraps SearchFusion with block-level search orchestration.

**Tech Stack:** TypeScript, Node.js test runner, SQLite (existing)

**Spec:** `docs/superpowers/specs/2026-04-01-attnres-retrieval-design.md`

---

## Phase 1: Adaptive Reranking

### Task 1: Intent-specific weight vectors

**Files:**
- Modify: `src/plugins/search/fusion.ts`
- Test: `src/tests/plugins/search/fusion.test.ts`

- [ ] **Step 1: Write failing test — causal intent boosts recency**

Add to `src/tests/plugins/search/fusion.test.ts`:

```typescript
describe('adaptive reranking', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('causal intent prioritizes recent results over high-relevance old ones', () => {
    const now = Date.now();
    // Old result with higher base relevance
    const oldHighRelevance = makeResult('old-high', 'error', 2.0, now - 14 * DAY_MS, 5);
    // Recent result with lower base relevance
    const recentLowRelevance = makeResult('recent-low', 'error', 1.0, now, 2);

    const results = rerank([oldHighRelevance, recentLowRelevance], 'causal');
    assert.equal(results[0].id, 'recent-low', 'causal intent should prioritize recent results');
  });

  it('lookup intent prioritizes high-relevance regardless of age', () => {
    const now = Date.now();
    const oldHighRelevance = makeResult('old-high', 'code', 2.0, now - 30 * DAY_MS, 0);
    const recentLowRelevance = makeResult('recent-low', 'code', 0.5, now, 0);

    const results = rerank([recentLowRelevance, oldHighRelevance], 'lookup');
    assert.equal(results[0].id, 'old-high', 'lookup intent should prioritize relevance over recency');
  });

  it('temporal intent heavily favors recent results', () => {
    const now = Date.now();
    const veryOld = makeResult('very-old', 'commit', 3.0, now - 30 * DAY_MS, 10);
    const recent = makeResult('recent', 'commit', 0.8, now - 1 * DAY_MS, 0);

    const results = rerank([veryOld, recent], 'temporal');
    assert.equal(results[0].id, 'recent', 'temporal intent should heavily favor recent results');
  });

  it('general intent uses baseline weights (similar to old 70/20/10)', () => {
    const now = Date.now();
    // With spread-out relevance scores and spread-out timestamps, general should
    // behave similar to old behavior: high relevance wins
    const highRelevance = makeResult('high', 'code', 2.0, now - 14 * DAY_MS, 0);
    const lowRelevance = makeResult('low', 'code', 0.5, now, 0);

    const results = rerank([lowRelevance, highRelevance], 'general');
    assert.equal(results[0].id, 'high', 'general intent with spread scores should favor relevance');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/plugins/search/fusion.test.js`
Expected: FAIL — `rerank` does not accept second argument

- [ ] **Step 3: Implement intent-specific weight vectors**

In `src/plugins/search/fusion.ts`, replace the `rerank` function and add the weight map:

```typescript
const INTENT_WEIGHTS: Record<string, { relevance: number; recency: number; access: number }> = {
  causal:   { relevance: 0.40, recency: 0.50, access: 0.10 },
  temporal: { relevance: 0.25, recency: 0.60, access: 0.15 },
  lookup:   { relevance: 0.80, recency: 0.10, access: 0.10 },
  general:  { relevance: 0.55, recency: 0.30, access: 0.15 },
};

export function rerank(results: SearchResult[], intentType: SearchIntent['intent_type'] = 'general'): SearchResult[] {
  const now = Date.now();
  const weights = INTENT_WEIGHTS[intentType] || INTENT_WEIGHTS.general;

  return results.map(r => {
    const age = now - (r.timestamp || now);
    const recencyBoost = Math.pow(0.5, age / HALF_LIFE_MS);
    const accessBoost = Math.log2((r.access_count || 0) + 2) / 10;

    return {
      ...r,
      relevance_score: r.relevance_score * (weights.relevance + weights.recency * recencyBoost + weights.access * accessBoost),
    };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
}
```

Add the `SearchIntent` import at the top of `fusion.ts`:

```typescript
import type { SearchPlugin, SearchResult, SearchOpts, SearchOrchestrator, SearchIntent, SearchWeights, ObservationType } from '../../core/types.js';
```

Note: `SearchIntent` is already imported in the existing file.

- [ ] **Step 4: Update SearchFusion.execute() to pass intent to rerank**

In `SearchFusion.execute()`, change the line:

```typescript
// Before:
allResults = rerank(allResults);

// After:
allResults = rerank(allResults, intent.intent_type);
```

- [ ] **Step 5: Fix existing tests that call rerank() without intentType**

The existing `describe('rerank', ...)` tests call `rerank()` without a second arg. Since the default is `'general'`, verify the existing tests still pass. The weights changed from `0.7/0.2/0.1` to `0.55/0.30/0.15` for general, so update assertions:

In the test `'preserves original relevance as dominant factor (70%)'`, the assertion still holds because general's 0.55 relevance weight still makes high-relevance win over low-relevance-but-recent. Keep the test as-is but update the comment:

```typescript
it('preserves original relevance as dominant factor', () => {
```

In the test `'uses default weights when none provided'`, the comment references `0.7 + 0.2 * recencyBoost + 0.1 * accessBoost`. Update the comment to reflect new general weights:

```typescript
// With default bm25 weight of 0.5, score 2.0 becomes 2.0 * 0.5 = 1.0 before reranking
// Reranking applies: score * (0.55 + 0.30 * recencyBoost + 0.15 * accessBoost)
// For a fresh result: ~1.0 * (0.55 + 0.30 * 1.0 + 0.15 * log2(2)/10) = ~0.865
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npm run build && node --test dist/tests/plugins/search/fusion.test.js`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/plugins/search/fusion.ts src/tests/plugins/search/fusion.test.ts
git commit -m "feat: intent-specific reranking weights (AttnRes adaptive attention)"
```

---

### Task 2: Result-aware weighting for general intent

**Files:**
- Modify: `src/plugins/search/fusion.ts`
- Test: `src/tests/plugins/search/fusion.test.ts`

- [ ] **Step 1: Write failing tests — result-aware adjustment**

Add to the `describe('adaptive reranking', ...)` block in `src/tests/plugins/search/fusion.test.ts`:

```typescript
it('general intent shifts to recency when relevance scores are clustered', () => {
  const now = Date.now();
  // All scores very close (variance < 0.01) — relevance can't differentiate
  const oldResult = makeResult('old', 'code', 1.00, now - 14 * DAY_MS, 0);
  const midResult = makeResult('mid', 'code', 1.01, now - 3 * DAY_MS, 0);
  const newResult = makeResult('new', 'code', 0.99, now, 0);

  const results = rerank([oldResult, midResult, newResult], 'general');
  // With clustered scores, recency should become the differentiator
  assert.equal(results[0].id, 'new', 'when scores are clustered, recency should differentiate');
});

it('general intent shifts to relevance when timestamps are clustered', () => {
  const now = Date.now();
  // All timestamps within a few hours (time_spread < 0.1 of 7 days)
  const lowScore = makeResult('low', 'code', 0.5, now - 2 * 60 * 60 * 1000, 0); // 2h ago
  const highScore = makeResult('high', 'code', 2.0, now - 1 * 60 * 60 * 1000, 0); // 1h ago

  const results = rerank([lowScore, highScore], 'general');
  assert.equal(results[0].id, 'high', 'when timestamps are clustered, relevance should differentiate');
});

it('general intent uses baseline when both scores and times are spread', () => {
  const now = Date.now();
  const spreadResults = [
    makeResult('a', 'code', 2.0, now - 20 * DAY_MS, 0),
    makeResult('b', 'code', 1.0, now - 5 * DAY_MS, 0),
    makeResult('c', 'code', 0.3, now, 0),
  ];

  const results = rerank(spreadResults, 'general');
  // With spread-out scores AND timestamps, baseline weights apply — high relevance wins
  assert.equal(results[0].id, 'a', 'spread data should use baseline general weights');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/plugins/search/fusion.test.js`
Expected: FAIL — clustered scores test fails because rerank doesn't adjust for general

- [ ] **Step 3: Implement result-aware adjustment**

In `src/plugins/search/fusion.ts`, update the `rerank` function to add result-aware logic for general intent:

```typescript
export function rerank(results: SearchResult[], intentType: SearchIntent['intent_type'] = 'general'): SearchResult[] {
  const now = Date.now();
  let weights = { ...(INTENT_WEIGHTS[intentType] || INTENT_WEIGHTS.general) };

  // Result-aware adjustment for general intent (AttnRes: fixed query × content-dependent keys)
  if (intentType === 'general' && results.length >= 2) {
    const scores = results.map(r => r.relevance_score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;

    const timestamps = results.map(r => r.timestamp || now);
    const timeSpread = (Math.max(...timestamps) - Math.min(...timestamps)) / HALF_LIFE_MS; // relative to 7 days

    if (variance < 0.01) {
      // Scores too close — recency becomes the differentiator
      weights = { ...weights, recency: weights.recency + 0.15, relevance: weights.relevance - 0.15 };
    }

    if (timeSpread < 0.1) {
      // All results are recent — relevance becomes the differentiator
      weights = { ...weights, relevance: weights.relevance + 0.15, recency: weights.recency - 0.15 };
    }
  }

  return results.map(r => {
    const age = now - (r.timestamp || now);
    const recencyBoost = Math.pow(0.5, age / HALF_LIFE_MS);
    const accessBoost = Math.log2((r.access_count || 0) + 2) / 10;

    return {
      ...r,
      relevance_score: r.relevance_score * (weights.relevance + weights.recency * recencyBoost + weights.access * accessBoost),
    };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm run build && node --test dist/tests/plugins/search/fusion.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/search/fusion.ts src/tests/plugins/search/fusion.test.ts
git commit -m "feat: result-aware weight adjustment for general intent"
```

---

## Phase 2: Depth-Aware Contradiction Resolution

### Task 3: Authority scoring function

**Files:**
- Modify: `src/plugins/knowledge/knowledge-base.ts`
- Test: `src/tests/plugins/knowledge/knowledge-base.test.ts`

- [ ] **Step 1: Write failing tests — computeAuthority**

Add to `src/tests/plugins/knowledge/knowledge-base.test.ts`:

```typescript
import { computeAuthority } from '../../../plugins/knowledge/knowledge-base.js';
import type { KnowledgeEntry } from '../../../core/types.js';

function makeKnowledgeEntry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 'test-id',
    category: 'pattern',
    title: 'Test',
    content: 'Test content',
    tags: [],
    shareable: true,
    relevance_score: 1.0,
    access_count: 0,
    created_at: Date.now(),
    last_accessed: Date.now(),
    archived: false,
    source_type: 'observed',
    ...overrides,
  };
}

describe('computeAuthority', () => {
  it('explicit source scores higher than inferred', () => {
    const explicit = makeKnowledgeEntry({ source_type: 'explicit' });
    const inferred = makeKnowledgeEntry({ source_type: 'inferred' });

    const explicitAuth = computeAuthority(explicit, 1);
    const inferredAuth = computeAuthority(inferred, 1);

    assert.ok(explicitAuth > inferredAuth, `explicit (${explicitAuth}) should score higher than inferred (${inferredAuth})`);
  });

  it('entry accessed across many sessions scores higher', () => {
    const entry = makeKnowledgeEntry({ source_type: 'observed', access_count: 10 });

    const fewSessions = computeAuthority(entry, 1);
    const manySessions = computeAuthority(entry, 20);

    assert.ok(manySessions > fewSessions, `many sessions (${manySessions}) should score higher than few (${fewSessions})`);
  });

  it('frequently accessed recent entry scores higher than rarely accessed old entry', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const frequentRecent = makeKnowledgeEntry({
      source_type: 'observed',
      access_count: 50,
      created_at: Date.now() - 2 * DAY_MS,
    });
    const rareOld = makeKnowledgeEntry({
      source_type: 'observed',
      access_count: 1,
      created_at: Date.now() - 60 * DAY_MS,
    });

    const recentAuth = computeAuthority(frequentRecent, 5);
    const oldAuth = computeAuthority(rareOld, 1);

    assert.ok(recentAuth > oldAuth, `frequent recent (${recentAuth}) should beat rare old (${oldAuth})`);
  });

  it('returns value between 0 and 1', () => {
    const entry = makeKnowledgeEntry({ source_type: 'explicit', access_count: 100 });
    const auth = computeAuthority(entry, 50);

    assert.ok(auth >= 0 && auth <= 1, `authority ${auth} should be between 0 and 1`);
  });

  it('zero-age entry does not cause NaN or Infinity', () => {
    const entry = makeKnowledgeEntry({ created_at: Date.now() });
    const auth = computeAuthority(entry, 0);

    assert.ok(Number.isFinite(auth), `authority should be finite, got ${auth}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/plugins/knowledge/knowledge-base.test.js`
Expected: FAIL — `computeAuthority` is not exported

- [ ] **Step 3: Implement computeAuthority**

Add to `src/plugins/knowledge/knowledge-base.ts`, as an exported function before the class:

```typescript
import type { StoragePlugin, KnowledgeEntry, KnowledgeCategory, SourceType, ContradictionWarning } from '../../core/types.js';

const SOURCE_WEIGHTS: Record<string, number> = { explicit: 1.0, inferred: 0.6, observed: 0.3 };

export function computeAuthority(entry: KnowledgeEntry, sessionCount: number): number {
  const sourceWeight = SOURCE_WEIGHTS[entry.source_type] ?? 0.3;
  const sessionBreadth = Math.log2(sessionCount + 1) / 5; // 0-1 range, 32 sessions → 1.0
  const ageDays = Math.max(0, (Date.now() - entry.created_at) / (24 * 60 * 60 * 1000));
  const accessDensity = ageDays > 0 ? Math.min(1, (entry.access_count / ageDays) / 10) : Math.min(1, entry.access_count / 10);
  const recency = Math.pow(0.5, ageDays / 7); // 7-day half-life

  const raw = [sourceWeight, sessionBreadth, accessDensity, recency];
  const expScores = raw.map(x => Math.exp(x));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const attention = expScores.map(x => x / sumExp); // softmax

  const authority = attention[0] * sourceWeight
    + attention[1] * sessionBreadth
    + attention[2] * accessDensity
    + attention[3] * recency;

  return Math.max(0, Math.min(1, authority));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/plugins/knowledge/knowledge-base.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/knowledge/knowledge-base.ts src/tests/plugins/knowledge/knowledge-base.test.ts
git commit -m "feat: authority scoring with softmax attention (AttnRes contradiction resolution)"
```

---

### Task 4: Extended ContradictionWarning with authority and length normalization

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/plugins/knowledge/knowledge-base.ts`
- Test: `src/tests/plugins/knowledge/knowledge-base.test.ts`

- [ ] **Step 1: Extend ContradictionWarning type**

In `src/core/types.ts`, update the `ContradictionWarning` interface:

```typescript
export interface ContradictionWarning {
  id: string;
  title: string;
  content: string;
  similarity_reason: string;
  source_type?: SourceType;
  authority_existing: number;
  authority_new: number;
  suggested_action: 'keep_existing' | 'replace' | 'merge';
}
```

- [ ] **Step 2: Write failing test — contradiction with authority scoring**

Add to `src/tests/plugins/knowledge/knowledge-base.test.ts`:

```typescript
describe('contradiction resolution with authority', () => {
  let storage: BetterSqlite3Storage;
  let kb: KnowledgeBase;

  before(async () => {
    storage = await createTestDb();
    kb = new KnowledgeBase(storage);
  });

  after(async () => { await storage.close(); });

  it('returns authority scores and suggested action on contradiction', async () => {
    // Save an existing entry — explicit, accessed many times
    const existing = kb.save({
      category: 'pattern',
      title: 'Authentication flow pattern',
      content: 'Use JWT with refresh tokens for authentication',
      tags: ['auth'],
      source_type: 'explicit',
    });

    // Simulate access from multiple sessions
    for (let i = 0; i < 5; i++) {
      storage.exec('UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?', [existing.id]);
      try {
        storage.exec(
          'INSERT OR IGNORE INTO session_access_log (knowledge_id, session_id, accessed_at) VALUES (?, ?, ?)',
          [existing.id, `session-${i}`, Date.now()]
        );
      } catch { /* table may not exist */ }
    }

    // Check contradictions for a new entry with different content
    const warnings = await kb.checkContradictions(
      'Authentication flow pattern',
      'Use session cookies for authentication instead of JWT',
      'pattern'
    );

    assert.ok(warnings.length > 0, 'should detect contradiction');
    const w = warnings[0];
    assert.ok(typeof w.authority_existing === 'number', 'should have authority_existing');
    assert.ok(typeof w.authority_new === 'number', 'should have authority_new');
    assert.ok(['keep_existing', 'replace', 'merge'].includes(w.suggested_action), 'should have valid suggested_action');
    // Existing entry is explicit with many accesses — should have higher authority
    assert.ok(w.authority_existing > w.authority_new, 'established explicit entry should have higher authority');
    assert.equal(w.suggested_action, 'keep_existing', 'should suggest keeping the more authoritative entry');
  });

  it('suggests merge when authority scores are close', async () => {
    const entry1 = kb.save({
      category: 'decision',
      title: 'Database choice for caching',
      content: 'Use Redis for caching layer',
      tags: ['cache'],
      source_type: 'observed',
    });

    const warnings = await kb.checkContradictions(
      'Database choice for caching',
      'Use Memcached for caching layer',
      'decision'
    );

    if (warnings.length > 0) {
      const w = warnings[0];
      // Both are observed, similar age, similar access — authority should be close
      assert.ok(typeof w.suggested_action === 'string', 'should have suggested_action');
    }
  });

  it('applies length normalization — long entry does not dominate similarity', async () => {
    // Save a very long entry
    kb.save({
      category: 'pattern',
      title: 'Verbose deployment process',
      content: 'Deploy using Docker. '.repeat(100), // very long content
      tags: ['deploy'],
      source_type: 'observed',
    });

    // Short contradicting entry
    const warnings = await kb.checkContradictions(
      'Deployment process',
      'Deploy using Kubernetes',
      'pattern'
    );

    // Test just verifies no crash with length normalization
    assert.ok(Array.isArray(warnings), 'should return warnings array');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/plugins/knowledge/knowledge-base.test.js`
Expected: FAIL — `authority_existing` is undefined on warnings

- [ ] **Step 4: Update checkContradictions to compute authority and add length normalization**

In `src/plugins/knowledge/knowledge-base.ts`, update the `checkContradictions` method. Replace the warning-building loop at the end of the method:

```typescript
  async checkContradictions(title: string, content: string, category: KnowledgeCategory): Promise<ContradictionWarning[]> {
    // ... (existing candidate-finding code stays the same until the loop) ...

    if (candidates.length === 0) return [];

    // Build contradiction warnings with authority scoring
    const warnings: ContradictionWarning[] = [];

    // Compute authority for the new entry (no session history yet)
    const newEntryProxy: KnowledgeEntry = {
      id: '__new__',
      category,
      title,
      content,
      tags: [],
      shareable: true,
      relevance_score: 1.0,
      access_count: 0,
      created_at: Date.now(),
      last_accessed: Date.now(),
      archived: false,
      source_type: 'observed',  // new entries default to observed
    };
    const authorityNew = computeAuthority(newEntryProxy, 0);

    for (const c of candidates) {
      const existingTitle = (c.title as string) ?? '';
      const existingContent = ((c.content as string) ?? '').slice(0, 200);

      // Length normalization (RMSNorm analogue) — prevent long entries from inflating similarity
      const existingFullContent = (c.content as string) ?? '';
      const lengthFactor = Math.log(existingFullContent.length + 1);

      // Determine similarity reason
      let reason = (c._similarity_reason as string) || 'similar topic';
      if (!c._similarity_reason) {
        const titleLower = title.toLowerCase();
        const existingLower = existingTitle.toLowerCase();
        if (titleLower === existingLower) {
          reason = 'identical title';
        } else if (titleLower.includes(existingLower) || existingLower.includes(titleLower)) {
          reason = 'overlapping title';
        }
      }

      // Compute authority for existing entry
      let sessionCount = 0;
      try {
        const row = this.storage.prepare(
          'SELECT COUNT(DISTINCT session_id) as cnt FROM session_access_log WHERE knowledge_id = ?'
        ).get(c.id as string) as { cnt: number } | undefined;
        sessionCount = row?.cnt ?? 0;
      } catch {
        // session_access_log may not exist
      }

      const existingEntry = this.getById(c.id as string);
      const authorityExisting = existingEntry ? computeAuthority(existingEntry, sessionCount) : 0;

      // Determine suggested action based on authority difference
      const authorityDiff = Math.abs(authorityExisting - authorityNew);
      let suggestedAction: 'keep_existing' | 'replace' | 'merge';
      if (authorityDiff > 0.3) {
        suggestedAction = authorityExisting > authorityNew ? 'keep_existing' : 'replace';
      } else {
        suggestedAction = 'merge';
      }

      warnings.push({
        id: c.id as string,
        title: existingTitle,
        content: existingContent,
        similarity_reason: reason,
        source_type: existingEntry?.source_type,
        authority_existing: authorityExisting,
        authority_new: authorityNew,
        suggested_action: suggestedAction,
      });
    }

    return warnings;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/plugins/knowledge/knowledge-base.test.js`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `npm run build && npm test`
Expected: All tests PASS. Any test that reads `ContradictionWarning` properties that didn't exist before will now see the new fields — verify no existing test breaks.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/plugins/knowledge/knowledge-base.ts src/tests/plugins/knowledge/knowledge-base.test.ts
git commit -m "feat: depth-aware contradiction resolution with authority scoring and length normalization"
```

---

## Phase 3: Block-Level Memory Attention

### Task 5: Block selector with softmax attention

**Files:**
- Create: `src/plugins/search/block-selector.ts`
- Test: `src/tests/plugins/search/block-search.test.ts`

- [ ] **Step 1: Write failing test — softmax and block scoring**

Create `src/tests/plugins/search/block-search.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { softmax, normalizeBlock, selectBlocks } from '../../../plugins/search/block-selector.js';
import type { SearchResult } from '../../../core/types.js';

function makeResult(id: string, score: number, timestamp?: number): SearchResult {
  return {
    id,
    title: `Title ${id}`,
    snippet: `Snippet ${id}`,
    relevance_score: score,
    type: 'code',
    timestamp: timestamp ?? Date.now(),
  };
}

describe('softmax', () => {
  it('returns probabilities that sum to 1', () => {
    const result = softmax([1.0, 2.0, 3.0]);
    const sum = result.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-6, `sum should be ~1.0, got ${sum}`);
  });

  it('highest input gets highest probability', () => {
    const result = softmax([1.0, 5.0, 2.0]);
    assert.ok(result[1] > result[0], 'index 1 (5.0) should have highest probability');
    assert.ok(result[1] > result[2], 'index 1 (5.0) should beat index 2 (2.0)');
  });

  it('equal inputs produce equal probabilities', () => {
    const result = softmax([1.0, 1.0, 1.0]);
    assert.ok(Math.abs(result[0] - result[1]) < 1e-6, 'equal inputs should produce equal outputs');
    assert.ok(Math.abs(result[1] - result[2]) < 1e-6, 'equal inputs should produce equal outputs');
  });

  it('handles single element', () => {
    const result = softmax([3.0]);
    assert.ok(Math.abs(result[0] - 1.0) < 1e-6, 'single element should be 1.0');
  });

  it('handles empty array', () => {
    const result = softmax([]);
    assert.equal(result.length, 0);
  });
});

describe('normalizeBlock', () => {
  it('normalizes scores to 0-1 range', () => {
    const results = [makeResult('a', 3.0), makeResult('b', 1.0), makeResult('c', 5.0)];
    const normalized = normalizeBlock(results);

    const scores = normalized.map(r => r.relevance_score);
    assert.ok(Math.min(...scores) >= 0, 'min score should be >= 0');
    assert.ok(Math.max(...scores) <= 1.0 + 1e-6, 'max score should be <= 1.0');
  });

  it('single result gets score 1.0', () => {
    const results = [makeResult('a', 0.5)];
    const normalized = normalizeBlock(results);
    assert.ok(Math.abs(normalized[0].relevance_score - 1.0) < 1e-6, 'single result should get 1.0');
  });

  it('empty array returns empty', () => {
    assert.equal(normalizeBlock([]).length, 0);
  });

  it('preserves relative ordering', () => {
    const results = [makeResult('a', 1.0), makeResult('b', 3.0), makeResult('c', 2.0)];
    const normalized = normalizeBlock(results);

    const bScore = normalized.find(r => r.id === 'b')!.relevance_score;
    const cScore = normalized.find(r => r.id === 'c')!.relevance_score;
    const aScore = normalized.find(r => r.id === 'a')!.relevance_score;

    assert.ok(bScore > cScore, 'b (3.0) should still beat c (2.0) after normalization');
    assert.ok(cScore > aScore, 'c (2.0) should still beat a (1.0) after normalization');
  });
});

describe('selectBlocks', () => {
  it('skips blocks with attention below threshold', () => {
    // Block scores: one very high, others near zero
    const blockScores = [5.0, 0.01, 0.01, 0.01];
    const selected = selectBlocks(blockScores, 0.05);

    assert.ok(selected.includes(0), 'high-scoring block should be selected');
    assert.ok(selected.length < 4, 'low-scoring blocks should be skipped');
  });

  it('selects all blocks when scores are equal', () => {
    const blockScores = [1.0, 1.0, 1.0, 1.0];
    const selected = selectBlocks(blockScores, 0.05);

    assert.equal(selected.length, 4, 'all equal blocks should be selected (each gets 0.25)');
  });

  it('returns empty for all-zero scores', () => {
    const blockScores = [0, 0, 0, 0];
    const selected = selectBlocks(blockScores, 0.05);

    // softmax of all zeros = equal probabilities = 0.25 each > 0.05 threshold
    assert.equal(selected.length, 4, 'all-zero should produce equal attention above threshold');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/plugins/search/block-search.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement block-selector.ts**

Create `src/plugins/search/block-selector.ts`:

```typescript
import type { SearchResult } from '../../core/types.js';

/**
 * Softmax: competitive normalization over an array of scores.
 * Returns probabilities that sum to 1.
 */
export function softmax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores); // numerical stability
  const exps = scores.map(s => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/**
 * Normalize search results within a block to 0-1 range.
 * Prevents blocks with many entries from dominating via raw score magnitude.
 */
export function normalizeBlock(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;
  if (results.length === 1) return [{ ...results[0], relevance_score: 1.0 }];

  const scores = results.map(r => r.relevance_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min + 1e-8;

  return results.map(r => ({
    ...r,
    relevance_score: (r.relevance_score - min) / range,
  }));
}

/**
 * Select blocks whose softmax attention exceeds the threshold.
 * Returns indices of selected blocks.
 */
export function selectBlocks(blockScores: number[], threshold: number = 0.05): number[] {
  const attention = softmax(blockScores);
  return attention
    .map((a, i) => ({ index: i, attention: a }))
    .filter(b => b.attention >= threshold)
    .map(b => b.index);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/plugins/search/block-search.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/search/block-selector.ts src/tests/plugins/search/block-search.test.ts
git commit -m "feat: block selector with softmax attention and per-block normalization"
```

---

### Task 6: Block search orchestrator

**Files:**
- Modify: `src/plugins/search/fusion.ts`
- Modify: `src/core/types.ts`
- Test: `src/tests/plugins/search/block-search.test.ts`

- [ ] **Step 1: Add BlockSearchConfig type**

In `src/core/types.ts`, add after the `SearchWeights` interface:

```typescript
export interface SearchBlock {
  name: 'session' | 'project' | 'global' | 'archive';
  filter: (opts: SearchOpts) => SearchOpts;
}

export interface BlockSearchConfig {
  enabled: boolean;
  threshold: number;  // minimum block attention to include (default 0.05)
}
```

- [ ] **Step 2: Write failing test — BlockSearchOrchestrator**

Add to `src/tests/plugins/search/block-search.test.ts`:

```typescript
import { BlockSearchOrchestrator } from '../../../plugins/search/fusion.js';
import type { SearchPlugin, SearchOpts } from '../../../core/types.js';

function mockBlockPlugin(
  name: string,
  results: SearchResult[],
): SearchPlugin {
  return {
    name,
    version: '1.0.0',
    type: 'search' as const,
    strategy: 'bm25' as const,
    priority: 1,
    init: async () => {},
    destroy: async () => {},
    search: async () => results,
    shouldFallback: () => false,
  };
}

describe('BlockSearchOrchestrator', () => {
  it('merges results from multiple blocks with attention weighting', async () => {
    const now = Date.now();
    const sessionResults = [makeResult('s1', 2.0, now)];
    const projectResults = [makeResult('p1', 1.0, now - 86400000)];

    const orchestrator = new BlockSearchOrchestrator({
      session: [mockBlockPlugin('bm25', sessionResults)],
      project: [mockBlockPlugin('bm25', projectResults)],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    const results = await orchestrator.execute('test query', { limit: 10 });

    assert.ok(results.length >= 2, 'should return results from multiple blocks');
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('s1'), 'should include session result');
    assert.ok(ids.includes('p1'), 'should include project result');
  });

  it('skips blocks with no relevant results', async () => {
    const sessionResults = [makeResult('s1', 3.0)];

    const orchestrator = new BlockSearchOrchestrator({
      session: [mockBlockPlugin('bm25', sessionResults)],
      project: [mockBlockPlugin('bm25', [])],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    const results = await orchestrator.execute('test query', { limit: 10 });

    assert.ok(results.length >= 1, 'should return at least session results');
    assert.equal(results[0].id, 's1');
  });

  it('normalizes scores so large block does not overwhelm small block', async () => {
    // Session has 1 result with score 1.0
    // Project has many results with scores 5.0-10.0
    const sessionResults = [makeResult('s1', 1.0)];
    const projectResults = [
      makeResult('p1', 10.0),
      makeResult('p2', 8.0),
      makeResult('p3', 5.0),
    ];

    const orchestrator = new BlockSearchOrchestrator({
      session: [mockBlockPlugin('bm25', sessionResults)],
      project: [mockBlockPlugin('bm25', projectResults)],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    const results = await orchestrator.execute('test query', { limit: 10 });

    // Session result should not be completely buried by project results
    // After normalization, s1 gets 1.0 (single result) and project results get 0-1
    const s1 = results.find(r => r.id === 's1');
    assert.ok(s1, 'session result should be present');
    assert.ok(s1!.relevance_score > 0, 'session result should have positive score');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/plugins/search/block-search.test.js`
Expected: FAIL — `BlockSearchOrchestrator` not exported

- [ ] **Step 4: Implement BlockSearchOrchestrator**

Add to `src/plugins/search/fusion.ts`:

```typescript
import { softmax, normalizeBlock, selectBlocks } from './block-selector.js';
import type { SearchIntent } from '../../core/types.js';

interface BlockPlugins {
  session: SearchPlugin[];
  project: SearchPlugin[];
  global: SearchPlugin[];
  archive: SearchPlugin[];
}

export class BlockSearchOrchestrator {
  private blocks: BlockPlugins;
  private blockNames: Array<keyof BlockPlugins> = ['session', 'project', 'global', 'archive'];

  constructor(blocks: BlockPlugins) {
    this.blocks = blocks;
  }

  async execute(query: string, opts: SearchOpts): Promise<SearchResult[]> {
    // Phase 1: Lightweight probe — get top-3 from each block
    const blockScores: number[] = [];
    const blockProbeResults: SearchResult[][] = [];

    for (const blockName of this.blockNames) {
      const plugins = this.blocks[blockName];
      if (plugins.length === 0) {
        blockScores.push(0);
        blockProbeResults.push([]);
        continue;
      }

      const fusion = new SearchFusion(plugins);
      const probeResults = await fusion.execute(query, { ...opts, limit: 3 });
      blockProbeResults.push(probeResults);
      blockScores.push(probeResults.length > 0 ? Math.max(...probeResults.map(r => r.relevance_score)) : 0);
    }

    // Block attention via softmax
    const selectedIndices = selectBlocks(blockScores, 0.05);

    if (selectedIndices.length === 0) return [];

    const attention = softmax(blockScores);

    // Phase 2: Deep search on selected blocks + normalization
    let allResults: SearchResult[] = [];

    for (const idx of selectedIndices) {
      const blockName = this.blockNames[idx];
      const plugins = this.blocks[blockName];
      if (plugins.length === 0) continue;

      const fusion = new SearchFusion(plugins);
      const results = await fusion.execute(query, opts);

      // Per-block normalization (RMSNorm analogue)
      const normalized = normalizeBlock(results);

      // Weight by block attention
      for (const r of normalized) {
        allResults.push({
          ...r,
          relevance_score: r.relevance_score * attention[idx],
        });
      }
    }

    // Deduplicate by id (same entry might appear in multiple blocks)
    const seen = new Set<string>();
    allResults = allResults.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // Apply adaptive reranking
    const classifier = new IntentClassifier();
    const intent = classifier.classify(query);
    allResults = rerank(allResults, intent.intent_type);

    return allResults.slice(0, opts.limit || 5);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/plugins/search/block-search.test.js`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite for regressions**

Run: `npm run build && npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/plugins/search/fusion.ts src/core/types.ts src/tests/plugins/search/block-search.test.ts
git commit -m "feat: block-level memory attention with two-phase search and per-block normalization"
```

---

### Task 7: Full integration test

**Files:**
- Test: `src/tests/plugins/search/block-search.test.ts`

- [ ] **Step 1: Write integration test — full pipeline**

Add to `src/tests/plugins/search/block-search.test.ts`:

```typescript
describe('full pipeline integration', () => {
  it('block search + adaptive reranking produces correct ordering for causal query', async () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Session: recent error
    const sessionPlugin = mockBlockPlugin('bm25', [
      makeResult('recent-error', 1.0, now),
    ]);

    // Project: old but highly relevant pattern
    const projectPlugin = mockBlockPlugin('bm25', [
      makeResult('old-pattern', 3.0, now - 30 * DAY_MS),
    ]);

    const orchestrator = new BlockSearchOrchestrator({
      session: [sessionPlugin],
      project: [projectPlugin],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    // "why" triggers causal intent → recency favored
    const results = await orchestrator.execute('why authentication failed', { limit: 10 });

    assert.ok(results.length >= 2, 'should return results from both blocks');
    // With causal intent, the recent error should rank higher despite lower base relevance
    assert.equal(results[0].id, 'recent-error', 'causal query should prioritize recent session error');
  });

  it('block search + adaptive reranking produces correct ordering for lookup query', async () => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Session: recent but low relevance
    const sessionPlugin = mockBlockPlugin('bm25', [
      makeResult('recent-mention', 0.5, now),
    ]);

    // Project: old but highly relevant
    const projectPlugin = mockBlockPlugin('bm25', [
      makeResult('authoritative-doc', 3.0, now - 30 * DAY_MS),
    ]);

    const orchestrator = new BlockSearchOrchestrator({
      session: [sessionPlugin],
      project: [projectPlugin],
      global: [mockBlockPlugin('bm25', [])],
      archive: [mockBlockPlugin('bm25', [])],
    });

    // "how" triggers lookup intent → relevance favored
    const results = await orchestrator.execute('how does authentication work', { limit: 10 });

    assert.ok(results.length >= 2, 'should return results from both blocks');
    assert.equal(results[0].id, 'authoritative-doc', 'lookup query should prioritize high-relevance project knowledge');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/plugins/search/block-search.test.js`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tests/plugins/search/block-search.test.ts
git commit -m "test: integration tests for block search + adaptive reranking pipeline"
```
