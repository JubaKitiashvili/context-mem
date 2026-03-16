import fs from 'node:fs';
import path from 'node:path';

export async function doctor(_args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = [];

  // 1. SQLite available
  try {
    const { BetterSqlite3Storage } = await import('../../plugins/storage/better-sqlite3.js');
    const s = new BetterSqlite3Storage();
    await s.init({});
    checks.push({ name: 'SQLite (better-sqlite3)', status: 'ok', detail: 'Available' });
  } catch {
    checks.push({ name: 'SQLite (better-sqlite3)', status: 'fail', detail: 'Not available' });
  }

  // 2. Database exists
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');
  if (fs.existsSync(dbPath)) {
    checks.push({ name: 'Database', status: 'ok', detail: dbPath });
  } else {
    checks.push({ name: 'Database', status: 'warn', detail: 'Not found — run `context-mem init`' });
  }

  // 3. Config file
  const configPath = path.join(projectDir, '.context-mem.json');
  if (fs.existsSync(configPath)) {
    checks.push({ name: 'Config', status: 'ok', detail: configPath });
  } else {
    checks.push({ name: 'Config', status: 'warn', detail: 'Using defaults' });
  }

  // 4. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  checks.push({ name: 'Node.js', status: major >= 18 ? 'ok' : 'fail', detail: nodeVersion });

  // Print results
  console.log('context-mem doctor\n');
  for (const check of checks) {
    const icon = check.status === 'ok' ? '[OK]' : check.status === 'warn' ? '[WARN]' : '[FAIL]';
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }
}
