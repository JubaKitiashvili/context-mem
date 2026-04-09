import fs from 'node:fs';
import path from 'node:path';
import { BetterSqlite3Storage } from '../../plugins/storage/better-sqlite3.js';
import { generateNarrative } from '../../core/narrative-generator.js';
import type { NarrativeFormat } from '../../core/narrative-generator.js';

export async function story(args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.error('No database found. Run `context-mem init` first.');
    process.exit(1);
  }

  // Parse args
  let format: NarrativeFormat = 'pr';
  let sessionId: string | undefined;
  let topic: string | undefined;
  let from: number | undefined;
  let to: number | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--format': format = (args[++i] || 'pr') as NarrativeFormat; break;
      case '--session': sessionId = args[++i]; break;
      case '--topic': topic = args[++i]; break;
      case '--range': {
        const range = args[++i] || '';
        const [fromStr, toStr] = range.split('..');
        if (fromStr) from = new Date(fromStr).getTime();
        if (toStr) to = new Date(toStr).getTime();
        break;
      }
    }
  }

  const validFormats = ['pr', 'standup', 'adr', 'onboarding'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format: "${format}". Must be one of: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  const storage = new BetterSqlite3Storage();
  await storage.init({});
  await storage.open(dbPath);

  try {
    const narrative = generateNarrative(storage, {
      format,
      sessionId,
      topic,
      timeRange: from && to ? { from, to } : undefined,
    });

    console.log(narrative);
  } finally {
    await storage.close();
  }
}
