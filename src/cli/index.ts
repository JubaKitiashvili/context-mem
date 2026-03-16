#!/usr/bin/env node
import { serve } from './commands/serve.js';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { doctor } from './commands/doctor.js';

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'serve': serve(args); break;
  case 'init': init(args); break;
  case 'status': status(args); break;
  case 'doctor': doctor(args); break;
  default:
    console.log(`context-mem v0.1.0 — Context optimization for AI coding assistants

Usage:
  context-mem serve    Start MCP server (stdio transport)
  context-mem init     Initialize context-mem in current project
  context-mem status   Show database stats and session info
  context-mem doctor   Run health checks
`);
    break;
}
