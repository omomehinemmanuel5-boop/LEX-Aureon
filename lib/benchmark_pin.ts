import { AsyncLocalStorage } from 'async_hooks';
import { timingSafeEqual } from 'crypto';

/**
 * Benchmark-only model pinning. A benchmark run can lock one model for every
 * governed call in the run. While a pin is active, the provider chain never
 * switches or falls back: a failed call is reported as failed, so the run can
 * exclude it. Pins are accepted only with the benchmark secret, so normal user
 * traffic is unaffected.
 */

export const PIN_PROVIDERS = {
  'groq-primary': 'groq',
  'groq-fast': 'groq',
  cerebras: 'cerebras',
  mistral: 'mistral',
  'gemini-lite': 'gemini',
  'gemini-full': 'gemini',
} as const;

export type PinKey = keyof typeof PIN_PROVIDERS;

export interface BenchmarkPin {
  key: PinKey;
}

const pinStore = new AsyncLocalStorage<BenchmarkPin>();

export function runWithBenchmarkPin<T>(pin: BenchmarkPin, fn: () => Promise<T>): Promise<T> {
  return pinStore.run(pin, fn);
}

export function currentBenchmarkPin(): BenchmarkPin | null {
  return pinStore.getStore() ?? null;
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parses a pin from request headers. Returns null unless the benchmark secret is
 * configured on the server and matches the request, and the pin key is known.
 */
export function parseBenchmarkPin(
  headers: { get(name: string): string | null },
  expectedSecret: string | undefined,
): BenchmarkPin | null {
  if (!expectedSecret) return null;
  const provided = headers.get('x-lex-benchmark-secret');
  if (!provided || !secretsMatch(provided, expectedSecret)) return null;
  const key = headers.get('x-lex-benchmark-pin');
  if (!key || !Object.prototype.hasOwnProperty.call(PIN_PROVIDERS, key)) return null;
  return { key: key as PinKey };
}
