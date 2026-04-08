export interface NormalizedMessage {
  role: 'human' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  speaker?: string;
}

export interface ParseResult {
  messages: NormalizedMessage[];
  source_format: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationParser {
  parse(input: string): ParseResult;
}
