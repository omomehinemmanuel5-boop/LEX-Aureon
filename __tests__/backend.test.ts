import { describe, it, expect, afterEach } from 'vitest';
import { getBackendUrl } from '../lib/backend';

const ORIG_URL = process.env.LEX_API_BASE_URL;
const ORIG_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIG_URL === undefined) delete process.env.LEX_API_BASE_URL;
  else process.env.LEX_API_BASE_URL = ORIG_URL;
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIG_NODE_ENV;
});

describe('getBackendUrl', () => {
  it('returns env var value when set', () => {
    process.env.LEX_API_BASE_URL = 'https://api.example.com';
    expect(getBackendUrl()).toBe('https://api.example.com');
  });

  it('strips trailing slash', () => {
    process.env.LEX_API_BASE_URL = 'https://api.example.com/';
    expect(getBackendUrl()).toBe('https://api.example.com');
  });

  it('throws in production when unset', () => {
    delete process.env.LEX_API_BASE_URL;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(() => getBackendUrl()).toThrow(/LEX_API_BASE_URL/);
  });

  it('falls back to default in non-production when unset', () => {
    delete process.env.LEX_API_BASE_URL;
    (process.env as Record<string, string>).NODE_ENV = 'development';
    expect(getBackendUrl()).toMatch(/^https:\/\//);
  });
});
