/**
 * Parser for Slack channel export JSON.
 * Format: [{ user, text, ts, ... }]
 */
import type { ParseResult, NormalizedMessage } from './types.js';

export function parseSlack(input: string): ParseResult {
  const messages: NormalizedMessage[] = [];

  try {
    const data = JSON.parse(input);
    const msgs = Array.isArray(data) ? data : data.messages || [];

    for (const msg of msgs) {
      if (!msg.text || msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') continue;

      messages.push({
        role: 'human', // Slack messages are all from humans
        content: msg.text,
        timestamp: msg.ts ? Math.floor(parseFloat(msg.ts) * 1000) : undefined,
        speaker: msg.user || msg.username,
      });
    }
  } catch {
    // Invalid JSON
  }

  return { messages, source_format: 'slack' };
}
