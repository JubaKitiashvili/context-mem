import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_TEMPLATES } from '../../core/prompt-templates.js';

describe('prompt template validators', () => {
  describe('expand_query', () => {
    const t = PROMPT_TEMPLATES.expand_query;

    it('accepts valid expansion', () => {
      assert.equal(t.validate({ expanded: ['auth', 'jwt', 'login'], original: 'auth' }), true);
    });

    it('rejects missing expanded array', () => {
      assert.equal(t.validate({ original: 'auth' }), false);
    });

    it('rejects non-array expanded', () => {
      assert.equal(t.validate({ expanded: 'auth jwt', original: 'auth' }), false);
    });

    it('rejects too many expanded terms', () => {
      assert.equal(t.validate({ expanded: ['a', 'b', 'c', 'd', 'e', 'f'], original: 'x' }), false);
    });
  });

  describe('generate_title', () => {
    const t = PROMPT_TEMPLATES.generate_title;

    it('accepts valid title', () => {
      assert.equal(t.validate({ title: 'JWT Auth Pattern' }), true);
    });

    it('rejects empty title', () => {
      assert.equal(t.validate({ title: '' }), false);
    });

    it('rejects too-long title', () => {
      assert.equal(t.validate({ title: 'x'.repeat(81) }), false);
    });

    it('rejects non-string title', () => {
      assert.equal(t.validate({ title: 123 }), false);
    });
  });

  describe('generate_tags', () => {
    const t = PROMPT_TEMPLATES.generate_tags;

    it('accepts valid tags', () => {
      assert.equal(t.validate({ tags: ['jwt', 'auth', 'security'] }), true);
    });

    it('rejects empty tags', () => {
      assert.equal(t.validate({ tags: [] }), false);
    });

    it('rejects too many tags', () => {
      assert.equal(t.validate({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), false);
    });
  });

  describe('explain_contradiction', () => {
    const t = PROMPT_TEMPLATES.explain_contradiction;

    it('accepts valid explanation', () => {
      assert.equal(t.validate({ conflict: 'JWT vs cookies', merged_content: 'Support both' }), true);
    });

    it('rejects too-long merged content', () => {
      assert.equal(t.validate({ conflict: 'x', merged_content: 'y'.repeat(201) }), false);
    });
  });

  describe('summarize', () => {
    const t = PROMPT_TEMPLATES.summarize;

    it('accepts valid summary', () => {
      assert.equal(t.validate({ summary: 'Fixed JWT bug', key_terms: ['JWT', 'bug'] }), true);
    });

    it('rejects too-long summary', () => {
      assert.equal(t.validate({ summary: 'x'.repeat(201), key_terms: [] }), false);
    });

    it('rejects non-array key_terms', () => {
      assert.equal(t.validate({ summary: 'ok', key_terms: 'jwt' }), false);
    });
  });

  describe('prompt generation', () => {
    it('expand_query generates prompt with query', () => {
      const prompt = PROMPT_TEMPLATES.expand_query.prompt('auth');
      assert.ok(prompt.includes('auth'), 'prompt should contain query');
      assert.ok(prompt.includes('JSON'), 'prompt should mention JSON');
    });

    it('generate_title truncates long content', () => {
      const longContent = 'x'.repeat(1000);
      const prompt = PROMPT_TEMPLATES.generate_title.prompt(longContent);
      assert.ok(prompt.length < 1000, 'prompt should truncate content');
    });

    it('explain_contradiction takes two entries', () => {
      const prompt = PROMPT_TEMPLATES.explain_contradiction.prompt('Entry A content', 'Entry B content');
      assert.ok(prompt.includes('Entry A'), 'prompt should contain entry A');
      assert.ok(prompt.includes('Entry B'), 'prompt should contain entry B');
    });
  });
});
