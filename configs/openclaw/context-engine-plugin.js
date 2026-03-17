/**
 * context-mem ContextEngine plugin for OpenClaw.
 *
 * Usage:
 *   npm install context-mem
 *   Add "context-mem" to contextEngine.plugins in your OpenClaw config.
 *
 * This plugin hooks into OpenClaw's tool execution lifecycle,
 * compresses outputs via 14 content-aware summarizers, and provides
 * optimized context through MCP tools.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

let serverProcess = null;

module.exports = {
  name: 'context-mem',
  version: '0.2.0',
  description: 'Context optimization — 99% token savings via 14 content-aware summarizers',

  /** Called when OpenClaw initializes the plugin */
  async activate(context) {
    const cwd = context.workspaceRoot || process.cwd();

    // Start context-mem MCP server
    serverProcess = spawn('npx', ['-y', 'context-mem', 'serve'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    serverProcess.stderr?.on('data', (data) => {
      if (context.logger) {
        context.logger.debug(`[context-mem] ${data.toString().trim()}`);
      }
    });

    serverProcess.on('error', (err) => {
      if (context.logger) {
        context.logger.error(`[context-mem] Failed to start: ${err.message}`);
      }
    });

    return {
      mcpServer: {
        name: 'context-mem',
        transport: 'stdio',
        process: serverProcess,
      },
    };
  },

  /** Called when OpenClaw shuts down */
  async deactivate() {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
  },

  /** Hook: after tool execution — capture and compress output */
  async onToolResult(toolName, result, context) {
    if (!serverProcess?.stdin) return result;

    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'observe',
        arguments: {
          content: typeof result === 'string' ? result : JSON.stringify(result),
          type: toolName,
        },
      },
    };

    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    return result;
  },
};
