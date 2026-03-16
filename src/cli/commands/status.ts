import { Kernel } from '../../core/kernel.js';
import fs from 'node:fs';
import path from 'node:path';

export async function status(_args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.log('No database found. Run `context-mem init` first.');
    return;
  }

  const kernel = new Kernel(projectDir);
  await kernel.start();

  const stats = await kernel.stats();
  const dbSize = fs.statSync(dbPath).size;

  console.log(`context-mem status
  Database: ${dbPath} (${(dbSize / 1024).toFixed(1)} KB)
  Session: ${stats.session_id}
  Observations: ${stats.observations_stored}
  Tokens saved: ${stats.tokens_saved} (${stats.savings_percentage}%)
  Searches: ${stats.searches_performed}`);

  await kernel.stop();
}
