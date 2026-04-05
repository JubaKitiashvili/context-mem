import type { LLMProvider } from '../llm-provider.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private endpoint: string;
  private model: string;
  private available: boolean | null = null;

  constructor(endpoint = 'http://localhost:11434', model = 'llama3.2') {
    this.endpoint = endpoint;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
      this.available = res.ok;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async complete(prompt: string, _schema: Record<string, unknown>): Promise<unknown | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { response?: string };
      if (!data.response) return null;
      return JSON.parse(data.response);
    } catch {
      return null;
    }
  }
}
