/**
 * Parser for Claude AI conversation JSON exports.
 * Format: { uuid, name, chat_messages: [{ sender, text, created_at }] }
 */
import type { ParseResult, NormalizedMessage } from './types.js';

export function parseClaudeAI(input: string): ParseResult {
  const messages: NormalizedMessage[] = [];

  try {
    const data = JSON.parse(input);
    const chatMessages = data.chat_messages || data.messages || [];

    for (const msg of chatMessages) {
      const role = msg.sender === 'human' || msg.sender === 'user' ? 'human' : 'assistant';
      const content = msg.text || msg.content || '';
      if (!content.trim()) continue;

      messages.push({
        role,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : undefined,
        speaker: msg.sender,
      });
    }
  } catch {
    // Invalid JSON
  }

  return { messages, source_format: 'claude-ai' };
}
