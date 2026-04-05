import type { LLMProvider } from '../llm-provider.js';

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(apiKey: string, model = 'meta-llama/llama-3.2-3b-instruct:free', endpoint = 'https://openrouter.ai/api/v1/chat/completions') {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async complete(prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/context-mem',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
