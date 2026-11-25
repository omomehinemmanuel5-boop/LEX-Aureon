import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Turso so rate_limit's atomic SQL behaves correctly without a live DB.
type Row = { count: number; window_start: number };
const store = new Map<string, Row>();

vi.mock('../lib/db', () => ({
  getClient: () => ({
    async execute(arg: string | { sql: string; args: (string | number)[] }) {
      if (typeof arg === 'string') return { rows: [] };
      const { sql, args } = arg;
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { rows: [] };
      if (sql.startsWith('INSERT INTO rate_limits')) {
        const [key, now, windowStart, , nowFresh] = args as [string, number, number, number, number];
        const existing = store.get(key);
        const isReserve = sql.includes('WHERE window_start < ? OR count < ?');
        if (isReserve && existing && existing.window_start >= windowStart && existing.count >= Number(args[6])) {
          return { rows: [] };
        }
        let row: Row;
        if (!existing) {
          row = { count: 1, window_start: now };
        } else if (existing.window_start < windowStart) {
          row = { count: 1, window_start: nowFresh };
        } else {
          row = { count: existing.count + 1, window_start: existing.window_start };
        }
        store.set(key, row);
        return { rows: [row] };
      }
      if (sql.startsWith('SELECT count, window_start FROM rate_limits')) {
        const key = String(args[0]);
        const row = store.get(key);
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
  }),
}));

import { checkRateLimit, checkRateLimitReserve, getClientIp } from '../lib/rate_limit';

beforeEach(() => {
  store.clear();
});

describe('checkRateLimit (Turso-backed)', () => {
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

describe('checkRateLimitReserve (Turso-backed)', () => {
  it('admits exactly the configured number of requests', async () => {
    const key = `reserve:1795576840498-${Math.random()}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => checkRateLimitReserve(key, 3, 60)));
    expect(results.filter(result => result.allowed)).toHaveLength(3);
    expect(results.filter(result => !result.allowed)).toHaveLength(2);
  });

  it('does not increment the stored count for denied retries', async () => {
    const key = `reserve-denied:1795576840498-${Math.random()}`;
    await checkRateLimitReserve(key, 1, 60);
    const denied = await checkRateLimitReserve(key, 1, 60);
    expect(denied.allowed).toBe(false);
    expect(store.get(key)?.count).toBe(1);
  });

  it('resets the reservation count after the window expires', async () => {
    const key = `reserve-reset:${Date.now()}-${Math.random()}`;
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_061_001);
    const first = await checkRateLimitReserve(key, 1, 60);
    const denied = await checkRateLimitReserve(key, 1, 60);
    const afterWindow = await checkRateLimitReserve(key, 1, 60);
    expect(first.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(afterWindow.allowed).toBe(true);
    vi.restoreAllMocks();
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
