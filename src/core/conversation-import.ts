/**
 * Conversation Import Engine — parse external conversation exports into observations.
 */

import type { StoragePlugin } from './types.js';
import type { Pipeline } from './pipeline.js';
import { parseConversation } from './conversation-parsers/auto-detect.js';
import type { ConversationFormat } from './conversation-parsers/auto-detect.js';
import type { NormalizedMessage } from './conversation-parsers/types.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  format: string;
  errors: string[];
}

/**
 * Import conversations from a string content.
 */
export async function importConversations(
  content: string,
  pipeline: Pipeline,
  opts?: { format?: ConversationFormat; filename?: string },
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, format: '', errors: [] };

  // Parse
  const parsed = parseConversation(content, opts?.format, opts?.filename);
  result.format = parsed.source_format;

  if (parsed.messages.length === 0) {
    result.errors.push('No messages found in input');
    return result;
  }

  // Chunk into exchanges (human+assistant pairs)
  const exchanges = chunkExchanges(parsed.messages);

  // Import each exchange as an observation
  for (const exchange of exchanges) {
    try {
      const obsContent = exchange.map(m => `${m.role}: ${m.content}`).join('\n\n');
      const type = exchange.some(m => m.role === 'assistant') ? 'context' as const : 'log' as const;

      await pipeline.observe(obsContent, type, `imported:${parsed.source_format}`);
      result.imported++;
    } catch (err) {
      if ((err as Error).message.includes('duplicate') || (err as Error).message.includes('content_hash')) {
        result.skipped++;
      } else {
        result.errors.push((err as Error).message);
      }
    }
  }

  return result;
}

/**
 * Chunk messages into exchanges (human question + assistant response pairs).
 */
function chunkExchanges(messages: NormalizedMessage[]): NormalizedMessage[][] {
  const exchanges: NormalizedMessage[][] = [];
  let current: NormalizedMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'human' && current.length > 0) {
      exchanges.push(current);
      current = [];
    }
    current.push(msg);
  }

  if (current.length > 0) {
    exchanges.push(current);
  }

  return exchanges;
}
