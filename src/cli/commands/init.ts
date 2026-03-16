import fs from 'node:fs';
import path from 'node:path';

export async function init(_args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const configPath = path.join(projectDir, '.context-mem.json');

  if (fs.existsSync(configPath)) {
    console.log('context-mem already initialized (found .context-mem.json)');
    return;
  }

  // Create default config
  const config = {
    storage: 'auto',
    plugins: { summarizers: ['shell', 'json', 'error', 'log', 'code'], search: ['bm25', 'trigram'] },
    privacy: { strip_tags: true, redact_patterns: [] },
    token_economics: true,
    lifecycle: { ttl_days: 30, max_observations: 50000, cleanup_schedule: 'on_startup' },
    db_path: '.context-mem/store.db',
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Create .context-mem directory
  const dbDir = path.join(projectDir, '.context-mem');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  // Add to .gitignore if exists
  const gitignorePath = path.join(projectDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.context-mem')) {
      fs.appendFileSync(gitignorePath, '\n# context-mem\n.context-mem/\n');
      console.log('Added .context-mem/ to .gitignore');
    }
  }

  console.log('Initialized context-mem in', projectDir);
  console.log('Config: .context-mem.json');
  console.log('Database: .context-mem/store.db');
}
