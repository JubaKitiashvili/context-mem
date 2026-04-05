/**
 * Abstract LLM provider interface.
 * Each provider implements one method: complete(prompt, schema) → parsed JSON or null.
 */
export interface LLMProvider {
  name: string;
  complete(prompt: string, schema: Record<string, unknown>): Promise<unknown | null>;
  isAvailable(): Promise<boolean>;
}
