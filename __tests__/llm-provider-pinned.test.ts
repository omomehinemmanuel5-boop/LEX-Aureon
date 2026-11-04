import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/provider_cooldown', () => ({
  isOnCooldown: vi.fn(async () => false),
  markCooldown: vi.fn(),
}));

import { generateGovernedPinned, MODELS } from '../lib/llm_provider';
import { markCooldown } from '../lib/provider_cooldown';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function geminiSuccess(text = '[]'): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('pinned provider request classification', () => {
  it('retries a transient 5xx on the same model and then succeeds', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(geminiSuccess());
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGovernedPinned([{ role: 'user', content: 'hello' }], MODELS.GEMINI_FULL, '[]');

    expect(result.text).toBe('[]');
    expect(result.model).toBe(MODELS.GEMINI_FULL);
    expect(result.provider).toBe('gemini');
    expect(result.fallback_used).toBe(false);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/models/${MODELS.GEMINI_FULL}:generateContent`);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/models/${MODELS.GEMINI_FULL}:generateContent`);
  });

  it('retries a temporary network failure once the transport becomes available', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(geminiSuccess());
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGovernedPinned([{ role: 'user', content: 'hello' }], MODELS.GEMINI_FULL, '[]');

    expect(result.text).toBe('[]');
    expect(result.attempts).toBe(2);
    expect(result.fallback_used).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a quota/rate-limit response and returns its typed failure', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota exhausted', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGovernedPinned([{ role: 'user', content: 'hello' }], MODELS.GEMINI_FULL, '[]');

    expect(result.fallback_used).toBe(true);
    expect(result.failure).toEqual({ category: 'rate_limited', retryable: false, status: 429 });
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(markCooldown).toHaveBeenCalledOnce();
  });

  it('classifies forbidden quota/auth responses without retrying them', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('billing or authorization issue', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGovernedPinned([{ role: 'user', content: 'hello' }], MODELS.GEMINI_FULL, '[]');

    expect(result.failure).toEqual({ category: 'quota_or_auth', retryable: false, status: 403 });
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat empty provider content as success or retry it', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(geminiSuccess('   '));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateGovernedPinned([{ role: 'user', content: 'hello' }], MODELS.GEMINI_FULL, '[]');

    expect(result.fallback_used).toBe(true);
    expect(result.failure?.category).toBe('empty_response');
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
