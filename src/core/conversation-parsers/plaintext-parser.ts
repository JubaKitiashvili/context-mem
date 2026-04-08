/**
 * Parser for plain text transcripts.
 * Format: "> human" / "assistant" blocks separated by blank lines.
 */
import type { ParseResult, NormalizedMessage } from './types.js';

export function parsePlaintext(input: string): ParseResult {
  const messages: NormalizedMessage[] = [];
  const blocks = input.split(/\n\s*\n/).filter(b => b.trim());

  for (const block of blocks) {
    const trimmed = block.trim();

    if (trimmed.startsWith('> human') || trimmed.startsWith('Human:') || trimmed.startsWith('User:')) {
      const content = trimmed.replace(/^>\s*human\s*/i, '').replace(/^(Human|User):\s*/i, '').trim();
      if (content) messages.push({ role: 'human', content });
    } else if (trimmed.startsWith('assistant') || trimmed.startsWith('Assistant:') || trimmed.startsWith('Claude:')) {
      const content = trimmed.replace(/^assistant\s*/i, '').replace(/^(Assistant|Claude):\s*/i, '').trim();
      if (content) messages.push({ role: 'assistant', content });
    } else if (messages.length > 0) {
      // Append to last message if no role prefix
      messages[messages.length - 1].content += '\n' + trimmed;
    }
  }

  return { messages, source_format: 'plaintext' };
}
