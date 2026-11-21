import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/provider_cooldown', () => ({
  isOnCooldown: () => false,
  markCooldown: () => undefined,
}));

import { parseBenchmarkPin, runWithBenchmarkPin, currentBenchmarkPin } from '../lib/benchmark_pin';
import { generateGoverned } from '../lib/llm_provider';

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe('benchmark pin parsing', () => {
  it('ignores the pin when the server has no benchmark secret', () => {
    const h = headers({ 'x-lex-benchmark-secret': 'abc', 'x-lex-benchmark-pin': 'cerebras' });
    expect(parseBenchmarkPin(h, undefined)).toBeNull();
  });

  it('rejects a wrong or missing secret, including one of a different length', () => {
    const wrong = headers({ 'x-lex-benchmark-secret': 'nope', 'x-lex-benchmark-pin': 'cerebras' });
    expect(parseBenchmarkPin(wrong, 'expected-secret')).toBeNull();
    const none = headers({ 'x-lex-benchmark-pin': 'cerebras' });
    expect(parseBenchmarkPin(none, 'expected-secret')).toBeNull();
  });

  it('rejects an unknown model key', () => {
    const h = headers({ 'x-lex-benchmark-secret': 'expected-secret', 'x-lex-benchmark-pin': 'not-a-model' });
    expect(parseBenchmarkPin(h, 'expected-secret')).toBeNull();
  });

  it('accepts a valid secret and a known model key', () => {
    const h = headers({ 'x-lex-benchmark-secret': 'expected-secret', 'x-lex-benchmark-pin': 'gemini-lite' });
    expect(parseBenchmarkPin(h, 'expected-secret')).toEqual({ key: 'gemini-lite' });
  });

  it('scopes the pin to the run and clears it afterwards', async () => {
    const seen = await runWithBenchmarkPin({ key: 'mistral' }, async () => currentBenchmarkPin());
    expect(seen).toEqual({ key: 'mistral' });
    expect(currentBenchmarkPin()).toBeNull();
  });
});

describe('pinned runs never switch or fall back', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    process.env.GROQ_API_KEY = 'stub';
    process.env.GEMINI_API_KEY = 'stub';
    process.env.CEREBRAS_API_KEY = 'stub';
    process.env.MISTRAL_API_KEY = 'stub';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response('upstream error', { status: 500 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('with a Groq pin, every request goes to Groq only, and the failed call is reported as static', async () => {
    const result = await runWithBenchmarkPin({ key: 'groq-primary' }, () =>
      generateGoverned([{ role: 'user', content: 'hello' }] as never, 'STATIC-TEXT'),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(u => u.includes('groq'))).toBe(true);
    expect(result.provider).toBe('static');
    expect(result.fallback_used).toBe(true);
    expect(result.model).toBe('pinned-failed:groq-primary');
  }, 15000);

  it('without a pin, the normal chain tries other providers', async () => {
    await generateGoverned([{ role: 'user', content: 'hello' }] as never, 'STATIC-TEXT');
    expect(calls.some(u => !u.includes('groq'))).toBe(true);
  }, 30000);
});
