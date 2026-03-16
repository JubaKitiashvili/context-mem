export interface PrivacyConfig {
  strip_tags: boolean;
  redact_patterns: string[];
}

export interface PrivacyResult {
  cleaned: string;
  redactions: number;
  had_private_tags: boolean;
}

export class PrivacyEngine {
  private config: PrivacyConfig;
  private compiledPatterns: RegExp[];

  constructor(config: PrivacyConfig) {
    this.config = config;
    this.compiledPatterns = config.redact_patterns.map(p => PrivacyEngine.compilePattern(p));
  }

  private static compilePattern(pattern: string): RegExp {
    // Strip inline (?i) flag (case-insensitive already handled by 'i' in flags)
    const normalized = pattern.replace(/^\(\?i\)/i, '');
    return new RegExp(normalized, 'gi');
  }

  process(content: string): PrivacyResult {
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

      for (const pattern of this.compiledPatterns) {
        cleaned = cleaned.replace(pattern, () => {
          redactions++;
          return '[REDACTED]';
        });
      }

      return { cleaned, redactions, had_private_tags };
    } catch (err) {
      throw new Error(`Privacy engine failed — content not stored: ${(err as Error).message}`);
    }
  }

  updateConfig(config: Partial<PrivacyConfig>): void {
    if (config.strip_tags !== undefined) this.config.strip_tags = config.strip_tags;
    if (config.redact_patterns) {
      this.config.redact_patterns = config.redact_patterns;
      this.compiledPatterns = config.redact_patterns.map(p => PrivacyEngine.compilePattern(p));
    }
  }
}
