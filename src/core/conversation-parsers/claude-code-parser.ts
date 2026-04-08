/**
 * Parser for Claude Code JSONL transcripts.
 * Each line is a JSON object with {role, content, ...}
 */
import type { ParseResult, NormalizedMessage } from './types.js';

export function parseClaudeCode(input: string): ParseResult {
  const messages: NormalizedMessage[] = [];
  const lines = input.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.role && obj.content) {
        messages.push({
          role: obj.role === 'user' ? 'human' : obj.role === 'assistant' ? 'assistant' : 'system',
          content: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content),
          timestamp: obj.timestamp || obj.created_at,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { messages, source_format: 'claude-code' };
}
