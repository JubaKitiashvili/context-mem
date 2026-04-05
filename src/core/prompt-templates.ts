export interface PromptTemplate {
  name: string;
  prompt: (...args: string[]) => string;
  validate: (response: unknown) => boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export const PROMPT_TEMPLATES = {
  expand_query: {
    name: 'expand_query',
    prompt: (query: string) =>
      `Expand this search query with 3-5 semantically related terms that would help find relevant results. Return ONLY valid JSON matching this schema: { "expanded": ["term1", "term2", ...], "original": "the original query" }\n\nQuery: "${query}"`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return Array.isArray(r.expanded) && r.expanded.length >= 1 && r.expanded.length <= 5
        && r.expanded.every((t: unknown) => typeof t === 'string')
        && typeof r.original === 'string';
    },
  },

  generate_title: {
    name: 'generate_title',
    prompt: (content: string) =>
      `Generate a concise title (max 80 chars) for this knowledge entry. Return ONLY valid JSON matching this schema: { "title": "the title" }\n\n${content.slice(0, 500)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return typeof r.title === 'string' && r.title.length > 0 && r.title.length <= 80;
    },
  },

  generate_tags: {
    name: 'generate_tags',
    prompt: (content: string) =>
      `Extract 3-5 keyword tags from this text. Lowercase, single words or short phrases. Return ONLY valid JSON matching this schema: { "tags": ["tag1", "tag2", ...] }\n\n${content.slice(0, 500)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return Array.isArray(r.tags) && r.tags.length >= 1 && r.tags.length <= 5
        && r.tags.every((t: unknown) => typeof t === 'string');
    },
  },

  explain_contradiction: {
    name: 'explain_contradiction',
    prompt: (entryA: string, entryB: string) =>
      `These two knowledge entries may contradict each other. Explain the conflict in one sentence and suggest a merged version (max 200 chars). Return ONLY valid JSON matching this schema: { "conflict": "description", "merged_content": "merged text" }\n\nEntry A: ${entryA.slice(0, 300)}\nEntry B: ${entryB.slice(0, 300)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return typeof r.conflict === 'string' && typeof r.merged_content === 'string'
        && r.merged_content.length <= 200;
    },
  },

  summarize: {
    name: 'summarize',
    prompt: (content: string) =>
      `Summarize this development observation in 1-2 sentences. Preserve technical details (file names, error codes, function names). Return ONLY valid JSON matching this schema: { "summary": "the summary", "key_terms": ["term1", "term2"] }\n\n${content.slice(0, 1000)}`,
    validate: (r: unknown): boolean => {
      if (!isObject(r)) return false;
      return typeof r.summary === 'string' && r.summary.length <= 200
        && Array.isArray(r.key_terms) && r.key_terms.every((t: unknown) => typeof t === 'string');
    },
  },
} as const satisfies Record<string, PromptTemplate>;
