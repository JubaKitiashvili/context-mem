#!/usr/bin/env node
import { serve } from './commands/serve.js';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { doctor } from './commands/doctor.js';
import { dashboard } from './commands/dashboard.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';

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
    default:
      console.log(`context-mem v0.7.0 — Context optimization for AI coding assistants

Usage:
  context-mem serve       Start MCP server (stdio transport)
  context-mem init        Initialize context-mem in current project
  context-mem status      Show database stats and session info
  context-mem doctor      Run health checks
  context-mem dashboard   Open real-time dashboard (web UI)
  context-mem export      Export knowledge, snapshots, events as JSON
  context-mem import      Import data from JSON export file
`);
      break;
  }
}

main().catch(err => {
  console.error('context-mem error:', err.message || err);
  process.exit(1);
});
