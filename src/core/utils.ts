// Minimal ULID implementation (no deps) with monotonic counter
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let lastRandom = new Uint8Array(16);

export function ulid(): string {
  const now = Date.now();
  let str = '';

  // Encode 48-bit timestamp (10 chars)
  // Use modulo (not bitwise AND) — JS bitwise ops truncate to 32 bits
  let t = now % (2 ** 48);
  for (let i = 9; i >= 0; i--) {
    str = ENCODING[t % 32] + str;
    t = Math.floor(t / 32);
  }

  // Monotonic: if same millisecond, increment random portion
  if (now === lastTime) {
    for (let i = lastRandom.length - 1; i >= 0; i--) {
      lastRandom[i]++;
      if (lastRandom[i] < 32) break;
      lastRandom[i] = 0;
    }
  } else {
    lastTime = now;
    for (let i = 0; i < lastRandom.length; i++) {
      lastRandom[i] = Math.floor(Math.random() * 32);
    }
  }

  // Append 16 random chars (ULID spec: 10 timestamp + 16 random = 26 total)
  for (let i = 0; i < 16; i++) {
    str += ENCODING[lastRandom[i]];
  }

  return str;
}

// Approximate token count (~4 chars per token for English/code)
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

// Fast non-crypto hash (FNV-1a 64-bit, returned as hex string)
export function fnv1a64(input: string): string {
  let h = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & BigInt('0xffffffffffffffff');
  }
  return h.toString(16).padStart(16, '0');
}
