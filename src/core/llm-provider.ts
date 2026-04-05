import { PROMPT_TEMPLATES } from './prompt-templates.js';

/**
 * Abstract LLM provider interface.
 * Each provider implements one method: complete(prompt, schema) → parsed JSON or null.
 */
export interface LLMProvider {
  name: string;
  complete(prompt: string, schema: Record<string, unknown>): Promise<unknown | null>;
  isAvailable(): Promise<boolean>;
}

export class LLMService {
  private provider: LLMProvider | null;

  constructor(provider: LLMProvider | null) {
    this.provider = provider;
  }

  private async call(templateName: keyof typeof PROMPT_TEMPLATES, ...args: string[]): Promise<unknown | null> {
    if (!this.provider) return null;
    const template = PROMPT_TEMPLATES[templateName];
    const promptFn = template.prompt as (...a: string[]) => string;
    const prompt = promptFn(...args);
    try {
      const result = await this.provider.complete(prompt, {});
      if (result === null) return null;
      if (!template.validate(result)) return null;
      return result;
    } catch {
      return null;
    }
  }

  async expandQuery(query: string): Promise<{ expanded: string[]; original: string } | null> {
    const result = await this.call('expand_query', query);
    if (!result) return null;
    const r = result as { expanded: string[]; original: string };
    return { expanded: r.expanded, original: r.original };
  }

  async generateTitle(content: string): Promise<string | null> {
    const result = await this.call('generate_title', content);
    if (!result) return null;
    return (result as { title: string }).title;
  }

  async generateTags(content: string): Promise<string[] | null> {
    const result = await this.call('generate_tags', content);
    if (!result) return null;
    return (result as { tags: string[] }).tags;
  }

  async explainContradiction(entryA: string, entryB: string): Promise<{ conflict: string; merged_content: string } | null> {
    const result = await this.call('explain_contradiction', entryA, entryB);
    if (!result) return null;
    const r = result as { conflict: string; merged_content: string };
    return { conflict: r.conflict, merged_content: r.merged_content };
  }

  async summarize(content: string): Promise<{ summary: string; key_terms: string[] } | null> {
    const result = await this.call('summarize', content);
    if (!result) return null;
    const r = result as { summary: string; key_terms: string[] };
    return { summary: r.summary, key_terms: r.key_terms };
  }
}
