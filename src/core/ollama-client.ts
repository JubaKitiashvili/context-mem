/**
 * Optional Ollama LLM client for AI-assisted knowledge curation.
 * If Ollama is not running, all methods return null (graceful degradation).
 */

export class OllamaClient {
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

  async generateTitle(content: string): Promise<string | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `Generate a concise title (max 80 chars) for this knowledge entry. Return ONLY the title, nothing else:\n\n${content.slice(0, 500)}`,
          stream: false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { response?: string };
      return data.response?.trim().slice(0, 80) || null;
    } catch {
      return null;
    }
  }

  async generateTags(content: string): Promise<string[] | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `Extract 3-5 keyword tags from this text. Return ONLY comma-separated tags, nothing else:\n\n${content.slice(0, 500)}`,
          stream: false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { response?: string };
      if (!data.response) return null;
      return data.response.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length >= 2).slice(0, 5);
    } catch {
      return null;
    }
  }

  async suggestMerge(entryA: string, entryB: string): Promise<string | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `These two knowledge entries may be duplicates. Suggest a merged version (max 200 chars):\n\nEntry A: ${entryA.slice(0, 300)}\nEntry B: ${entryB.slice(0, 300)}\n\nMerged:`,
          stream: false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { response?: string };
      return data.response?.trim().slice(0, 200) || null;
    } catch {
      return null;
    }
  }
}
