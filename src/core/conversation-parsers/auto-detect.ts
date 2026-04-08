/**
 * Auto-detect conversation format from content.
 */
import type { ParseResult } from './types.js';
import { parseClaudeCode } from './claude-code-parser.js';
import { parseClaudeAI } from './claude-ai-parser.js';
import { parseChatGPT } from './chatgpt-parser.js';
import { parseSlack } from './slack-parser.js';
import { parsePlaintext } from './plaintext-parser.js';

export type ConversationFormat = 'claude-code' | 'claude-ai' | 'chatgpt' | 'slack' | 'plaintext' | 'auto';

export function detectFormat(content: string, filename?: string): ConversationFormat {
  const trimmed = content.trim();

  // Check file extension
  if (filename) {
    if (filename.endsWith('.jsonl')) return 'claude-code';
  }

  // JSONL: multiple JSON objects per line
  if (trimmed.includes('\n') && trimmed.startsWith('{')) {
    const firstLine = trimmed.split('\n')[0];
    try {
      const obj = JSON.parse(firstLine);
      if (obj.role && obj.content) return 'claude-code';
    } catch { /* not JSONL */ }
  }

  // Single JSON object or array
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);

      // ChatGPT: has mapping property
      if (Array.isArray(data) && data[0]?.mapping) return 'chatgpt';
      if (data.mapping) return 'chatgpt';

      // Claude AI: has chat_messages
      if (data.chat_messages || (data.uuid && data.messages)) return 'claude-ai';

      // Slack: array of objects with ts and text
      if (Array.isArray(data) && data[0]?.ts && data[0]?.text) return 'slack';
      if (data.messages && Array.isArray(data.messages) && data.messages[0]?.ts) return 'slack';
    } catch { /* not valid JSON */ }
  }

  // Plaintext: has "> human" or "Human:" prefixes
  if (/^>\s*human/im.test(trimmed) || /^Human:/m.test(trimmed) || /^User:/m.test(trimmed)) {
    return 'plaintext';
  }

  return 'plaintext'; // default fallback
}

export function parseConversation(content: string, format?: ConversationFormat, filename?: string): ParseResult {
  const fmt = format === 'auto' || !format ? detectFormat(content, filename) : format;

  switch (fmt) {
    case 'claude-code': return parseClaudeCode(content);
    case 'claude-ai': return parseClaudeAI(content);
    case 'chatgpt': return parseChatGPT(content);
    case 'slack': return parseSlack(content);
    case 'plaintext': return parsePlaintext(content);
    default: return parsePlaintext(content);
  }
}
