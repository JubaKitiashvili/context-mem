/**
 * Parser for ChatGPT conversations.json exports.
 * Format: [{ title, mapping: { id: { message: { role, content: { parts } } } } }]
 */
import type { ParseResult, NormalizedMessage } from './types.js';

export function parseChatGPT(input: string): ParseResult {
  const messages: NormalizedMessage[] = [];

  try {
    const data = JSON.parse(input);
    const conversations = Array.isArray(data) ? data : [data];

    for (const conv of conversations) {
      if (!conv.mapping) continue;

      // Walk the message tree
      const nodes = Object.values(conv.mapping) as Array<{
        message?: { author?: { role?: string }; content?: { parts?: string[] }; create_time?: number };
        children?: string[];
      }>;

      for (const node of nodes) {
        if (!node.message?.content?.parts) continue;
        const role = node.message.author?.role;
        if (role !== 'user' && role !== 'assistant') continue;

        const content = node.message.content.parts.join('\n').trim();
        if (!content) continue;

        messages.push({
          role: role === 'user' ? 'human' : 'assistant',
          content,
          timestamp: node.message.create_time ? Math.floor(node.message.create_time * 1000) : undefined,
        });
      }
    }
  } catch {
    // Invalid JSON
  }

  return { messages, source_format: 'chatgpt' };
}
