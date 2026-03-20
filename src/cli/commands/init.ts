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
  /** Where to write AI rules (relative to project root) — separate file, no conflict */
  rulesPath?: string;
  /** Rules content (markdown) */
  rulesContent?: string;
}

/** Marker to detect if context-mem rules are already present in a markdown file */
const CONTEXT_MEM_MARKER = '# context-mem Integration';

const CONTEXT_MEM_RULES = `# context-mem Integration

context-mem is active in this project. It compresses tool outputs via 14 content-aware summarizers (99% token savings) and serves optimized context through MCP.

## Workflow (IMPORTANT — follow this order)

1. **Session start**: Call \`restore_session\` to recover prior context
2. **Before re-reading files**: Call \`search\` first — the answer may already be stored
3. **After large outputs**: Call \`observe\` to compress and store content
4. **Need details on a search result?**: Call \`get\` with the ID — never guess content
5. **Need chronological context?**: Call \`timeline\` — optionally with \`anchor\` ID for before/after view
6. **When learning patterns**: Call \`save_knowledge\` for decisions, error fixes, API patterns
7. **Periodically**: Call \`budget_status\` — if >80%, call \`restore_session\` to save state and reclaim context

## Rules

- ALWAYS \`search\` before \`get\` — never guess observation IDs
- ALWAYS \`observe\` outputs over 500 tokens — keep context clean
- NEVER call \`get\` without first finding the ID via \`search\` or \`timeline\`
- When \`budget_status\` shows >80%: save your work, call \`restore_session\`

## Available MCP Tools

- \`observe\` — store and compress content (auto-summarized)
- \`search\` / \`get\` / \`timeline\` — retrieve stored context (use in this order)
- \`stats\` — view compression statistics
- \`save_knowledge\` / \`search_knowledge\` — persistent knowledge base
- \`budget_status\` / \`budget_configure\` — token budget management
- \`emit_event\` / \`query_events\` — event tracking
- \`restore_session\` — session continuity + context reclaim
`;

/** Markdown files that get appended to (not overwritten) */
interface MarkdownRulesConfig {
  name: string;
  /** File path relative to project root */
  filePath: string;
  /** Detection: only set up if this file already exists OR platform is detected */
  requireExisting: boolean;
}

const MARKDOWN_RULES: MarkdownRulesConfig[] = [
  { name: 'Claude Code', filePath: 'CLAUDE.md', requireExisting: true },
  { name: 'Gemini CLI', filePath: 'GEMINI.md', requireExisting: true },
];

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
    rulesPath: '.cursor/rules/context-mem.mdc',
    rulesContent: `---
description: context-mem — automatic context optimization for token savings
globs:
alwaysApply: true
---

${CONTEXT_MEM_RULES}`,
  },
  {
    name: 'Windsurf',
    detectDir: '.windsurf',
    detectGlobal: path.join(os.homedir(), '.windsurf'),
    configPath: '.windsurf/mcp.json',
    config: { mcpServers: { 'context-mem': MCP_SERVER_CONFIG } },
    rulesPath: '.windsurf/rules/context-mem.md',
    rulesContent: CONTEXT_MEM_RULES,
  },
  {
    name: 'VS Code / Copilot',
    detectDir: '.vscode',
    configPath: '.vscode/mcp.json',
    config: { servers: { 'context-mem': { type: 'stdio', ...MCP_SERVER_CONFIG } } },
    rulesPath: '.github/copilot-instructions.md',
    rulesContent: CONTEXT_MEM_RULES,
  },
  {
    name: 'Cline',
    detectGlobal: path.join(os.homedir(), '.cline'),
    configPath: '.cline/mcp_settings.json',
    config: { mcpServers: { 'context-mem': { ...MCP_SERVER_CONFIG, disabled: false } } },
    rulesPath: '.clinerules/context-mem.md',
    rulesContent: CONTEXT_MEM_RULES,
  },
  {
    name: 'Roo Code',
    detectGlobal: path.join(os.homedir(), '.roo-code'),
    configPath: '.roo-code/mcp_settings.json',
    config: { mcpServers: { 'context-mem': { ...MCP_SERVER_CONFIG, disabled: false } } },
    rulesPath: '.roo/rules/context-mem.md',
    rulesContent: CONTEXT_MEM_RULES,
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

  // Auto-detect editors and create MCP configs + rules
  const detected = detectEditors(projectDir);
  for (const editor of detected) {
    setupEditorConfig(projectDir, editor);
    setupEditorRules(projectDir, editor);
  }

  // Append to existing markdown instruction files (CLAUDE.md, GEMINI.md)
  for (const mdRules of MARKDOWN_RULES) {
    setupMarkdownRules(projectDir, mdRules);
  }

  console.log('Initialized context-mem in', projectDir);
  console.log('Config: .context-mem.json');
  console.log('Database: .context-mem/store.db');

  if (detected.length === 0) {
    console.log('\nNo editors detected. Add MCP config manually — see: https://github.com/JubaKitiashvili/context-mem#quick-start');
  }

  // Hint about optional vector search
  console.log('');
  console.log('Tip: Enable semantic search (find "auth problem" when stored as "login token expired"):');
  console.log('  npm install @huggingface/transformers');
  console.log('  Then add "vector" to plugins.search in .context-mem.json');
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

/** Create a separate rules file for platforms that use directory-based rules */
function setupEditorRules(projectDir: string, editor: EditorConfig): void {
  if (!editor.rulesPath || !editor.rulesContent) return;

  const fullPath = path.join(projectDir, editor.rulesPath);

  // Skip if rules file already exists (don't overwrite user customizations)
  if (fs.existsSync(fullPath)) {
    const existing = fs.readFileSync(fullPath, 'utf8');
    if (existing.includes('context-mem')) return;
  }

  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // For copilot-instructions.md, append instead of overwrite if file exists
  if (editor.rulesPath === '.github/copilot-instructions.md' && fs.existsSync(fullPath)) {
    const existing = fs.readFileSync(fullPath, 'utf8');
    if (!existing.includes('context-mem')) {
      fs.appendFileSync(fullPath, '\n\n' + editor.rulesContent);
      console.log(`  + ${editor.name}: appended context-mem rules to ${editor.rulesPath}`);
    }
    return;
  }

  fs.writeFileSync(fullPath, editor.rulesContent);
  console.log(`  + ${editor.name}: created rules at ${editor.rulesPath}`);
}

/** Append context-mem section to existing markdown instruction files (CLAUDE.md, GEMINI.md) */
function setupMarkdownRules(projectDir: string, mdRules: MarkdownRulesConfig): void {
  const fullPath = path.join(projectDir, mdRules.filePath);

  if (!fs.existsSync(fullPath)) {
    if (mdRules.requireExisting) return; // Don't create CLAUDE.md from scratch
    fs.writeFileSync(fullPath, CONTEXT_MEM_RULES);
    console.log(`  + ${mdRules.name}: created ${mdRules.filePath}`);
    return;
  }

  const existing = fs.readFileSync(fullPath, 'utf8');

  // Already has context-mem section
  if (existing.includes(CONTEXT_MEM_MARKER)) return;

  // Append to existing file
  fs.appendFileSync(fullPath, '\n\n' + CONTEXT_MEM_RULES);
  console.log(`  + ${mdRules.name}: appended context-mem rules to ${mdRules.filePath}`);
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
