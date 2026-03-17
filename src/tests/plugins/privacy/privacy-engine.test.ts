import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrivacyEngine } from '../../../plugins/privacy/privacy-engine.js';

describe('PrivacyEngine', () => {
  it('strips <private> tags entirely', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('before <private>secret key here</private> after');
    assert.equal(result.cleaned, 'before  after');
    assert.equal(result.redactions, 1);
  });

  it('replaces <redact> tags with [REDACTED]', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('email: <redact>john@example.com</redact>');
    assert.equal(result.cleaned, 'email: [REDACTED]');
    assert.equal(result.redactions, 1);
  });

  it('applies regex redaction patterns', () => {
    const engine = new PrivacyEngine({
      strip_tags: true,
      redact_patterns: ['(?i)api[_-]?key\\s*[:=]\\s*\\S+'],
    });
    const result = engine.process('config: API_KEY=sk-12345678 other stuff');
    assert.ok(!result.cleaned.includes('sk-12345678'));
    assert.equal(result.redactions, 1);
  });

  it('handles multiple private blocks', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('<private>a</private> mid <private>b</private>');
    assert.equal(result.cleaned, ' mid ');
    assert.equal(result.redactions, 2);
  });

  it('returns unchanged content when strip_tags is false', () => {
    const engine = new PrivacyEngine({ strip_tags: false, redact_patterns: [] });
    const result = engine.process('<private>secret</private>');
    assert.equal(result.cleaned, '<private>secret</private>');
    assert.equal(result.redactions, 0);
  });

  it('handles nested and multiline private tags', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const input = 'start\n<private>\nline1\nline2\n</private>\nend';
    const result = engine.process(input);
    assert.equal(result.cleaned, 'start\n\nend');
  });

  it('tracks had_private_tags separately from redact', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const withPrivate = engine.process('a <private>secret</private> b');
    assert.equal(withPrivate.had_private_tags, true);

    const withRedact = engine.process('a <redact>email</redact> b');
    assert.equal(withRedact.had_private_tags, false);
    assert.equal(withRedact.redactions, 1);
  });

  it('fail-closed: throws on ReDoS-prone regex pattern', () => {
    assert.throws(
      () => new PrivacyEngine({ strip_tags: true, redact_patterns: ['(a+)+z'] }),
      { message: /too slow \(potential ReDoS\)/ },
    );
  });
});
