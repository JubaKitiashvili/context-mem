# Contributing to context-mem

Thank you for your interest in contributing to context-mem! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/JubaKitiashvili/context-mem.git
cd context-mem
npm install
npm run build
npm test          # Should pass 1116+ tests
```

## Project Structure

```
src/
  core/                     # Core modules
    importance-classifier.ts  # Observation scoring (0.0-1.0)
    entity-extractor.ts       # Technology/person/file detection
    topic-detector.ts         # 13 topic categories
    adaptive-compressor.ts    # 4-tier progressive compression
    wake-up.ts                # Session primer assembly
    decision-trail.ts         # Evidence chain reconstruction
    narrative-generator.ts    # PR/standup/ADR/onboarding templates
    regression-fingerprint.ts # Working state snapshots
    pressure-predictor.ts     # Memory loss risk scoring
    feedback-engine.ts        # Search-action correlation
    conversation-import.ts    # External conversation ingestion
    pipeline.ts               # Observation ingest pipeline
    dreamer.ts                # Background validation agent
    knowledge-graph.ts        # Entity-relationship graph
    nl-query.ts               # Natural language queries
    ...
  core/conversation-parsers/  # 5 format parsers
  plugins/
    summarizers/              # 14 content-type summarizers
    search/                   # BM25, trigram, levenshtein, vector
    storage/                  # SQLite with migrations (v1-v16)
    knowledge/                # Knowledge base with authority scoring
    privacy/                  # 9 secret detectors
  mcp-server/
    tools.ts                  # 44 MCP tool definitions + handlers
    server.ts                 # MCP protocol dispatch
  cli/
    commands/                 # CLI command implementations
  tests/                      # 1116+ tests (node:test)
hooks/                        # Claude Code hooks (JS)
dashboard/
  server.js                   # Dashboard web UI (self-contained)
```

## Development Workflow

### Making Changes

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make changes
3. Build: `npm run build`
4. Test: `npm test` — all 1116+ tests must pass
5. Commit with descriptive message
6. Push and create PR

### Writing Tests

Tests use Node.js built-in `node:test` and `node:assert/strict`:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers.js';

describe('My Feature', () => {
  let storage;
  before(async () => { storage = await createTestDb(); });
  after(async () => { await storage.close(); });

  it('does something', () => {
    assert.equal(1 + 1, 2);
  });
});
```

Run a single test file: `node --test dist/tests/core/my-feature.test.js`

### Adding a New MCP Tool

1. Add tool definition to `toolDefinitions` array in `src/mcp-server/tools.ts`
2. Add handler function `handleMyTool()` in the same file
3. Wire into `server.ts` switch statement
4. Update tool count in test assertions (`mcp-protocol.test.ts`, `server.test.ts`)
5. Write tests

### Adding a Migration

1. Increment `LATEST_SCHEMA_VERSION` in `src/plugins/storage/migrations.ts`
2. Add migration entry with SQL
3. Update version assertions in `migrations.test.ts`
4. Update schema version count check

### Adding a CLI Command

1. Create `src/cli/commands/my-command.ts`
2. Import and wire in `src/cli/index.ts`
3. Add to help text

## Code Conventions

- **TypeScript strict mode** — no `any` unless truly necessary
- **Zero external dependencies** for core logic (better-sqlite3 is the only runtime dep)
- **Deterministic by default** — all features work without LLM
- **Non-critical operations never block** — wrap in try/catch, log errors, continue
- **Tests required** — every feature needs tests, target 10+ per component

## Architecture Principles

- **Pipeline pattern**: observe → privacy → dedup → entity extract → importance classify → topic detect → summarize → store
- **Fail-open**: LLM failures fall back to deterministic, embedding failures don't block observe
- **Non-blocking background**: Dreamer tasks, embedding, topic storage are fire-and-forget
- **Storage is append-only**: observations are never deleted by application code (only by lifecycle cleanup)

## Running Benchmarks

```bash
# Core benchmarks (compression, search)
node docs/benchmarks/run-benchmarks.js

# Total Recall benchmarks (importance, entities, compression tiers)
node docs/benchmarks/run-total-recall-benchmarks.js
```

## Questions?

Open an issue at [github.com/JubaKitiashvili/context-mem/issues](https://github.com/JubaKitiashvili/context-mem/issues).
