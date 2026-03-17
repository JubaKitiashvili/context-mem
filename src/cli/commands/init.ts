import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface EditorConfig {
  name: string;
  /** Directory to check for existence (relative to project root) */
  detectDir?: string;
  /** Global config path to check */
  detectGlobal?: string;
  /** Where to write the MCP config (relative to project root) */
  configPath: string;
  /** Config content */
  config: object;
}

const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['-y', 'context-mem', 'serve'],
};

const EDITORS: EditorConfig[] = [
  {
    name: 'Cursor',
    detectDir: '.cursor',
    detectGlobal: path.join(os.homedir(), '.cursor'),
    configPath: '.cursor/mcp.json',
    config: { mcpServers: { 'context-mem': MCP_SERVER_CONFIG } },
  },
  {
    name: 'Windsurf',
    detectDir: '.windsurf',
    detectGlobal: path.join(os.homedir(), '.windsurf'),
    configPath: '.windsurf/mcp.json',
    config: { mcpServers: { 'context-mem': MCP_SERVER_CONFIG } },
  },
  {
    name: 'VS Code / Copilot',
    detectDir: '.vscode',
    configPath: '.vscode/mcp.json',
    config: { servers: { 'context-mem': { type: 'stdio', ...MCP_SERVER_CONFIG } } },
  },
  {
    name: 'Cline',
    detectGlobal: path.join(os.homedir(), '.cline'),
    configPath: '.cline/mcp_settings.json',
    config: { mcpServers: { 'context-mem': { ...MCP_SERVER_CONFIG, disabled: false } } },
  },
  {
    name: 'Roo Code',
    detectGlobal: path.join(os.homedir(), '.roo-code'),
    configPath: '.roo-code/mcp_settings.json',
    config: { mcpServers: { 'context-mem': { ...MCP_SERVER_CONFIG, disabled: false } } },
  },
];

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

  // Auto-detect editors and create MCP configs
  const detected = detectEditors(projectDir);
  for (const editor of detected) {
    setupEditorConfig(projectDir, editor);
  }

  console.log('Initialized context-mem in', projectDir);
  console.log('Config: .context-mem.json');
  console.log('Database: .context-mem/store.db');

  if (detected.length === 0) {
    console.log('\nNo editors detected. Add MCP config manually — see: https://github.com/JubaKitiashvili/context-mem#quick-start');
  }
}

function detectEditors(projectDir: string): EditorConfig[] {
  const found: EditorConfig[] = [];

  for (const editor of EDITORS) {
    // Check project-level directory (e.g. .cursor/ in project)
    if (editor.detectDir && fs.existsSync(path.join(projectDir, editor.detectDir))) {
      found.push(editor);
      continue;
    }
    // Check global installation (e.g. ~/.cursor)
    if (editor.detectGlobal && fs.existsSync(editor.detectGlobal)) {
      found.push(editor);
    }
  }

  return found;
}

function setupEditorConfig(projectDir: string, editor: EditorConfig): void {
  const fullPath = path.join(projectDir, editor.configPath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(fullPath)) {
    // Merge into existing config
    try {
      const existing = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const serverKey = 'mcpServers' in editor.config ? 'mcpServers' : 'servers';
      const configServers = (editor.config as any)[serverKey];

      if (!existing[serverKey]) existing[serverKey] = {};

      if (existing[serverKey]['context-mem']) {
        // Already configured
        return;
      }

      existing[serverKey]['context-mem'] = configServers['context-mem'];
      fs.writeFileSync(fullPath, JSON.stringify(existing, null, 2) + '\n');
      console.log(`  + ${editor.name}: added context-mem to existing ${editor.configPath}`);
    } catch {
      // Can't parse existing config, skip
      return;
    }
  } else {
    fs.writeFileSync(fullPath, JSON.stringify(editor.config, null, 2) + '\n');
    console.log(`  + ${editor.name}: created ${editor.configPath}`);
  }
}
