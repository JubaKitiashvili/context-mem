import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

// Standard CPython traceback header
const TB_HEADER_RE = /Traceback \(most recent call last\):/;

// File frame line: `  File "path.py", line N, in fn_name`
const FILE_FRAME_RE = /^\s+File "([^"]+)", line (\d+), in (\S+)/;

// Exception line: SomethingError: message (last meaningful line)
const EXCEPTION_LINE_RE = /^([A-Za-z_]\w*(?:Error|Exception|Warning|Interrupt|Exit|Fault|Stop|Break)):\s*(.*)/;

// Frames that are library/venv paths — prefer user code over these
const LIB_FRAME_RE =
  /site-packages|dist-packages|lib\/python\d|\.pyenv|venv[\\/]|env[\\/]lib|lib[\\/]site|python3?\.\d+[\\/]/i;

interface Frame {
  file: string;
  line: string;
  fn: string;
  isUserCode: boolean;
}

export class PythonTracebackSummarizer implements SummarizerPlugin {
  name = 'python-traceback-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['python-traceback', 'error'];
  priority = 250;

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    // Must have the standard CPython header
    if (TB_HEADER_RE.test(content)) return true;

    // Or the multiline file-frame + exception pattern (chained exceptions, etc.)
    const hasFileFrame = FILE_FRAME_RE.test(content);
    const hasException = EXCEPTION_LINE_RE.test(content);
    return hasFileFrame && hasException;
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);
    const lines = content.split('\n');

    // --- Parse all file frames ---
    const frames: Frame[] = [];
    for (const line of lines) {
      const m = line.match(FILE_FRAME_RE);
      if (m) {
        frames.push({
          file: m[1],
          line: m[2],
          fn: m[3],
          isUserCode: !LIB_FRAME_RE.test(m[1]),
        });
      }
    }

    // --- Find exception type + message ---
    // The final exception is usually the last non-empty line (or last line matching EXCEPTION_LINE_RE)
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    let exceptionType = 'Exception';
    let exceptionMsg = '';

    // Walk backwards to find the last exception line
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
      const m = nonEmpty[i].trim().match(EXCEPTION_LINE_RE);
      if (m) {
        exceptionType = m[1];
        exceptionMsg = m[2];
        break;
      }
    }

    // Fallback: use last line as message
    if (!exceptionMsg && nonEmpty.length > 0) {
      const last = nonEmpty[nonEmpty.length - 1].trim();
      const colonIdx = last.indexOf(':');
      if (colonIdx > 0) {
        exceptionType = last.slice(0, colonIdx).trim() || 'Exception';
        exceptionMsg = last.slice(colonIdx + 1).trim();
      } else {
        exceptionMsg = last;
      }
    }

    if (frames.length === 0) {
      // Malformed — include first + last line
      const first = nonEmpty[0]?.trim() ?? '';
      const last = nonEmpty[nonEmpty.length - 1]?.trim() ?? '';
      const summary = first === last ? first : `${first} … ${last}`;
      const tokensSummarized = estimateTokens(summary);
      return {
        summary,
        tokens_original: tokensOriginal,
        tokens_summarized: tokensSummarized,
        savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
        content_type: 'python-traceback',
      };
    }

    // --- Pick the primary (innermost user-code) frame ---
    // Frames are in order from outermost to innermost. We want the deepest user-code frame.
    const userFrames = frames.filter((f) => f.isUserCode);
    const primaryFrame = userFrames.length > 0 ? userFrames[userFrames.length - 1] : frames[frames.length - 1];

    // Short file label: drop leading path segments, keep last 2 parts
    const shortFile = (f: Frame): string => {
      const parts = f.file.replace(/\\/g, '/').split('/');
      return parts.length > 2 ? parts.slice(-2).join('/') : f.file;
    };

    // --- Build context chain: up to 2 frames preceding primary ---
    const primaryIdx = frames.indexOf(primaryFrame);
    const contextFrames = frames.slice(Math.max(0, primaryIdx - 2), primaryIdx);

    // Compact summary format:
    // PY_TB: ExceptionType: message @ file:line [fn] ← prev:line ← prev2:line
    const chainParts = contextFrames.map((f) => `${shortFile(f)}:${f.line}`).reverse();
    const chain = chainParts.length > 0 ? ` ← ${chainParts.join(' ← ')}` : '';

    const summary =
      `PY_TB: ${exceptionType}: ${exceptionMsg} @ ${shortFile(primaryFrame)}:${primaryFrame.line} [${primaryFrame.fn}]${chain}`;

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: tokensOriginal > 0 ? Math.round((1 - tokensSummarized / tokensOriginal) * 100) : 0,
      content_type: 'python-traceback',
    };
  }
}
