#!/usr/bin/env node
import { serve } from './commands/serve.js';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { doctor } from './commands/doctor.js';
import { dashboard } from './commands/dashboard.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { createSummarizer } from './commands/create-summarizer.js';
import { plugin } from './commands/plugin.js';
import { why } from './commands/why.js';
import { story } from './commands/story.js';
import { importConvos } from './commands/import-convos.js';

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case 'serve': await serve(args); break;
    case 'init': await init(args); break;
    case 'status': await status(args); break;
    case 'doctor': await doctor(args); break;
    case 'dashboard': await dashboard(args); break;
    case 'export': await exportCommand(args); break;
    case 'import': await importCommand(args); break;
    case 'create-summarizer': await createSummarizer(args); break;
    case 'plugin': await plugin(args); break;
    case 'why': await why(args); break;
    case 'story': await story(args); break;
    case 'import-convos': await importConvos(args); break;
    default:
      console.log(`context-mem v3.0.0 — AI memory with Total Recall

Usage:
  context-mem serve       Start MCP server (stdio transport)
  context-mem init        Initialize context-mem in current project
  context-mem status      Show database stats and session info
  context-mem doctor      Run health checks
  context-mem dashboard   Open real-time dashboard (web UI)
  context-mem export      Export knowledge, snapshots, events as JSON
  context-mem import      Import data from JSON export file
  context-mem why <query>           Explain why a decision was made (decision trail)
  context-mem story [--format pr]   Generate narrative (pr/standup/adr/onboarding)
  context-mem import-convos <path>  Import conversations (ChatGPT/Claude/Slack/text)
  context-mem create-summarizer <name>  Scaffold a custom summarizer plugin
  context-mem plugin <sub>              Manage summarizer plugins (add/remove/list)
`);
      break;
  }
}

main().catch(err => {
  console.error('context-mem error:', err.message || err);
  process.exit(1);
});
