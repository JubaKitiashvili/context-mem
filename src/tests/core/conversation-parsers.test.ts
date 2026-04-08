import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeCode } from '../../core/conversation-parsers/claude-code-parser.js';
import { parseClaudeAI } from '../../core/conversation-parsers/claude-ai-parser.js';
import { parseChatGPT } from '../../core/conversation-parsers/chatgpt-parser.js';
import { parseSlack } from '../../core/conversation-parsers/slack-parser.js';
import { parsePlaintext } from '../../core/conversation-parsers/plaintext-parser.js';
import { detectFormat, parseConversation } from '../../core/conversation-parsers/auto-detect.js';

describe('Conversation Parsers', () => {
  describe('Claude Code JSONL', () => {
    it('parses valid JSONL', () => {
      const input = '{"role":"user","content":"Hello"}\n{"role":"assistant","content":"Hi there"}';
      const result = parseClaudeCode(input);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].role, 'human');
      assert.equal(result.messages[1].role, 'assistant');
    });

    it('handles malformed lines gracefully', () => {
      const input = '{"role":"user","content":"Hello"}\nnot json\n{"role":"assistant","content":"Hi"}';
      const result = parseClaudeCode(input);
      assert.equal(result.messages.length, 2);
    });

    it('returns empty for empty input', () => {
      assert.equal(parseClaudeCode('').messages.length, 0);
    });
  });

  describe('Claude AI JSON', () => {
    it('parses conversation with chat_messages', () => {
      const input = JSON.stringify({
        uuid: 'test',
        chat_messages: [
          { sender: 'human', text: 'What is React?' },
          { sender: 'assistant', text: 'React is a library' },
        ],
      });
      const result = parseClaudeAI(input);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].role, 'human');
      assert.equal(result.messages[0].content, 'What is React?');
    });

    it('handles empty messages', () => {
      const input = JSON.stringify({ chat_messages: [{ sender: 'human', text: '' }] });
      const result = parseClaudeAI(input);
      assert.equal(result.messages.length, 0);
    });

    it('handles invalid JSON', () => {
      assert.equal(parseClaudeAI('not json').messages.length, 0);
    });
  });

  describe('ChatGPT JSON', () => {
    it('parses conversation with mapping', () => {
      const input = JSON.stringify([{
        title: 'Test',
        mapping: {
          'a': { message: { author: { role: 'user' }, content: { parts: ['Hello'] } } },
          'b': { message: { author: { role: 'assistant' }, content: { parts: ['World'] } } },
        },
      }]);
      const result = parseChatGPT(input);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].role, 'human');
      assert.equal(result.messages[1].content, 'World');
    });

    it('skips system messages', () => {
      const input = JSON.stringify([{
        mapping: {
          'a': { message: { author: { role: 'system' }, content: { parts: ['System prompt'] } } },
        },
      }]);
      assert.equal(parseChatGPT(input).messages.length, 0);
    });

    it('handles invalid JSON', () => {
      assert.equal(parseChatGPT('bad').messages.length, 0);
    });
  });

  describe('Slack JSON', () => {
    it('parses channel messages', () => {
      const input = JSON.stringify([
        { user: 'U123', text: 'Hello team', ts: '1700000000.000' },
        { user: 'U456', text: 'Hey!', ts: '1700000001.000' },
      ]);
      const result = parseSlack(input);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].speaker, 'U123');
    });

    it('skips join/leave messages', () => {
      const input = JSON.stringify([
        { user: 'U123', text: 'joined', subtype: 'channel_join', ts: '1700000000.000' },
        { user: 'U456', text: 'Hello', ts: '1700000001.000' },
      ]);
      assert.equal(parseSlack(input).messages.length, 1);
    });

    it('handles invalid JSON', () => {
      assert.equal(parseSlack('bad').messages.length, 0);
    });
  });

  describe('Plaintext', () => {
    it('parses human/assistant blocks', () => {
      const input = '> human\nWhat is TypeScript?\n\nassistant\nTypeScript is a typed superset of JavaScript.';
      const result = parsePlaintext(input);
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].role, 'human');
      assert.equal(result.messages[1].role, 'assistant');
    });

    it('parses Human:/Assistant: format', () => {
      const input = 'Human: Hello\n\nAssistant: Hi there';
      const result = parsePlaintext(input);
      assert.equal(result.messages.length, 2);
    });

    it('handles empty input', () => {
      assert.equal(parsePlaintext('').messages.length, 0);
    });
  });

  describe('Auto-detection', () => {
    it('detects JSONL as claude-code', () => {
      assert.equal(detectFormat('{"role":"user","content":"hi"}\n{"role":"assistant","content":"hey"}'), 'claude-code');
    });

    it('detects ChatGPT format', () => {
      assert.equal(detectFormat(JSON.stringify([{ mapping: {} }])), 'chatgpt');
    });

    it('detects plaintext with > human prefix', () => {
      assert.equal(detectFormat('> human\nHello\n\nassistant\nHi'), 'plaintext');
    });

    it('parseConversation auto-detects and parses', () => {
      const input = '{"role":"user","content":"test"}\n{"role":"assistant","content":"ok"}';
      const result = parseConversation(input);
      assert.equal(result.source_format, 'claude-code');
      assert.equal(result.messages.length, 2);
    });
  });
});
