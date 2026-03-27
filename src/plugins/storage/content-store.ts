import { createHash } from 'node:crypto';
import type { StoragePlugin } from '../../core/types.js';
import { sanitizeFTS5 } from '../search/fts5-utils.js';

const MAX_SEARCH_RESPONSE = 1536; // 1.5KB max per search response
const SNIPPET_THRESHOLD = 350;     // Extract snippet if chunk > this size
const SNIPPET_CONTEXT = 120;       // Chars of context around match

interface ContentChunk {
  id?: number;
  source_id: number;
  chunk_index: number;
  heading: string | null;
  content: string;
  has_code: boolean;
}

interface ContentSearchResult {
  heading: string | null;
  content: string;
  has_code: boolean;
  source: string;
  relevance: number;
}

function extractSnippet(content: string, query: string): string {
  if (content.length <= SNIPPET_THRESHOLD) return content;

  // Find the best match position using query words
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const lower = content.toLowerCase();
  let bestPos = -1;
  let bestScore = 0;

  for (let i = 0; i < lower.length; i++) {
    let score = 0;
    for (const word of words) {
      const idx = lower.indexOf(word, Math.max(0, i - SNIPPET_CONTEXT));
      if (idx >= 0 && idx < i + SNIPPET_CONTEXT) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPos = i;
    }
    // Skip ahead for efficiency
    if (score > 0) i += 50;
  }

  if (bestPos < 0) bestPos = 0;

  const start = Math.max(0, bestPos - SNIPPET_CONTEXT);
  const end = Math.min(content.length, bestPos + SNIPPET_CONTEXT);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

export class ContentStore {
  constructor(private storage: StoragePlugin) {}

  index(content: string, source: string): number {
    const sourceHash = createHash('sha256').update(source).digest('hex');

    // Check if already indexed
    const existing = this.storage.prepare(
      'SELECT id FROM content_sources WHERE source_hash = ?'
    ).get(sourceHash) as { id: number } | undefined;

    if (existing) return existing.id;

    // Insert source
    this.storage.exec(
      'INSERT INTO content_sources (source_hash, source, indexed_at) VALUES (?, ?, ?)',
      [sourceHash, source, Date.now()]
    );
    const sourceRow = this.storage.prepare(
      'SELECT id FROM content_sources WHERE source_hash = ?'
    ).get(sourceHash) as { id: number };
    const sourceId = sourceRow.id;

    // Chunk and index
    const chunks = this.chunk(content);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      this.storage.exec(
        'INSERT INTO content_chunks (source_id, chunk_index, heading, content, has_code) VALUES (?, ?, ?, ?, ?)',
        [sourceId, i, chunk.heading, chunk.content, chunk.has_code ? 1 : 0]
      );
    }

    return sourceId;
  }

  search(query: string, opts: { limit?: number; source?: string } = {}): ContentSearchResult[] {
    const limit = opts.limit || 5;

    // FTS5 search
    // Sanitize FTS5 operators, then generate split variants for underscored/camelCase identifiers
    // e.g., "_layout" → "layout", "getToken" → "getToken OR get OR Token"
    const base = sanitizeFTS5(query);
    if (!base) return [];
    const split = base
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
    // Combine original tokens with split tokens (OR for FTS5), deduped
    const allTokens = [...new Set([...base.split(/\s+/), ...split.split(/\s+/)])].filter(Boolean);
    const sanitized = allTokens.join(' OR ');

    let sql = `
      SELECT cc.heading, cc.content, cc.has_code, cs.source,
             bm25(content_chunks_fts) as relevance
      FROM content_chunks_fts
      JOIN content_chunks cc ON cc.id = content_chunks_fts.rowid
      JOIN content_sources cs ON cs.id = cc.source_id
      WHERE content_chunks_fts MATCH ?
    `;
    const params: unknown[] = [sanitized];

    if (opts.source) {
      sql += ' AND cs.source = ?';
      params.push(opts.source);
    }

    sql += ' ORDER BY bm25(content_chunks_fts) ASC LIMIT ?';
    params.push(limit);

    try {
      const rows = this.storage.prepare(sql).all(...params) as Array<{
        heading: string | null; content: string; has_code: number;
        source: string; relevance: number;
      }>;

      // Apply 2KB budget - code chunks never truncated, large text chunks get snippets
      let totalBytes = 0;
      const results: ContentSearchResult[] = [];
      for (const row of rows) {
        // For non-code chunks over threshold, extract relevant snippet
        const displayContent = row.has_code
          ? row.content
          : extractSnippet(row.content, sanitized);
        const bytes = Buffer.byteLength(displayContent, 'utf8');
        if (totalBytes + bytes > MAX_SEARCH_RESPONSE && !row.has_code) {
          // Truncate to fit remaining budget
          const remaining = MAX_SEARCH_RESPONSE - totalBytes;
          if (remaining > 100) {
            results.push({
              heading: row.heading,
              content: displayContent.slice(0, remaining) + '...',
              has_code: false,
              source: row.source,
              relevance: Math.abs(row.relevance),
            });
          }
          break;
        }
        totalBytes += bytes;
        results.push({
          heading: row.heading,
          content: displayContent,
          has_code: !!row.has_code,
          source: row.source,
          relevance: Math.abs(row.relevance),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  private chunk(content: string): Array<{ heading: string | null; content: string; has_code: boolean }> {
    // Try JSON first — single chunk (before any transformations)
    try {
      JSON.parse(content);
      return [{ heading: null, content, has_code: false }];
    } catch {
      // Not JSON, continue
    }

    // Protect code blocks with placeholders
    const codeBlocks: string[] = [];
    const PLACEHOLDER_PREFIX = '___CODE_BLOCK_';
    const PLACEHOLDER_SUFFIX = '___';
    const protected_content = content.replace(/```[\s\S]*?```/g, (match) => {
      const idx = codeBlocks.length;
      codeBlocks.push(match);
      return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
    });

    // Check for Markdown headings
    const headingPattern = /^(#{1,6})\s+(.+)$/gm;
    const headings = [...protected_content.matchAll(headingPattern)];

    let chunks: Array<{ heading: string | null; content: string; has_code: boolean }>;

    if (headings.length >= 2) {
      // Split by headings
      chunks = [];
      for (let i = 0; i < headings.length; i++) {
        const start = headings[i].index!;
        const end = i + 1 < headings.length ? headings[i + 1].index! : protected_content.length;
        const sectionContent = protected_content.slice(start, end).trim();
        chunks.push({
          heading: headings[i][2],
          content: sectionContent,
          has_code: sectionContent.includes(PLACEHOLDER_PREFIX),
        });
      }
      // Include preamble if exists
      if (headings[0].index! > 0) {
        const preamble = protected_content.slice(0, headings[0].index!).trim();
        if (preamble) {
          chunks.unshift({ heading: null, content: preamble, has_code: preamble.includes(PLACEHOLDER_PREFIX) });
        }
      }
    } else {
      // Split by paragraphs (double newline)
      const paragraphs = protected_content.split(/\n\n+/).filter(p => p.trim());
      chunks = paragraphs.map(p => ({
        heading: null,
        content: p.trim(),
        has_code: p.includes(PLACEHOLDER_PREFIX),
      }));
    }

    // Restore code blocks using simple string regex (no null bytes)
    const restorePattern = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g');
    return chunks.map(chunk => ({
      ...chunk,
      content: chunk.content.replace(restorePattern, (_, idx) => {
        return codeBlocks[parseInt(idx)] || '';
      }),
    }));
  }
}
