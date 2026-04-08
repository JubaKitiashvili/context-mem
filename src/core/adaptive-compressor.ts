/**
 * Adaptive Compressor — progressive compression tiers based on observation age.
 *
 * Tiers:
 * - verbatim (0-7 days): Original content intact
 * - light (7-30 days): Key sentences retained
 * - medium (30-90 days): Summarizer-level compression
 * - distilled (90+ days): Facts-only extraction
 *
 * Rules:
 * - pinned=true → always verbatim, never compress
 * - importance_score >= 0.8 → skip one tier (compress slower)
 */

export type CompressionTier = 'verbatim' | 'light' | 'medium' | 'distilled';

export interface TierThresholds {
  light_days: number;
  medium_days: number;
  distilled_days: number;
}

const DEFAULT_THRESHOLDS: TierThresholds = {
  light_days: 7,
  medium_days: 30,
  distilled_days: 90,
};

const TIER_ORDER: CompressionTier[] = ['verbatim', 'light', 'medium', 'distilled'];

// Keywords that indicate important sentences to keep in light compression
const KEEP_KEYWORDS = /\b(decided|chose|shipped|deployed|released|completed|launched|critical|breaking|fixed|solved|resolved|must|never|always|error|bug|created|started)\b/i;

/**
 * Determine the target compression tier for an observation.
 */
export function getTargetTier(
  indexed_at: number,
  importance_score: number,
  pinned: boolean,
  thresholds?: Partial<TierThresholds>,
): CompressionTier {
  // Pinned observations never compress
  if (pinned) return 'verbatim';

  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const ageDays = (Date.now() - indexed_at) / (24 * 60 * 60 * 1000);

  let tier: CompressionTier;
  if (ageDays < t.light_days) {
    tier = 'verbatim';
  } else if (ageDays < t.medium_days) {
    tier = 'light';
  } else if (ageDays < t.distilled_days) {
    tier = 'medium';
  } else {
    tier = 'distilled';
  }

  // High-importance observations skip one tier (compress slower)
  if (importance_score >= 0.8 && tier !== 'verbatim') {
    const idx = TIER_ORDER.indexOf(tier);
    tier = TIER_ORDER[Math.max(0, idx - 1)];
  }

  return tier;
}

/**
 * Compress content to a target tier.
 */
export function compressToTier(
  content: string,
  summary: string | null,
  targetTier: CompressionTier,
): string {
  switch (targetTier) {
    case 'verbatim':
      return content;

    case 'light':
      return compressLight(content);

    case 'medium':
      // Use existing summary if available, otherwise truncate
      return summary || content.slice(0, 200);

    case 'distilled':
      return compressDistilled(content, summary);
  }
}

/**
 * Light compression: keep first sentence of each paragraph
 * plus sentences containing important keywords.
 */
function compressLight(content: string): string {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
  const kept: string[] = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    if (sentences.length === 0) continue;

    // Always keep first sentence
    kept.push(sentences[0].trim());

    // Keep any sentence with important keywords
    for (let i = 1; i < sentences.length; i++) {
      if (KEEP_KEYWORDS.test(sentences[i])) {
        kept.push(sentences[i].trim());
      }
    }
  }

  return kept.join(' ');
}

/**
 * Distilled compression: extract one-line facts.
 */
function compressDistilled(content: string, summary: string | null): string {
  // Start from summary if available, otherwise from content
  const source = summary || content;

  // Split into sentences
  const sentences = source.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);

  if (sentences.length === 0) {
    return source.slice(0, 100);
  }

  // Keep sentences with key facts (decision keywords, technical terms)
  const facts = sentences.filter(s => KEEP_KEYWORDS.test(s));

  if (facts.length > 0) {
    // Limit to 3 key facts
    return facts.slice(0, 3).map(f => `• ${f.trim()}`).join('\n');
  }

  // Fallback: first sentence only
  return `• ${sentences[0].trim()}`;
}
