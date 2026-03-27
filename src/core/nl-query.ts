import type { StoragePlugin, KnowledgeEntry, Entity, ContextEvent } from './types.js';
import type { KnowledgeBase } from '../plugins/knowledge/knowledge-base.js';
import type { KnowledgeGraph } from './knowledge-graph.js';
import type { EventTracker } from './events.js';
import { sanitizeFTS5 } from '../plugins/search/fts5-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NLSource {
  type: 'knowledge' | 'observation' | 'event' | 'entity';
  id: string;
  title: string;
  snippet: string;
  relevance: number;
  timestamp?: number;
}

export interface NLAnswer {
  question: string;
  intent: NLIntent;
  terms: string[];
  sources: NLSource[];
  summary: string;
}

export type NLIntent = 'what' | 'when' | 'who' | 'why' | 'how' | 'general';

// ---------------------------------------------------------------------------
// Stopwords
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'did', 'does',
  'have', 'has', 'had', 'been', 'being', 'be', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'about', 'we', 'our', 'us', 'i',
  'you', 'it', 'this', 'that', 'what', 'when', 'who', 'why', 'how',
  'which', 'where', 'there', 'here', 'not', 'but', 'and', 'or', 'if',
  'then', 'than', 'so', 'no', 'yes', 'all', 'any', 'some', 'each',
  'every', 'into', 'up', 'out', 'down', 'over', 'under', 'between',
  'through', 'during', 'before', 'after', 'above', 'below',
]);

// ---------------------------------------------------------------------------
// NaturalLanguageQuery
// ---------------------------------------------------------------------------

export class NaturalLanguageQuery {
  constructor(
    private storage: StoragePlugin,
    private knowledgeBase: KnowledgeBase,
    private knowledgeGraph: KnowledgeGraph,
    private eventTracker: EventTracker,
  ) {}

  /**
   * Main entry point: ask a natural-language question and receive a structured answer.
   */
  async ask(question: string): Promise<NLAnswer> {
    const intent = this.classifyIntent(question);
    const terms = this.extractTerms(question);
    const sources = await this.parallelSearch(terms, intent);
    return this.formatAnswer(question, intent, terms, sources);
  }

  /**
   * Classify question intent based on interrogative words.
   */
  classifyIntent(q: string): NLIntent {
    const lower = q.toLowerCase();
    if (lower.startsWith('what') || lower.includes('what ')) return 'what';
    if (lower.startsWith('when') || lower.includes('when ')) return 'when';
    if (lower.startsWith('who') || lower.includes('who ')) return 'who';
    if (lower.startsWith('why') || lower.includes('why ')) return 'why';
    if (lower.startsWith('how') || lower.includes('how ')) return 'how';
    return 'general';
  }

  /**
   * Extract meaningful terms from a question by removing stopwords and punctuation.
   */
  extractTerms(q: string): string[] {
    return q
      .toLowerCase()
      .replace(/[?!.,;:'"()\[\]{}]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w));
  }

  /**
   * Run searches in parallel across different data sources based on intent.
   */
  async parallelSearch(terms: string[], intent: NLIntent): Promise<NLSource[]> {
    if (terms.length === 0) return [];

    const query = terms.join(' ');
    const searches: Array<Promise<NLSource[]>> = [];

    switch (intent) {
      case 'what':
        searches.push(this.searchKnowledge(query));
        searches.push(this.searchObservations(query));
        break;
      case 'when':
        searches.push(this.searchEvents(query));
        searches.push(this.searchObservations(query));
        break;
      case 'who':
        searches.push(this.searchGraphPersons(terms));
        searches.push(this.searchKnowledge(query));
        break;
      case 'why':
        searches.push(this.searchKnowledge(query, 'decision'));
        searches.push(this.searchKnowledge(query));
        break;
      case 'how':
        searches.push(this.searchKnowledge(query, 'pattern'));
        searches.push(this.searchObservations(query, 'code'));
        break;
      case 'general':
      default:
        searches.push(this.searchKnowledge(query));
        searches.push(this.searchObservations(query));
        searches.push(this.searchEvents(query));
        searches.push(this.searchGraphPersons(terms));
        break;
    }

    const results = await Promise.all(searches);
    const merged = results.flat();

    // Deduplicate by id and sort by relevance
    const seen = new Set<string>();
    const unique: NLSource[] = [];
    for (const src of merged.sort((a, b) => b.relevance - a.relevance)) {
      if (!seen.has(src.id)) {
        seen.add(src.id);
        unique.push(src);
      }
    }

    return unique.slice(0, 20);
  }

  // -------------------------------------------------------------------------
  // Private search helpers
  // -------------------------------------------------------------------------

  private async searchKnowledge(query: string, category?: string): Promise<NLSource[]> {
    try {
      const opts: { category?: import('./types.js').KnowledgeCategory; limit?: number } = { limit: 10 };
      if (category) {
        opts.category = category as import('./types.js').KnowledgeCategory;
      }
      const entries: KnowledgeEntry[] = this.knowledgeBase.search(query, opts);
      return entries.map(e => ({
        type: 'knowledge' as const,
        id: e.id,
        title: e.title,
        snippet: e.content.slice(0, 200),
        relevance: e.relevance_score || 0.5,
        timestamp: e.created_at,
      }));
    } catch {
      return [];
    }
  }

  private async searchObservations(query: string, typeFilter?: string): Promise<NLSource[]> {
    try {
      const sanitized = sanitizeFTS5(query);
      if (!sanitized) return [];

      let sql = `
        SELECT o.id, o.type, o.content, o.summary, o.indexed_at
        FROM obs_fts
        JOIN observations o ON o.rowid = obs_fts.rowid
        WHERE obs_fts MATCH ?
      `;
      const params: unknown[] = [sanitized];

      if (typeFilter) {
        sql += ' AND o.type = ?';
        params.push(typeFilter);
      }

      sql += ' ORDER BY bm25(obs_fts) ASC LIMIT 10';

      const rows = this.storage.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map(r => ({
        type: 'observation' as const,
        id: r.id as string,
        title: (r.summary as string) || (r.content as string).slice(0, 80),
        snippet: ((r.summary as string) || (r.content as string)).slice(0, 200),
        relevance: 0.5,
        timestamp: r.indexed_at as number,
      }));
    } catch {
      return [];
    }
  }

  private async searchEvents(query: string): Promise<NLSource[]> {
    try {
      // Events don't have FTS — search by event_type matching terms
      const rows = this.storage.prepare(
        'SELECT id, event_type, data, timestamp FROM events ORDER BY timestamp DESC LIMIT 100',
      ).all() as Array<Record<string, unknown>>;

      const lowerQuery = query.toLowerCase();
      const terms = lowerQuery.split(/\s+/);

      return rows
        .filter(r => {
          const eventType = (r.event_type as string).toLowerCase();
          const dataStr = (r.data as string || '').toLowerCase();
          return terms.some(t => eventType.includes(t) || dataStr.includes(t));
        })
        .slice(0, 10)
        .map(r => {
          let dataStr: string;
          try {
            const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            dataStr = JSON.stringify(parsed).slice(0, 200);
          } catch {
            dataStr = String(r.data).slice(0, 200);
          }
          return {
            type: 'event' as const,
            id: r.id as string,
            title: r.event_type as string,
            snippet: dataStr,
            relevance: 0.4,
            timestamp: r.timestamp as number,
          };
        });
    } catch {
      return [];
    }
  }

  private async searchGraphPersons(terms: string[]): Promise<NLSource[]> {
    try {
      const sources: NLSource[] = [];
      for (const term of terms) {
        const entities: Entity[] = this.knowledgeGraph.findEntity(term, 'person');
        for (const e of entities) {
          sources.push({
            type: 'entity' as const,
            id: e.id,
            title: e.name,
            snippet: `Person entity: ${e.name} (${JSON.stringify(e.metadata)})`.slice(0, 200),
            relevance: 0.6,
            timestamp: e.created_at,
          });
        }
      }
      return sources;
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Format
  // -------------------------------------------------------------------------

  private formatAnswer(
    question: string,
    intent: NLIntent,
    terms: string[],
    sources: NLSource[],
  ): NLAnswer {
    let summary: string;

    if (sources.length === 0) {
      summary = 'No relevant information found for this question.';
    } else {
      const lines = sources.slice(0, 5).map((s, i) => {
        const ts = s.timestamp ? ` (${new Date(s.timestamp).toISOString().slice(0, 10)})` : '';
        return `${i + 1}. [${s.type}] ${s.title}${ts}: ${s.snippet}`;
      });
      summary = `Found ${sources.length} relevant result(s):\n${lines.join('\n')}`;
    }

    return {
      question,
      intent,
      terms,
      sources,
      summary,
    };
  }
}
