/**
 * Importance Classifier — zero-LLM deterministic scoring for observations.
 *
 * Classifies every observation at store-time with:
 * - importance_score (0.0–1.0) based on type, keywords, entities, length
 * - significance flags (DECISION, ORIGIN, PIVOT, CORE, MILESTONE, PROBLEM)
 * - auto-pin for DECISION and MILESTONE flagged observations
 */

export type SignificanceFlag = 'DECISION' | 'ORIGIN' | 'PIVOT' | 'CORE' | 'MILESTONE' | 'PROBLEM';
export type CompressionTier = 'verbatim' | 'light' | 'medium' | 'distilled';

export interface ImportanceResult {
  score: number;
  flags: SignificanceFlag[];
  pinned: boolean;
}

// Base importance score by observation type
const TYPE_SCORES: Record<string, number> = {
  error: 0.8,
  decision: 0.9,
  code: 0.5,
  log: 0.3,
  context: 0.4,
  test: 0.6,
  commit: 0.7,
};

// Keywords that boost importance score by +0.2
const IMPORTANCE_KEYWORDS = /\b(critical|breaking|vulnerability|never|always)\b/i;

// Phrases that indicate a resolution (+0.15)
const RESOLUTION_PATTERNS = /\b(fixed by|solved|resolved)\b/i;

// Flag detection patterns
const FLAG_PATTERNS: Array<{ flag: SignificanceFlag; pattern: RegExp }> = [
  { flag: 'DECISION', pattern: /\b(decided|chose|picked|went with|selected)\b/i },
  { flag: 'ORIGIN', pattern: /\b(started|created|initialized|bootstrapped|new project)\b/i },
  { flag: 'PIVOT', pattern: /\b(switched|migrated|replaced|moved from|changed to)\b/i },
  { flag: 'CORE', pattern: /\b(always|never|must|rule|constraint|requirement)\b/i },
  { flag: 'MILESTONE', pattern: /\b(shipped|deployed|released|completed|launched)\b/i },
  { flag: 'PROBLEM', pattern: /\b(bug|error|crash|broken|failing|regression)\b/i },
];

// Flags that trigger auto-pinning
const AUTO_PIN_FLAGS: Set<SignificanceFlag> = new Set(['DECISION', 'MILESTONE']);

/**
 * Classify an observation's importance. Pure, deterministic, zero-LLM.
 */
export function classifyImportance(
  content: string,
  type: string,
  metadata?: { entities?: string[] },
): ImportanceResult {
  if (!content || !content.trim()) {
    return { score: 0.5, flags: [], pinned: false };
  }

  // Base score from observation type
  let score = TYPE_SCORES[type] ?? 0.5;

  // Keyword boost (+0.2)
  if (IMPORTANCE_KEYWORDS.test(content)) {
    score += 0.2;
  }

  // Resolution boost (+0.15)
  if (RESOLUTION_PATTERNS.test(content)) {
    score += 0.15;
  }

  // Entity mention boost (+0.1)
  if (metadata?.entities && metadata.entities.length > 0) {
    score += 0.1;
  }

  // Length signal (+0.1) — detailed content is likely important
  if (content.length > 2000) {
    score += 0.1;
  }

  // Clamp to [0.0, 1.0]
  score = Math.min(1.0, Math.max(0.0, score));

  // Detect significance flags
  const flags: SignificanceFlag[] = [];
  for (const { flag, pattern } of FLAG_PATTERNS) {
    if (pattern.test(content)) {
      flags.push(flag);
    }
  }

  // Auto-pin if any auto-pin flag is present
  const pinned = flags.some(f => AUTO_PIN_FLAGS.has(f));

  return { score: Math.round(score * 100) / 100, flags, pinned };
}
