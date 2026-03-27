export interface PrivacyConfig {
  strip_tags: boolean;
  redact_patterns: string[];
  disabled_detectors?: string[];
}

export interface PrivacyResult {
  cleaned: string;
  redactions: number;
  had_private_tags: boolean;
}

export interface BuiltInPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const BUILT_IN_PATTERNS: BuiltInPattern[] = [
  { name: 'aws_key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[AWS_KEY_REDACTED]' },
  { name: 'aws_secret', pattern: /(?<=AWS_SECRET_ACCESS_KEY[=:]\s*)[A-Za-z0-9/+=]{40}/g, replacement: '[AWS_SECRET_REDACTED]' },
  { name: 'github_token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, replacement: '[GITHUB_TOKEN_REDACTED]' },
  { name: 'slack_token', pattern: /xox[bprs]-[A-Za-z0-9-]+/g, replacement: '[SLACK_TOKEN_REDACTED]' },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[JWT_REDACTED]' },
  { name: 'private_key', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA )?PRIVATE KEY-----/g, replacement: '[PRIVATE_KEY_REDACTED]' },
  { name: 'generic_api_key', pattern: /(?<=api[_-]?key[=:]\s*["']?)[A-Za-z0-9_-]{20,}/gi, replacement: '[API_KEY_REDACTED]' },
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  { name: 'ip_address', pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, replacement: '[IP_REDACTED]' },
];

export class PrivacyEngine {
  private config: PrivacyConfig;
  private compiledPatterns: RegExp[];
  private activeBuiltIns: BuiltInPattern[];

  constructor(config: PrivacyConfig) {
    this.config = config;
    this.compiledPatterns = config.redact_patterns.map(p => PrivacyEngine.compilePattern(p));
    this.activeBuiltIns = PrivacyEngine.resolveBuiltIns(config.disabled_detectors);
  }

  private static resolveBuiltIns(disabled?: string[]): BuiltInPattern[] {
    if (!disabled || disabled.length === 0) return BUILT_IN_PATTERNS;
    const disabledSet = new Set(disabled);
    return BUILT_IN_PATTERNS.filter(p => !disabledSet.has(p.name));
  }

  private static compilePattern(pattern: string): RegExp {
    // Strip inline (?i) flag (case-insensitive already handled by 'i' in flags)
    const normalized = pattern.replace(/^\(\?i\)/i, '');
    const re = new RegExp(normalized, 'gi');
    // ReDoS safety: test with a short probe to catch catastrophic backtracking
    const probe = 'a'.repeat(25);
    const start = Date.now();
    re.test(probe);
    if (Date.now() - start > 10) {
      throw new Error(`Regex pattern "${pattern}" is too slow (potential ReDoS)`);
    }
    return re;
  }

  /**
   * Sanitize content by running all privacy detectors.
   * Convenience wrapper returning a simpler shape for callers that
   * don't need the full PrivacyResult.
   */
  sanitize(content: string): { sanitized: string; redactions: number } {
    const result = this.process(content);
    return { sanitized: result.cleaned, redactions: result.redactions };
  }

  process(content: string): PrivacyResult {
    // Fast path: no stripping configured, no custom patterns, and no built-ins
    if (!this.config.strip_tags && this.compiledPatterns.length === 0 && this.activeBuiltIns.length === 0) {
      return { cleaned: content, redactions: 0, had_private_tags: false };
    }

    // Fast path: no tags present, no custom patterns, and no built-in patterns to apply
    if (this.compiledPatterns.length === 0 && this.activeBuiltIns.length === 0 && !/<(?:private|redact)>/i.test(content)) {
      return { cleaned: content, redactions: 0, had_private_tags: false };
    }

    try {
      let cleaned = content;
      let redactions = 0;
      let had_private_tags = false;

      if (this.config.strip_tags) {
        cleaned = cleaned.replace(/<private>[\s\S]*?<\/private>/gi, () => {
          redactions++;
          had_private_tags = true;
          return '';
        });

        cleaned = cleaned.replace(/<redact>[\s\S]*?<\/redact>/gi, () => {
          redactions++;
          return '[REDACTED]';
        });
      }

      // Apply built-in secret detectors
      for (const builtin of this.activeBuiltIns) {
        builtin.pattern.lastIndex = 0;
        cleaned = cleaned.replace(builtin.pattern, () => {
          redactions++;
          return builtin.replacement;
        });
      }

      // Apply user custom patterns
      for (const pattern of this.compiledPatterns) {
        // Reset lastIndex for global regex (avoids stale state between calls)
        pattern.lastIndex = 0;
        cleaned = cleaned.replace(pattern, () => {
          redactions++;
          return '[REDACTED]';
        });
      }

      return { cleaned, redactions, had_private_tags };
    } catch (err) {
      throw new Error('Privacy engine failed — content not stored');
    }
  }

  updateConfig(config: Partial<PrivacyConfig>): void {
    if (config.strip_tags !== undefined) this.config.strip_tags = config.strip_tags;
    if (config.redact_patterns) {
      this.config.redact_patterns = config.redact_patterns;
      this.compiledPatterns = config.redact_patterns.map(p => PrivacyEngine.compilePattern(p));
    }
    if (config.disabled_detectors !== undefined) {
      this.config.disabled_detectors = config.disabled_detectors;
      this.activeBuiltIns = PrivacyEngine.resolveBuiltIns(config.disabled_detectors);
    }
  }

  /** Expose active built-in pattern names for introspection / testing */
  getActiveDetectors(): string[] {
    return this.activeBuiltIns.map(p => p.name);
  }
}
