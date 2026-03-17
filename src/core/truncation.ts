import { createHash } from 'node:crypto';
import type { TruncationResult } from './types.js';

// Tier thresholds
export const MAX_PASSTHROUGH = 2048;
const HEAD = 500;
const TAIL = 500;
const AGGRESSIVE_HEAD = 200;
const AGGRESSIVE_TAIL = 200;

// Tier 1: JSON schema extraction
function tryJsonSchema(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    return `[JSON schema] ${describeJson(parsed, 0)}`;
  } catch {
    return null;
  }
}

function describeJson(val: unknown, depth: number): string {
  if (depth > 3) return '...';
  if (val === null) return 'null';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'array[0]';
    return `array[${val.length}] of ${describeJson(val[0], depth + 1)}`;
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>);
    if (keys.length === 0) return 'object{}';
    const fields = keys.slice(0, 10).map(k =>
      `${k}: ${describeJson((val as Record<string, unknown>)[k], depth + 1)}`
    ).join(', ');
    const extra = keys.length > 10 ? `, +${keys.length - 10} more` : '';
    return `{${fields}${extra}}`;
  }
  return typeof val;
}

// Tier 2: Pattern matching for known verbose outputs
const PATTERNS: Array<{ test: RegExp; extract: (content: string) => string }> = [
  {
    // Test output
    test: /Tests:\s.*total|PASS|FAIL|test suites?:/i,
    extract: (c) => {
      const lines = c.split('\n');
      const summary = lines.filter(l =>
        /Tests:|Test Suites:|passed|failed|PASS|FAIL|total/i.test(l)
      ).slice(0, 10);
      return `[Test output summary]\n${summary.join('\n')}`;
    },
  },
  {
    // Diff/patch
    test: /^(diff --git|---|\+\+\+|@@)/m,
    extract: (c) => {
      const lines = c.split('\n');
      const fileChanges = lines.filter(l => l.startsWith('diff --git') || l.startsWith('---') || l.startsWith('+++'));
      const stats = lines.filter(l => /^\d+ files? changed/.test(l));
      return `[Diff summary] ${fileChanges.length / 2} files\n${fileChanges.slice(0, 20).join('\n')}\n${stats.join('\n')}`;
    },
  },
  {
    // npm install output
    test: /added \d+ packages?|npm warn|npm ERR!/,
    extract: (c) => {
      const lines = c.split('\n');
      const relevant = lines.filter(l =>
        /added|removed|npm warn|npm ERR!|up to date|packages? in/i.test(l)
      ).slice(0, 10);
      return `[npm output]\n${relevant.join('\n')}`;
    },
  },
];

// Tier 4: Binary content detection
function isBinary(content: string): boolean {
  const sampleSize = Math.min(content.length, 512);
  if (sampleSize === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < sampleSize; i++) {
    const code = content.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++;
    }
  }
  return nonPrintable / sampleSize > 0.1;
}

/**
 * Four-tier truncation cascade:
 * T1: JSON schema extraction
 * T2: Pattern matching (test output, diff, npm)
 * T3: Head/Tail slicing
 * T4: SHA256 hash (binary content)
 */
export function truncate(content: string, aggressive = false): TruncationResult {
  const originalLength = content.length;

  // T4 first: binary content → hash immediately
  if (isBinary(content)) {
    const hash = createHash('sha256').update(content).digest('hex');
    const result = `[Binary content] sha256:${hash} (${Buffer.byteLength(content, 'utf8')} bytes)`;
    return { content: result, tier: 4, original_length: originalLength, truncated_length: result.length };
  }

  // T1: JSON schema extraction
  const schema = tryJsonSchema(content);
  if (schema) {
    return { content: schema, tier: 1, original_length: originalLength, truncated_length: schema.length };
  }

  // T2: Pattern matching
  for (const pattern of PATTERNS) {
    if (pattern.test.test(content)) {
      const extracted = pattern.extract(content);
      return { content: extracted, tier: 2, original_length: originalLength, truncated_length: extracted.length };
    }
  }

  // T3: Head/Tail slicing
  const headSize = aggressive ? AGGRESSIVE_HEAD : HEAD;
  const tailSize = aggressive ? AGGRESSIVE_TAIL : TAIL;
  const lines = content.split('\n');

  if (lines.length <= headSize + tailSize) {
    // Char-level truncation — only truncate if content actually exceeds the char budget
    const charBudget = aggressive ? 1600 : 4000;
    if (originalLength <= charBudget) {
      // Content fits in budget — return as-is
      return { content, tier: 3, original_length: originalLength, truncated_length: originalLength };
    }
    const halfBudget = aggressive ? 800 : 2000;
    const head = content.slice(0, halfBudget);
    const tail = content.slice(-halfBudget);
    const omitted = originalLength - head.length - tail.length;
    const result = `${head}\n... (${omitted} chars omitted) ...\n${tail}`;
    return { content: result, tier: 3, original_length: originalLength, truncated_length: result.length };
  }

  const headLines = lines.slice(0, headSize);
  const tailLines = lines.slice(-tailSize);
  const omitted = lines.length - headSize - tailSize;
  const result = [
    `[${lines.length} lines total]`,
    ...headLines,
    `... (${omitted} lines omitted) ...`,
    ...tailLines,
  ].join('\n');

  return { content: result, tier: 3, original_length: originalLength, truncated_length: result.length };
}
