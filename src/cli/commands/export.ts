import { Kernel } from '../../core/kernel.js';
import fs from 'node:fs';
import path from 'node:path';

export async function exportCommand(args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.log('No database found. Run `context-mem init` first.');
    return;
  }

  const exportAll = args.includes('--all');
  const exportKnowledge = exportAll || args.includes('--knowledge') || (!args.some(a => a.startsWith('--') && a !== '--output'));
  const exportSnapshots = exportAll || args.includes('--snapshots') || (!args.some(a => a.startsWith('--') && a !== '--output'));
  const exportEvents = exportAll || args.includes('--events');
  const exportObservations = exportAll;

  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  const kernel = new Kernel(projectDir);
  await kernel.start();
  const storage = kernel.getStorage();

  const data: Record<string, unknown> = {
    version: 1,
    exported_at: new Date().toISOString(),
    project: path.basename(projectDir),
    project_dir: projectDir,
    tables: {} as Record<string, unknown[]>,
  };

  const tables = data.tables as Record<string, unknown[]>;
  const counts: string[] = [];

  if (exportKnowledge) {
    tables.knowledge = storage.prepare('SELECT * FROM knowledge WHERE archived = 0').all() as unknown[];
    counts.push(`${tables.knowledge.length} knowledge entries`);
  }

  if (exportSnapshots) {
    tables.snapshots = storage.prepare('SELECT * FROM snapshots').all() as unknown[];
    counts.push(`${tables.snapshots.length} snapshots`);
  }

  if (exportEvents) {
    tables.events = storage.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 1000').all() as unknown[];
    counts.push(`${tables.events.length} events`);
  }

  if (exportObservations) {
    tables.observations = storage.prepare('SELECT * FROM observations').all() as unknown[];
    tables.token_stats = storage.prepare('SELECT * FROM token_stats').all() as unknown[];
    counts.push(`${tables.observations.length} observations`);
    counts.push(`${tables.token_stats.length} token stats`);
  }

  const json = JSON.stringify(data, null, 2);

  if (outputFile) {
    fs.writeFileSync(outputFile, json, 'utf8');
    console.log(`Exported to ${outputFile}: ${counts.join(', ')}`);
  } else {
    process.stdout.write(json + '\n');
  }

  await kernel.stop();
}
