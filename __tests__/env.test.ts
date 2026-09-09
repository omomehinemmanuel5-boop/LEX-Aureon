import { afterEach, describe, expect, it } from 'vitest';
import { env, siteUrlForMetadata } from '@/lib/env';

const REQUIRED_SECRETS = [
  'GROQ_API_KEY',
  'JINA_API_KEY',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'ADMIN_PASSWORD',
  'CRON_SECRET',
] as const;

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('environment contract', () => {
  it('uses the canonical public URL when configured', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.com';
    expect(siteUrlForMetadata()).toBe('https://staging.example.com');
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('https://staging.example.com');
  });

  it('falls back to the production URL for build-time metadata', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteUrlForMetadata()).toBe('https://www.lexaureon.com');
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('https://www.lexaureon.com');
  });

  it.each(REQUIRED_SECRETS)('throws when %s is accessed without a value', (key) => {
    for (const requiredKey of REQUIRED_SECRETS) process.env[requiredKey] = 'configured';
    delete process.env[key];
    expect(() => env[key]).toThrow(`[Lexaureon] Missing required env var: ${key}`);
  });

  it('returns undefined for an unset optional provider', () => {
    delete process.env.GEMINI_API_KEY;
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });
});
