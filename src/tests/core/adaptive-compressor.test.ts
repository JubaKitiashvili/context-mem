import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTargetTier, compressToTier } from '../../core/adaptive-compressor.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Adaptive Compressor', () => {
  describe('getTargetTier', () => {
    it('returns verbatim for observations < 7 days old', () => {
      const indexed_at = Date.now() - 3 * DAY_MS;
      assert.equal(getTargetTier(indexed_at, 0.5, false), 'verbatim');
    });

    it('returns light for observations 7-30 days old', () => {
      const indexed_at = Date.now() - 10 * DAY_MS;
      assert.equal(getTargetTier(indexed_at, 0.5, false), 'light');
    });

    it('returns medium for observations 30-90 days old', () => {
      const indexed_at = Date.now() - 45 * DAY_MS;
      assert.equal(getTargetTier(indexed_at, 0.5, false), 'medium');
    });

    it('returns distilled for observations > 90 days old', () => {
      const indexed_at = Date.now() - 100 * DAY_MS;
      assert.equal(getTargetTier(indexed_at, 0.5, false), 'distilled');
    });

    it('pinned observations always return verbatim', () => {
      const indexed_at = Date.now() - 365 * DAY_MS; // 1 year old
      assert.equal(getTargetTier(indexed_at, 0.5, true), 'verbatim');
    });

    it('high importance (>=0.8) skips one tier: light → verbatim', () => {
      const indexed_at = Date.now() - 10 * DAY_MS; // would be light
      assert.equal(getTargetTier(indexed_at, 0.85, false), 'verbatim');
    });

    it('high importance (>=0.8) skips one tier: medium → light', () => {
      const indexed_at = Date.now() - 45 * DAY_MS; // would be medium
      assert.equal(getTargetTier(indexed_at, 0.9, false), 'light');
    });

    it('high importance (>=0.8) skips one tier: distilled → medium', () => {
      const indexed_at = Date.now() - 100 * DAY_MS; // would be distilled
      assert.equal(getTargetTier(indexed_at, 0.8, false), 'medium');
    });

    it('supports configurable thresholds', () => {
      const indexed_at = Date.now() - 5 * DAY_MS; // 5 days old
      // Custom: light at 3 days
      assert.equal(getTargetTier(indexed_at, 0.5, false, { light_days: 3 }), 'light');
    });

    it('exact boundary: 7 days returns light', () => {
      const indexed_at = Date.now() - 7 * DAY_MS;
      assert.equal(getTargetTier(indexed_at, 0.5, false), 'light');
    });
  });

  describe('compressToTier', () => {
    const content = 'First paragraph with details. Second sentence about architecture. Third sentence about testing.\n\nSecond paragraph starts here. We decided to use PostgreSQL. Another sentence.';
    const summary = 'Summary of the content about architecture decisions.';

    it('verbatim returns content as-is', () => {
      assert.equal(compressToTier(content, summary, 'verbatim'), content);
    });

    it('light keeps first sentence of each paragraph and keyword sentences', () => {
      const result = compressToTier(content, summary, 'light');
      assert.ok(result.includes('First paragraph'), 'should keep first sentence');
      assert.ok(result.includes('decided'), 'should keep sentence with decision keyword');
      assert.ok(result.length < content.length, 'should be shorter than original');
    });

    it('medium returns existing summary', () => {
      assert.equal(compressToTier(content, summary, 'medium'), summary);
    });

    it('medium with null summary returns truncated content', () => {
      const result = compressToTier(content, null, 'medium');
      assert.ok(result.length <= 200);
    });

    it('distilled extracts fact bullets', () => {
      const result = compressToTier(content, summary, 'distilled');
      assert.ok(result.includes('•'), 'should format as bullet points');
    });

    it('distilled from content with keywords extracts key facts', () => {
      const techContent = 'We decided to migrate to Kubernetes. The deployment was completed in 2 hours. Performance improved by 40%. Users reported no issues.';
      const result = compressToTier(techContent, null, 'distilled');
      assert.ok(result.includes('decided'), 'should include decision fact');
      assert.ok(result.includes('completed'), 'should include completion fact');
    });

    it('light compression with single sentence returns it', () => {
      const single = 'Just one sentence here.';
      const result = compressToTier(single, null, 'light');
      assert.equal(result, 'Just one sentence here.');
    });
  });
});
