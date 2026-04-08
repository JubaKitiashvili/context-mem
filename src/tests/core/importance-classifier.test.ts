import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportance } from '../../core/importance-classifier.js';
import type { SignificanceFlag } from '../../core/importance-classifier.js';

describe('Importance Classifier', () => {
  describe('base scores by observation type', () => {
    it('error type gets 0.8', () => {
      const result = classifyImportance('some error happened', 'error');
      // 'error' base=0.8, plus PROBLEM flag from 'error' keyword, but score is just base + boosts
      assert.ok(result.score >= 0.8);
    });

    it('decision type gets 0.9', () => {
      const result = classifyImportance('we made a choice', 'decision');
      assert.ok(result.score >= 0.9);
    });

    it('code type gets 0.5', () => {
      const result = classifyImportance('function foo() {}', 'code');
      assert.equal(result.score, 0.5);
    });

    it('log type gets 0.3', () => {
      const result = classifyImportance('INFO: request processed', 'log');
      assert.equal(result.score, 0.3);
    });

    it('context type gets 0.4', () => {
      const result = classifyImportance('some context info', 'context');
      assert.equal(result.score, 0.4);
    });

    it('test type gets 0.6', () => {
      const result = classifyImportance('test passed successfully', 'test');
      assert.equal(result.score, 0.6);
    });

    it('commit type gets 0.7', () => {
      const result = classifyImportance('feat: add new feature', 'commit');
      assert.equal(result.score, 0.7);
    });

    it('unknown type gets default 0.5', () => {
      const result = classifyImportance('something', 'unknown_type');
      assert.equal(result.score, 0.5);
    });
  });

  describe('keyword boost', () => {
    it('critical keyword adds +0.2', () => {
      const result = classifyImportance('this is a critical issue', 'context');
      // base 0.4 + keyword 0.2 = 0.6
      assert.equal(result.score, 0.6);
    });

    it('breaking keyword adds +0.2', () => {
      const result = classifyImportance('this is a breaking change', 'context');
      assert.equal(result.score, 0.6);
    });

    it('never keyword adds +0.2', () => {
      const result = classifyImportance('you should never do this', 'context');
      // base 0.4 + keyword 0.2 = 0.6, also gets CORE flag from 'never'
      assert.equal(result.score, 0.6);
    });
  });

  describe('resolution boost', () => {
    it('fixed by phrase adds +0.15', () => {
      const result = classifyImportance('fixed by updating the config', 'context');
      assert.equal(result.score, 0.55);
    });

    it('resolved keyword adds +0.15', () => {
      const result = classifyImportance('the issue was resolved', 'context');
      assert.equal(result.score, 0.55);
    });
  });

  describe('entity mention boost', () => {
    it('entities present adds +0.1', () => {
      const result = classifyImportance('plain text', 'context', { entities: ['React'] });
      assert.equal(result.score, 0.5);
    });

    it('empty entities array does not boost', () => {
      const result = classifyImportance('plain text', 'context', { entities: [] });
      assert.equal(result.score, 0.4);
    });
  });

  describe('length signal', () => {
    it('long content (>2000 chars) adds +0.1', () => {
      const longContent = 'a'.repeat(2001);
      const result = classifyImportance(longContent, 'context');
      assert.equal(result.score, 0.5);
    });

    it('short content does not add length boost', () => {
      const result = classifyImportance('short', 'context');
      assert.equal(result.score, 0.4);
    });
  });

  describe('score clamping', () => {
    it('score never exceeds 1.0 with multiple boosts', () => {
      // decision(0.9) + keyword(0.2) + resolution(0.15) + entity(0.1) + length(0.1) = 1.45 → clamped to 1.0
      const longContent = 'We decided to always use this critical approach, fixed by ' + 'x'.repeat(2000);
      const result = classifyImportance(longContent, 'decision', { entities: ['React'] });
      assert.equal(result.score, 1.0);
    });

    it('score never goes below 0.0', () => {
      const result = classifyImportance('hello', 'log');
      assert.ok(result.score >= 0.0);
    });
  });

  describe('significance flags', () => {
    it('detects DECISION flag', () => {
      const result = classifyImportance('we decided to use PostgreSQL', 'context');
      assert.ok(result.flags.includes('DECISION'));
    });

    it('detects ORIGIN flag', () => {
      const result = classifyImportance('created a new project today', 'context');
      assert.ok(result.flags.includes('ORIGIN'));
    });

    it('detects PIVOT flag', () => {
      const result = classifyImportance('we switched from MySQL to PostgreSQL', 'context');
      assert.ok(result.flags.includes('PIVOT'));
    });

    it('detects CORE flag', () => {
      const result = classifyImportance('you must never mutate state directly', 'context');
      assert.ok(result.flags.includes('CORE'));
    });

    it('detects MILESTONE flag', () => {
      const result = classifyImportance('we shipped v2.0 to production', 'context');
      assert.ok(result.flags.includes('MILESTONE'));
    });

    it('detects PROBLEM flag', () => {
      const result = classifyImportance('there is a bug in the auth module', 'context');
      assert.ok(result.flags.includes('PROBLEM'));
    });

    it('detects multiple flags in same content', () => {
      const result = classifyImportance('we decided to fix the bug and shipped the patch', 'context');
      assert.ok(result.flags.includes('DECISION'));
      assert.ok(result.flags.includes('PROBLEM'));
      assert.ok(result.flags.includes('MILESTONE'));
    });
  });

  describe('auto-pin', () => {
    it('pins DECISION-flagged observations', () => {
      const result = classifyImportance('we decided to use Redis', 'context');
      assert.equal(result.pinned, true);
    });

    it('pins MILESTONE-flagged observations', () => {
      const result = classifyImportance('we shipped the feature', 'context');
      assert.equal(result.pinned, true);
    });

    it('does not pin PROBLEM-only observations', () => {
      const result = classifyImportance('there is a bug here', 'context');
      assert.equal(result.pinned, false);
    });

    it('does not pin ORIGIN-only observations', () => {
      const result = classifyImportance('initialized the repo', 'context');
      assert.equal(result.pinned, false);
    });
  });

  describe('edge cases', () => {
    it('empty content returns default', () => {
      const result = classifyImportance('', 'context');
      assert.equal(result.score, 0.5);
      assert.deepEqual(result.flags, []);
      assert.equal(result.pinned, false);
    });

    it('whitespace-only content returns default', () => {
      const result = classifyImportance('   \n\t  ', 'context');
      assert.equal(result.score, 0.5);
      assert.deepEqual(result.flags, []);
      assert.equal(result.pinned, false);
    });

    it('combined signals produce correct result', () => {
      // error type(0.8) + keyword 'critical'(+0.2) = 1.0
      const result = classifyImportance('critical failure in production, bug confirmed', 'error');
      assert.equal(result.score, 1.0);
      assert.ok(result.flags.includes('PROBLEM'));
    });
  });
});
