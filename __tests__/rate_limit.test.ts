import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, getClientIp } from '../lib/rate_limit';

// Ensure KV is not detected → memory path
beforeEach(() => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

describe('checkRateLimit (memory fallback)', () => {
  it('allows up to the limit and blocks afterwards', async () => {
    const key = `test:${Date.now()}-${Math.random()}`;
    let allowedCount = 0;
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(key, 3, 60);
      if (r.allowed) allowedCount += 1;
    }
    expect(allowedCount).toBe(3);
  });

  it('reports retryAfter when blocked', async () => {
    const key = `test:${Date.now()}-${Math.random()}`;
    await checkRateLimit(key, 1, 60);
    const blocked = await checkRateLimit(key, 1, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('decrements remaining', async () => {
    const key = `test:${Date.now()}-${Math.random()}`;
    const r1 = await checkRateLimit(key, 5, 60);
    const r2 = await checkRateLimit(key, 5, 60);
    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
  });
});

describe('getClientIp', () => {
  it('reads x-forwarded-for first hop', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('http://localhost', { headers: { 'x-real-ip': '198.51.100.7' } });
    expect(getClientIp(req)).toBe('198.51.100.7');
  });

  it('returns "unknown" when no headers', () => {
    const req = new Request('http://localhost');
    expect(getClientIp(req)).toBe('unknown');
  });
});
