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
    // Built-in detectors still run even with strip_tags false, but no tags to strip
    assert.ok(result.cleaned.includes('<private>'));
    assert.equal(result.had_private_tags, false);
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
    assert.ok(withRedact.redactions >= 1);
  });

  it('fail-closed: throws on ReDoS-prone regex pattern', () => {
    assert.throws(
      () => new PrivacyEngine({ strip_tags: true, redact_patterns: ['(a+)+z'] }),
      { message: /too slow \(potential ReDoS\)/ },
    );
  });

  // --- Built-in secret detection tests ---

  it('redacts AWS keys', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('key: AKIAIOSFODNN7EXAMPLE rest');
    assert.ok(result.cleaned.includes('[AWS_KEY_REDACTED]'));
    assert.ok(!result.cleaned.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(result.redactions >= 1);
  });

  it('redacts GitHub tokens', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
    const result = engine.process(`token: ${token}`);
    assert.ok(result.cleaned.includes('[GITHUB_TOKEN_REDACTED]'));
    assert.ok(!result.cleaned.includes(token));
    assert.ok(result.redactions >= 1);
  });

  it('redacts JWTs', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = engine.process(`Authorization: Bearer ${jwt}`);
    assert.ok(result.cleaned.includes('[JWT_REDACTED]'));
    assert.ok(!result.cleaned.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(result.redactions >= 1);
  });

  it('redacts private keys', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAH\n-----END RSA PRIVATE KEY-----';
    const result = engine.process(`cert:\n${key}\nmore stuff`);
    assert.ok(result.cleaned.includes('[PRIVATE_KEY_REDACTED]'));
    assert.ok(!result.cleaned.includes('MIIBogIBAAJBALRiMLAH'));
    assert.ok(result.redactions >= 1);
  });

  it('redacts Slack tokens', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('SLACK_TOKEN=xoxb-123456789-abcdef');
    assert.ok(result.cleaned.includes('[SLACK_TOKEN_REDACTED]'));
    assert.ok(!result.cleaned.includes('xoxb-123456789-abcdef'));
    assert.ok(result.redactions >= 1);
  });

  it('redacts email addresses', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('Contact alice@example.com for details');
    assert.ok(result.cleaned.includes('[EMAIL_REDACTED]'));
    assert.ok(!result.cleaned.includes('alice@example.com'));
    assert.ok(result.redactions >= 1);
  });

  it('redacts IP addresses', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const result = engine.process('Server at 192.168.1.100 is down');
    assert.ok(result.cleaned.includes('[IP_REDACTED]'));
    assert.ok(!result.cleaned.includes('192.168.1.100'));
    assert.ok(result.redactions >= 1);
  });

  it('preserves non-sensitive content', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const safe = 'This is a normal log message with no secrets at all.';
    const result = engine.process(safe);
    assert.equal(result.cleaned, safe);
    assert.equal(result.redactions, 0);
  });

  it('respects disabled_detectors config', () => {
    const engine = new PrivacyEngine({
      strip_tags: true,
      redact_patterns: [],
      disabled_detectors: ['email', 'ip_address'],
    });

    // Email and IP should NOT be redacted
    const result = engine.process('Contact alice@example.com at 192.168.1.1');
    assert.ok(result.cleaned.includes('alice@example.com'), 'email should be preserved when detector disabled');
    assert.ok(result.cleaned.includes('192.168.1.1'), 'IP should be preserved when detector disabled');

    // AWS keys should still be redacted
    const result2 = engine.process('key: AKIAIOSFODNN7EXAMPLE');
    assert.ok(result2.cleaned.includes('[AWS_KEY_REDACTED]'));
  });

  it('sanitize() returns sanitized string and redaction count', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    const { sanitized, redactions } = engine.sanitize('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl');
    assert.ok(sanitized.includes('[GITHUB_TOKEN_REDACTED]'));
    assert.ok(redactions >= 1);
  });

  it('getActiveDetectors reflects disabled_detectors', () => {
    const engine = new PrivacyEngine({
      strip_tags: true,
      redact_patterns: [],
      disabled_detectors: ['jwt', 'slack_token'],
    });
    const active = engine.getActiveDetectors();
    assert.ok(!active.includes('jwt'));
    assert.ok(!active.includes('slack_token'));
    assert.ok(active.includes('aws_key'));
    assert.ok(active.includes('github_token'));
  });

  it('updateConfig can change disabled_detectors at runtime', () => {
    const engine = new PrivacyEngine({ strip_tags: true, redact_patterns: [] });
    // Initially all detectors active
    assert.ok(engine.getActiveDetectors().includes('email'));

    engine.updateConfig({ disabled_detectors: ['email'] });
    assert.ok(!engine.getActiveDetectors().includes('email'));

    const result = engine.process('Contact alice@example.com');
    assert.ok(result.cleaned.includes('alice@example.com'));
  });
});
