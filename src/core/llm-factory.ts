import type { AICurationConfig } from './types.js';
import { LLMService } from './llm-provider.js';
import type { LLMProvider } from './llm-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { OpenRouterProvider } from './providers/openrouter-provider.js';
import { ClaudeProvider } from './providers/claude-provider.js';

/**
 * Create an LLMService with the appropriate provider based on config and environment.
 * Auto-detect priority: ANTHROPIC_API_KEY → Ollama → OPENROUTER_API_KEY → null
 */
export async function createLLMService(
  config: AICurationConfig,
  anthropicKey?: string,
  openrouterKey?: string,
): Promise<LLMService> {
  if (!config.enabled) return new LLMService(null);

  const aKey = anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const oKey = openrouterKey ?? process.env.OPENROUTER_API_KEY ?? '';

  let provider: LLMProvider | null = null;

  if (config.provider && config.provider !== 'auto') {
    switch (config.provider) {
      case 'claude':
        provider = aKey ? new ClaudeProvider(aKey, config.model) : null;
        break;
      case 'ollama':
        provider = new OllamaProvider(config.endpoint, config.model);
        if (!(await provider.isAvailable())) provider = null;
        break;
      case 'openrouter':
        provider = oKey ? new OpenRouterProvider(oKey, config.model) : null;
        break;
    }
  } else {
    // Auto-detect priority: Claude → Ollama → OpenRouter
    if (aKey) {
      provider = new ClaudeProvider(aKey, config.model);
    } else {
      const ollama = new OllamaProvider(config.endpoint, config.model);
      if (await ollama.isAvailable()) {
        provider = ollama;
      } else if (oKey) {
        provider = new OpenRouterProvider(oKey, config.model);
      }
    }
  }

  return new LLMService(provider);
}
