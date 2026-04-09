import fs from 'node:fs';
import path from 'node:path';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { buildTrail } from '../../core/decision-trail.js';

export async function why(args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.error('No database found. Run `context-mem init` first.');
    process.exit(1);
  }

  const query = args.join(' ').trim();
  if (!query) {
    console.log(`Usage: context-mem why <file-or-topic> [was_changed|was_created]

Examples:
  context-mem why src/core/pipeline.ts was_changed
  context-mem why PostgreSQL
  context-mem why authentication`);
    return;
  }

  const storage = new BetterSqlite3Storage();
  await storage.init({});
  await storage.open(dbPath);

  try {
    const trail = buildTrail(storage, query);
    if (!trail) {
      console.log(`No decision trail found for "${query}"`);
      return;
    }

    console.log(`\n  Decision: ${trail.decision}`);
    console.log(`  Date: ${new Date(trail.date).toLocaleString()}`);
    console.log(`  Confidence: ${(trail.confidence * 100).toFixed(0)}%\n`);

    if (trail.evidence_chain.length > 0) {
      console.log('  Evidence Chain:');
      for (const e of trail.evidence_chain) {
        const icon = e.type === 'decision' ? '★' : e.type === 'error' ? '✗' : e.type === 'fix' ? '✓' : '→';
        console.log(`    ${icon} [${e.type}] ${e.content.slice(0, 120)}`);
        console.log(`      ${new Date(e.timestamp).toLocaleTimeString()}`);
      }
    }

    if (trail.alternatives_considered.length > 0) {
      console.log('\n  Alternatives Considered:');
      for (const a of trail.alternatives_considered) {
        console.log(`    - ${a}`);
      }
    }

    if (trail.related_entities.length > 0) {
      console.log(`\n  Related Entities: ${trail.related_entities.join(', ')}`);
    }
    console.log('');
  } finally {
    await storage.close();
  }
}
