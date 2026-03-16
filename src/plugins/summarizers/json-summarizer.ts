import type { SummarizerPlugin, PluginConfig, SummaryResult, SummarizeOpts } from '../../core/types.js';
import { estimateTokens } from '../../core/utils.js';

const MAX_DEPTH = 3;

function extractSchema(value: unknown, depth: number, indent: string): string {
  if (depth > MAX_DEPTH) return 'object';

  if (Array.isArray(value)) {
    const length = value.length;
    if (length === 0) return 'array[0]';
    const firstSchema = extractSchema(value[0], depth + 1, indent + '  ');
    if (typeof value[0] === 'object' && value[0] !== null && !Array.isArray(value[0])) {
      const inner = buildObjectSchema(value[0] as Record<string, unknown>, depth + 1, indent + '  ');
      return `array[${length}]\n${inner}`;
    }
    return `array[${length}] of ${firstSchema}`;
  }

  if (value === null) return 'null';

  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return 'object';
    return `object\n${buildObjectSchema(value as Record<string, unknown>, depth + 1, indent + '  ')}`;
  }

  return typeof value;
}

function buildObjectSchema(obj: Record<string, unknown>, depth: number, indent: string): string {
  if (depth > MAX_DEPTH) return `${indent}...`;
  const lines: string[] = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      const length = val.length;
      if (length === 0) {
        lines.push(`${indent}${key}: array[0]`);
      } else if (typeof val[0] === 'object' && val[0] !== null && !Array.isArray(val[0])) {
        lines.push(`${indent}${key}: array[${length}]`);
        if (depth < MAX_DEPTH) {
          lines.push(buildObjectSchema(val[0] as Record<string, unknown>, depth + 1, indent + '  '));
        }
      } else {
        const firstType = val[0] === null ? 'null' : typeof val[0];
        lines.push(`${indent}${key}: array[${length}] of ${firstType}`);
      }
    } else if (val !== null && typeof val === 'object') {
      if (depth < MAX_DEPTH) {
        lines.push(`${indent}${key}: object`);
        lines.push(buildObjectSchema(val as Record<string, unknown>, depth + 1, indent + '  '));
      } else {
        lines.push(`${indent}${key}: object`);
      }
    } else {
      const typeName = val === null ? 'null' : typeof val;
      lines.push(`${indent}${key}: ${typeName}`);
    }
  }
  return lines.join('\n');
}

export class JsonSummarizer implements SummarizerPlugin {
  name = 'json-summarizer';
  version = '1.0.0';
  type = 'summarizer' as const;
  contentTypes = ['json', 'application/json'];

  async init(_config: PluginConfig): Promise<void> {}
  async destroy(): Promise<void> {}

  detect(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  async summarize(content: string, _opts: SummarizeOpts): Promise<SummaryResult> {
    const tokensOriginal = estimateTokens(content);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        summary: content,
        tokens_original: tokensOriginal,
        tokens_summarized: tokensOriginal,
        savings_pct: 0,
        content_type: 'json',
      };
    }

    let summary: string;

    if (Array.isArray(parsed)) {
      const length = parsed.length;
      if (length === 0) {
        summary = `array[0]`;
      } else if (typeof parsed[0] === 'object' && parsed[0] !== null && !Array.isArray(parsed[0])) {
        summary = `array[${length}]\n` + buildObjectSchema(parsed[0] as Record<string, unknown>, 1, '  ');
      } else {
        const firstType = parsed[0] === null ? 'null' : typeof parsed[0];
        summary = `array[${length}] of ${firstType}`;
      }
    } else if (parsed !== null && typeof parsed === 'object') {
      summary = buildObjectSchema(parsed as Record<string, unknown>, 1, '  ');
    } else {
      summary = typeof parsed;
    }

    const tokensSummarized = estimateTokens(summary);

    return {
      summary,
      tokens_original: tokensOriginal,
      tokens_summarized: tokensSummarized,
      savings_pct: Math.round((1 - tokensSummarized / tokensOriginal) * 100),
      content_type: 'json',
    };
  }
}
