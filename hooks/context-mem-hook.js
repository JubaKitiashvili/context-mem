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
const toolOutput = data.tool_response || data.tool_output || {};

// Classify what to observe
function getObservation(name, inp, out) {
  const stdout = out.stdout || out.content || out.output || '';
  const content = typeof stdout === 'string' ? stdout : JSON.stringify(stdout);

  switch (name) {
    case 'Bash':
      if (!content || content.length < 10) return null;
      return { content, type: 'log', source: 'Bash' };
    case 'Read':
      // Read tool_output may not include file content — use file_path as observation
      return { content: content.length >= 10 ? content : `Read file: ${inp.file_path}`, type: 'code', source: 'Read', filePath: inp.file_path };
    case 'Write':
    case 'Edit':
      // Edit/Write tool_output may only have exit_code — use input content or file_path
      return { content: inp.content || inp.new_string || content || `${name}: ${inp.file_path}`, type: 'code', source: name, filePath: inp.file_path };
    case 'Grep':
    case 'Glob':
      if (!content || content.length < 10) return null;
      return { content, type: 'context', source: name };
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

// Fire-and-forget POST to HTTP bridge
const http = require('http');
const port = parseInt(process.env.CONTEXT_MEM_API_PORT || '51894', 10);
const payload = JSON.stringify({
  content: cleaned.slice(0, 50000), // Cap at 50KB
  type: obs.type,
  source: obs.source,
  filePath: obs.filePath,
});

// Keep process alive until response arrives or timeout
const guard = setTimeout(() => {}, 2000);

const req = http.request({
  hostname: '127.0.0.1',
  port,
  path: '/api/observe',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  timeout: 1000,
}, (res) => {
  res.resume();
  res.on('end', () => clearTimeout(guard));
});

req.on('error', () => clearTimeout(guard));
req.end(payload);
