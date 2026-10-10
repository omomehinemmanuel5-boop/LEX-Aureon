import { describe, expect, it } from 'vitest';
import { MODELS } from '../lib/llm_provider';

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
});
