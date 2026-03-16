import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BetterSqlite3Storage } from '../plugins/storage/better-sqlite3.js';

export async function createTestDb(): Promise<BetterSqlite3Storage> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmem-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const storage = new BetterSqlite3Storage();
  await storage.init({});
  await storage.open(dbPath);
  return storage;
}

export function insertTestObservations(storage: BetterSqlite3Storage, observations: Array<{
  id: string; type: string; content: string; summary: string;
}>): void {
  for (const obs of observations) {
    storage.exec(
      `INSERT INTO observations (id, type, content, summary, metadata, indexed_at, privacy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [obs.id, obs.type, obs.content, obs.summary, '{}', Date.now(), 'public']
    );
  }
}
