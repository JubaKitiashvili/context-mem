import type { LLMProvider } from '../llm-provider.js';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async complete(prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { content?: Array<{ text?: string }> };
      const text = data.content?.[0]?.text;
      if (!text) return null;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}
