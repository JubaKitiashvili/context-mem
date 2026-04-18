/**
 * haiku-client.mjs
 * ================
 * ESM module that bridges CommonJS benchmark harnesses to @anthropic-ai/claude-agent-sdk.
 *
 * Auth (auto-detected by the SDK):
 *   1. If ANTHROPIC_API_KEY is set → uses API key directly.
 *   2. Otherwise → uses the `claude` CLI's OAuth session (Claude Max subscription).
 *
 * Exports:
 *   callHaiku(prompt, maxTokens?, opts?) — single-turn Haiku call, returns text string
 *   llmScoreCandidates(query, candidates, opts?) — LLM scoring of retrieval candidates
 *   ensureAuth() — tries a trivial call, logs which auth path is active
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

// ── Rate limiter (module-scoped) ──────────────────────────────────────────────
const LLM_MIN_INTERVAL_MS = 2200;
let _lastReq = 0;

async function rateLimit() {
  const elapsed = Date.now() - _lastReq;
  if (elapsed < LLM_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, LLM_MIN_INTERVAL_MS - elapsed));
  }
  _lastReq = Date.now();
}

// ── Core single-turn call via SDK ─────────────────────────────────────────────
/**
 * Call Claude Haiku for a single prompt → text response.
 * Retries up to 3× on rate-limit or transient errors.
 *
 * @param {string} prompt
 * @param {number} [maxTokens=500]
 * @param {object} [opts={}]
 * @returns {Promise<string>}
 */
export async function callHaiku(prompt, maxTokens = 500, opts = {}) {
  const retries = opts.retries ?? 3;

  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimit();
    try {
      const q = query({
        prompt,
        options: {
          model: 'claude-haiku-4-5-20251001',
          maxTurns: 1,
        },
      });

      for await (const msg of q) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') return msg.result;
          // Non-success result — treat as retriable on last attempt
          const errMsg = msg.errors?.join('; ') ?? msg.subtype;
          if (attempt < retries - 1) {
            await new Promise(r => setTimeout(r, 5000));
            break; // retry
          }
          throw new Error(`SDK error: ${errMsg}`);
        }
      }
    } catch (e) {
      const msg = e?.message ?? String(e);
      // Detect rate-limit errors — back off 20s
      if (/rate.?limit|429|overloaded/i.test(msg)) {
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return '';
}

// ── LLM candidate scorer (moved from kernel-adapter.js) ───────────────────────
/**
 * Score retrieval candidates using Claude Haiku as an LLM judge.
 * Returns an array of scores (0–10) parallel to `candidates`, or null on failure.
 *
 * @param {string} queryText
 * @param {Array<{id: string, score: number, content: string}>} candidates
 * @param {object} [opts={}]
 * @returns {Promise<number[]|null>}
 */
export async function llmScoreCandidates(queryText, candidates, opts = {}) {
  if (candidates.length === 0) return [];
  const retries = opts.retries ?? 3;

  const numbered = candidates
    .map((c, i) => `[${i}] ${c.content.slice(0, 1500)}`)
    .join('\n\n');

  const prompt =
    `A user is asking: "${queryText}"\n\n` +
    `Find sessions that help answer this question. Look for BOTH direct and indirect evidence:\n\n` +
    `Score 10: directly answers the question.\n` +
    `Score 7-9: strongly relevant — same topic, related entities, specific details.\n` +
    `Score 4-6: indirect clues — preferences, past activities, background context.\n` +
    `Score 0-3: unrelated.\n\n` +
    `Key rules:\n` +
    `- "recommend a show/movie" → find sessions about entertainment: stand-up comedy, Netflix, streaming, actors, genres.\n` +
    `- "siblings" → sessions mentioning brother, sister, family members.\n` +
    `- "cooking for friend" → sessions about baking, recipes, dinner parties, desserts.\n` +
    `- "bought X" / "X arrived" → sessions about ANY purchases or deliveries (even different items).\n` +
    `- Sessions where user discusses specific titles, brands, or preferences ARE highly relevant.\n\n` +
    `Sessions:\n${numbered}\n\n` +
    `Return ONLY a JSON object with ALL ${candidates.length} indices: {"0": 8, "1": 3, ...}.`;

  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimit();
    try {
      const q = query({
        prompt,
        options: {
          model: 'claude-haiku-4-5-20251001',
          maxTurns: 1,
        },
      });

      let text = '';
      for await (const msg of q) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            text = msg.result;
          } else if (attempt < retries - 1) {
            break; // retry
          }
          break;
        }
      }

      if (!text) {
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        return null;
      }

      const match = text.match(/\{[^{}]*\}/s);
      if (!match) return null;
      const scores = JSON.parse(match[0]);
      if (typeof scores !== 'object' || scores === null) return null;

      const scoreArr = new Array(candidates.length).fill(0);
      for (const [k, v] of Object.entries(scores)) {
        const idx = parseInt(k, 10);
        if (!isNaN(idx) && idx >= 0 && idx < candidates.length && typeof v === 'number') {
          scoreArr[idx] = Math.max(0, Math.min(10, v));
        }
      }
      return scoreArr;
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (/rate.?limit|429|overloaded/i.test(msg)) {
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      if (attempt === retries - 1) return null;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return null;
}

// ── Auth probe ────────────────────────────────────────────────────────────────
/**
 * Try a 5-token call and report which auth path is active.
 * Logs the result to console. Returns { ok, authPath } or throws.
 *
 * @returns {Promise<{ok: boolean, authPath: string}>}
 */
export async function ensureAuth() {
  let authPath = 'unknown';

  try {
    const q = query({
      prompt: 'Reply with the single word: ok',
      options: {
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 1,
      },
    });

    for await (const msg of q) {
      // The system init message carries apiKeySource
      if (msg.type === 'system' && msg.subtype === 'init') {
        const src = msg.apiKeySource ?? '';
        if (src === 'none' || src === '' || src === 'oauth') {
          authPath = 'claude-code (OAuth / Claude Max subscription)';
        } else if (src === 'envVar') {
          authPath = 'ANTHROPIC_API_KEY (environment variable)';
        } else {
          authPath = `api-key (source: ${src})`;
        }
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          console.log(`  Auth path: ${authPath}`);
          return { ok: true, authPath };
        }
        const errMsg = msg.errors?.join('; ') ?? msg.subtype;
        throw new Error(`Auth probe failed: ${errMsg}`);
      }
    }

    // If we get here without a result message
    console.log(`  Auth path: ${authPath}`);
    return { ok: true, authPath };
  } catch (e) {
    const msg = e?.message ?? String(e);
    const isAuthErr = /auth|login|credentials|api.?key|oauth|401|403/i.test(msg);
    if (isAuthErr) {
      console.error('  Auth ERROR:', msg);
      console.error('  To authenticate, either:');
      console.error('    1. Run `claude` and follow the login prompts (uses Claude Max subscription)');
      console.error('    2. Set ANTHROPIC_API_KEY=sk-ant-... in your environment');
      throw new Error('Authentication required. See above for instructions.');
    }
    throw e;
  }
}
