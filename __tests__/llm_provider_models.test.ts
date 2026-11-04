import { describe, expect, it } from 'vitest';
import { MODELS, retryPinnedCall } from '../lib/llm_provider';

describe('LLM provider model IDs', () => {
  it('uses supported Groq production models instead of decommissioned Llama IDs', () => {
    expect(MODELS.PRIMARY).toBe('openai/gpt-oss-120b');
    expect(MODELS.FAST).toBe('openai/gpt-oss-20b');
    expect([MODELS.PRIMARY, MODELS.FAST]).not.toContain('llama-3.3-70b-versatile');
    expect([MODELS.PRIMARY, MODELS.FAST]).not.toContain('llama-3.1-8b-instant');
  });

  it('keeps the independent Cerebras GPT-OSS 120B fallback configured', () => {
    expect(MODELS.CEREBRAS).toBe('gpt-oss-120b');
  });

  it('retries transient HTTP 5xx failures on the same pinned call and stops after success', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await retryPinnedCall<string>(async reportFailure => {
      calls++;
      if (calls < 3) {
        reportFailure({ category: 'http_5xx', retryable: true, status: 503 });
        return null;
      }
      return 'same-model response';
    }, async delay => { delays.push(delay); });
    expect(result).toEqual({ result: 'same-model response', attempts: 3 });
    expect(calls).toBe(3);
    expect(delays).toEqual([500, 1_000]);
  });

  it('does not retry rate-limit, quota/auth, or other non-transient failures', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await retryPinnedCall<string>(async reportFailure => {
      calls++;
      reportFailure({ category: 'rate_limited', retryable: false, status: 429 });
      return null;
    }, async delay => { delays.push(delay); });
    expect(result).toEqual({ result: null, attempts: 1, failure: { category: 'rate_limited', retryable: false, status: 429 } });
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('caps transient retries at two retries and treats an empty response as terminal', async () => {
    let calls = 0;
    const delays: number[] = [];
    const exhausted = await retryPinnedCall<string>(async reportFailure => {
      calls++;
      reportFailure({ category: 'timeout', retryable: true });
      return null;
    }, async delay => { delays.push(delay); });
    expect(exhausted.attempts).toBe(3);
    expect(exhausted.failure?.category).toBe('timeout');
    expect(calls).toBe(3);
    expect(delays).toEqual([500, 1_000]);

    calls = 0;
    const empty = await retryPinnedCall<string>(async reportFailure => {
      calls++;
      reportFailure({ category: 'empty_response', retryable: false });
      return '';
    }, async delay => { delays.push(delay); });
    expect(empty.failure?.category).toBe('empty_response');
    expect(calls).toBe(1);
  });
});
