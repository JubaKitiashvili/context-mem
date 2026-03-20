import { Kernel } from '../../core/kernel.js';
import fs from 'node:fs';
import path from 'node:path';

export async function importCommand(args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.log('No database found. Run `context-mem init` first.');
    return;
  }

  const inputFile = args.find(a => !a.startsWith('--'));
  if (!inputFile) {
    console.log('Usage: context-mem import <file.json> [--merge|--replace]');
    return;
  }

  if (!fs.existsSync(inputFile)) {
    console.log(`File not found: ${inputFile}`);
    return;
  }

  const replaceMode = args.includes('--replace');

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(inputFile, 'utf8')) as Record<string, unknown>;
  } catch {
    console.log('Invalid JSON file.');
    return;
  }

  if (!data.version || !data.tables) {
    console.log('Invalid export format. Expected { version, tables }.');
    return;
  }

  const kernel = new Kernel(projectDir);
  await kernel.start();
  const storage = kernel.getStorage();

  const tables = data.tables as Record<string, unknown[]>;
  const counts: string[] = [];

  if (tables.knowledge?.length) {
    if (replaceMode) storage.exec('DELETE FROM knowledge');
    let imported = 0;
    for (const row of tables.knowledge as Array<Record<string, unknown>>) {
      try {
        storage.exec(
          'INSERT OR IGNORE INTO knowledge (id, category, title, content, tags, shareable, relevance_score, access_count, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [row.id, row.category, row.title, row.content, typeof row.tags === 'string' ? row.tags : JSON.stringify(row.tags || []), row.shareable ?? 1, row.relevance_score ?? 1.0, row.access_count ?? 0, row.created_at ?? Date.now(), row.archived ?? 0],
        );
        imported++;
      } catch { /* skip duplicates in merge mode */ }
    }
    counts.push(`${imported} knowledge entries`);
  }

  if (tables.snapshots?.length) {
    if (replaceMode) storage.exec('DELETE FROM snapshots');
    let imported = 0;
    for (const row of tables.snapshots as Array<Record<string, unknown>>) {
      try {
        const snapshot = typeof row.snapshot === 'string' ? row.snapshot : JSON.stringify(row.snapshot || row.data || {});
        storage.exec(
          'INSERT OR IGNORE INTO snapshots (session_id, snapshot, created_at) VALUES (?, ?, ?)',
          [row.session_id, snapshot, row.created_at ?? Date.now()],
        );
        imported++;
      } catch { /* skip duplicates */ }
    }
    counts.push(`${imported} snapshots`);
  }

  if (tables.events?.length) {
    if (replaceMode) storage.exec('DELETE FROM events');
    let imported = 0;
    for (const row of tables.events as Array<Record<string, unknown>>) {
      try {
        storage.exec(
          'INSERT OR IGNORE INTO events (id, session_id, event_type, priority, agent, data, context_bytes, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [row.id, row.session_id, row.event_type, row.priority ?? 4, row.agent ?? null, typeof row.data === 'string' ? row.data : JSON.stringify(row.data || {}), row.context_bytes ?? 0, row.timestamp ?? Date.now()],
        );
        imported++;
      } catch { /* skip duplicates */ }
    }
    counts.push(`${imported} events`);
  }

  if (tables.observations?.length) {
    if (replaceMode) storage.exec('DELETE FROM observations');
    let imported = 0;
    for (const row of tables.observations as Array<Record<string, unknown>>) {
      try {
        storage.exec(
          'INSERT OR IGNORE INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level, session_id, content_hash, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [row.id, row.type, row.content, row.summary ?? null, typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata || {}), row.indexed_at ?? Date.now(), row.privacy_level ?? 'public', row.session_id ?? null, row.content_hash ?? null, row.correlation_id ?? null],
        );
        imported++;
      } catch { /* skip duplicates */ }
    }
    counts.push(`${imported} observations`);
  }

  console.log(`Imported from ${inputFile}: ${counts.join(', ')}`);
  await kernel.stop();
}
