import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const MIN_LINES_TO_SUMMARIZE = 20;

// Patterns that indicate code content
const JS_TS_PATTERNS = [
  /function\s+\w+/,
  /class\s+\w+/,
  /export\s+/,
  /import\s+/,
  /const\s+\w+\s*=/,
];

const PYTHON_PATTERNS = [
  /def\s+\w+/,
  /class\s+\w+/,
  /^import\s+/m,
  /^from\s+\w+/m,
];

// Lines to extract for JS/TS summarization
// Only match top-level declarations (no leading whitespace before keyword)
const JS_TS_SIGNATURE_RE = /^(export|function|class|interface|type|import|const|let|var)\s+/;

// Lines to extract for Python summarization
const PYTHON_SIGNATURE_RE = /^\s*(def|class|import|from)\s+/;

// Decorator lines in Python
const PYTHON_DECORATOR_RE = /^\s*@\w+/;

function detectLanguage(content: string): 'js-ts' | 'python' | null {
  const jsMatches = JS_TS_PATTERNS.filter(p => p.test(content)).length;
  const pyMatches = PYTHON_PATTERNS.filter(p => p.test(content)).length;

  // Python-specific patterns that don't overlap with JS (def, from import)
  const pyExclusive = [/def\s+\w+/, /^from\s+\w+/m].filter(p => p.test(content)).length;

  // Prefer Python when it has exclusive markers or outscores JS
  if (pyExclusive >= 1) return 'python';
  if (pyMatches > jsMatches) return 'python';
  if (jsMatches >= 2) return 'js-ts';
  if (pyMatches >= 2) return 'python';
  if (jsMatches >= 1) return 'js-ts';
  if (pyMatches >= 1) return 'python';
  return null;
}

function summarizeJsTs(lines: string[]): string {
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (JS_TS_SIGNATURE_RE.test(line)) {
      // For function/class/method: include only up to the opening brace or end of line
      const trimmed = line.trimEnd();
      const braceIdx = trimmed.indexOf('{');
      if (braceIdx !== -1 && (line.match(/function\s+\w+/) || line.match(/class\s+\w+/))) {
        output.push(trimmed.substring(0, braceIdx).trimEnd() + ' {');
        output.push('  // ... body omitted');
        output.push('}');
      } else {
        output.push(line);
      }
    }

    i++;
  }

  return output.join('\n');
}

function summarizePython(lines: string[]): string {
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Collect decorator lines preceding a def/class
    if (PYTHON_DECORATOR_RE.test(line)) {
      const decorators: string[] = [line];
      let j = i + 1;
      while (j < lines.length && PYTHON_DECORATOR_RE.test(lines[j])) {
        decorators.push(lines[j]);
        j++;
      }
      // If the next non-decorator line is a def/class, emit all
      if (j < lines.length && PYTHON_SIGNATURE_RE.test(lines[j])) {
        decorators.forEach(d => output.push(d));
        const sigLine = lines[j];
        const colonIdx = sigLine.lastIndexOf(':');
        if (colonIdx !== -1) {
          output.push(sigLine.substring(0, colonIdx + 1));
          output.push('    # ... body omitted');
        } else {
          output.push(sigLine);
        }
        i = j + 1;
        continue;
      }
      // Otherwise just skip decorators
      i = j;
      continue;
    }

    if (PYTHON_SIGNATURE_RE.test(line)) {
      // import / from lines: keep as-is
      if (/^\s*(import|from)\s+/.test(line)) {
        output.push(line);
      } else {
        // def / class: include up to last colon (handles type annotations)
        const colonIdx = line.lastIndexOf(':');
        if (colonIdx !== -1) {
          output.push(line.substring(0, colonIdx + 1));
          output.push('    # ... body omitted');
        } else {
          output.push(line);
        }
      }
    }

    i++;
  }

  return output.join('\n');
}

export class CodeSummarizer implements SummarizerPlugin {
  name = 'code-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['code', 'javascript', 'typescript', 'python'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const lineCount = content.split('\n').length;
    if (lineCount < MIN_LINES_TO_SUMMARIZE) return false;

    const allPatterns = [...JS_TS_PATTERNS, ...PYTHON_PATTERNS];
    const matchCount = allPatterns.filter(p => p.test(content)).length;
    return matchCount >= 2;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const lines = content.split('\n');
    const tokensOriginal = estimateTokens(content);

    if (lines.length < MIN_LINES_TO_SUMMARIZE) {
      return {
        summary: content,
        tokens_original: tokensOriginal,
        tokens_summarized: tokensOriginal,
        savings_pct: 0,
        content_type: 'code',
      };
    }

    const lang = detectLanguage(content);
    let summary: string;

    if (lang === 'python') {
      summary = summarizePython(lines);
    } else {
      // Default to JS/TS treatment
      summary = summarizeJsTs(lines);
    }

    // If summary ended up empty or very short, fall back to original
    if (!summary.trim() || summary.split('\n').length < 3) {
      return {
        summary: content,
        tokens_original: tokensOriginal,
        tokens_summarized: tokensOriginal,
        savings_pct: 0,
        content_type: 'code',
      };
    }

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: Math.max(0, Math.round((1 - tokensSummarized / tokensOriginal) * 100)),
      content_type: 'code',
    };
  }
}
