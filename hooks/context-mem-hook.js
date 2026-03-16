#!/usr/bin/env node
'use strict';

// Read stdin
let input = '';
try {
  const fs = require('fs');
  input = fs.readFileSync(0, 'utf8');
} catch { process.exit(0); }

if (!input.trim()) process.exit(0);

let data;
try {
  data = JSON.parse(input);
} catch { process.exit(0); }

const toolName = data.tool_name;
const toolInput = data.tool_input || {};
const toolOutput = data.tool_output || {};

// Classify what to observe
function getObservation(name, inp, out) {
  const stdout = out.stdout || out.content || out.output || '';
  const content = typeof stdout === 'string' ? stdout : JSON.stringify(stdout);

  if (!content || content.length < 10) return null;

  switch (name) {
    case 'Bash': return { content, type: 'log', source: 'Bash' };
    case 'Read': return { content, type: 'code', source: 'Read', filePath: inp.file_path };
    case 'Write':
    case 'Edit': return { content: inp.content || content, type: 'code', source: name, filePath: inp.file_path };
    case 'Grep':
    case 'Glob': return { content, type: 'context', source: name };
    default: return null;
  }
}

const obs = getObservation(toolName, toolInput, toolOutput);
if (!obs) process.exit(0);

// Strip basic private tags before sending
let cleaned = obs.content;
cleaned = cleaned.replace(/<private>[\s\S]*?<\/private>/gi, '');
cleaned = cleaned.replace(/<redact>[\s\S]*?<\/redact>/gi, '[REDACTED]');

if (cleaned.length < 10) process.exit(0);

// Fire-and-forget POST to MCP server
const http = require('http');
const port = parseInt(process.env.CONTEXT_MEM_PORT || '3457', 10);
const payload = JSON.stringify({
  jsonrpc: '2.0',
  method: 'tools/call',
  params: {
    name: 'observe',
    arguments: {
      content: cleaned.slice(0, 50000), // Cap at 50KB
      type: obs.type,
      source: obs.source,
    }
  }
});

const req = http.request({
  hostname: '127.0.0.1',
  port,
  path: '/',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  timeout: 500,
}, () => {});

req.on('error', () => {}); // Fire and forget
req.write(payload);
req.end();
