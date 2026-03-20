/**
 * Isolation wrapper around @huggingface/transformers for local vector embeddings.
 * Dynamic import — never loaded if the package is not installed.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

const HF_PACKAGE = '@huggingface/transformers';

let _available: boolean | null = null;
let _pipeline: any = null;

/**
 * Resolve the HF package from the user's project (cwd), not from context-mem's install location.
 * This is critical because context-mem runs as an MCP server from its own node_modules,
 * but the user installs @huggingface/transformers in their project.
 */
function resolveHfPackage(): string | null {
  // Try cwd-based resolution first (user's project)
  try {
    const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
    return cwdRequire.resolve(HF_PACKAGE);
  } catch {}
  // Fallback: try normal resolution (context-mem's own node_modules)
  try {
    const selfRequire = createRequire(path.join(__dirname, '..', '..', '..', 'package.json'));
    return selfRequire.resolve(HF_PACKAGE);
  } catch {}
  return null;
}

export class Embedder {
  /** Check if @huggingface/transformers is importable (caches result) */
  static async isAvailable(): Promise<boolean> {
    if (_available !== null) return _available;
    const resolved = resolveHfPackage();
    _available = resolved !== null;
    return _available;
  }

  /** Embed text into a Float32Array(384) or null if unavailable */
  static async embed(text: string): Promise<Float32Array | null> {
    if (!(await Embedder.isAvailable())) return null;
    try {
      if (!_pipeline) {
        const resolved = resolveHfPackage();
        if (!resolved) return null;
        // Import by resolved path to ensure we load from the correct location
        const rawMod = await import(/* webpackIgnore: true */ resolved);
        // Handle CJS/ESM interop — pipeline may be on .default or top-level
        const mod = rawMod.default && typeof rawMod.default.pipeline === 'function' ? rawMod.default : rawMod;
        _pipeline = await mod.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          dtype: 'fp32',
        });
      }
      const output = await _pipeline(text, { pooling: 'mean', normalize: true });
      return new Float32Array(output.data);
    } catch {
      return null;
    }
  }

  /** Serialize Float32Array to Buffer (1536 bytes for 384 dims) */
  static toBuffer(embedding: Float32Array): Buffer {
    return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  }

  /** Deserialize Buffer back to Float32Array */
  static fromBuffer(buf: Buffer): Float32Array {
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    view.set(buf);
    return new Float32Array(ab);
  }

  /** Cosine similarity between two vectors. Returns [-1, 1]. */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Reset cached state (for tests) */
  static _reset(): void {
    _available = null;
    _pipeline = null;
  }
}
