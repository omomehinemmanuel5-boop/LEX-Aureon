import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/db', () => ({
  seedSovereignLaws: vi.fn(async () => undefined),
  getTotalRuns: vi.fn(async () => 1337),
  getClient: vi.fn(() => null),
  runZTrajMigrations: vi.fn(async () => undefined),
  getAggregateConstitutionalState: vi.fn(async () => ({ C: 0.34, R: 0.33, S: 0.33 })),
}));

describe('API integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/lex/run rejects missing session_id and prompt', async () => {
    const { POST } = await import('../app/api/lex/run/route');

    const req = new Request('http://localhost/api/lex/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/session_id and prompt required/);
  });

  it('POST /api/lex/run rejects oversized prompts', async () => {
    const { POST } = await import('../app/api/lex/run/route');

    const req = new Request('http://localhost/api/lex/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a'.repeat(8001), session_id: 's1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too long/i);
  });

  it('GET /api/stats returns current run count', async () => {
    const { GET } = await import('../app/api/stats/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: 1337 });
  });

  it('GET /api/health reports bridge status', async () => {
    const { GET } = await import('../app/api/health/route');
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.api).toBe('healthy');
    expect(data.storage.mode).toBe('memory');
    expect(data.frontend_contract.routes.lex_run).toBe('/api/lex/run');
  });

  it('GET /api/audits/recent returns empty receipts when no DB', async () => {
    const { GET } = await import('../app/api/audits/recent/route');
    const req = new Request('http://localhost/api/audits/recent?limit=5');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.receipts)).toBe(true);
  });

  it('GET /api/live-state returns aggregate CRS state', async () => {
    const { GET } = await import('../app/api/live-state/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state.C + data.state.R + data.state.S).toBeCloseTo(1, 6);
    expect(data.total_runs).toBe(1337);
  });
});
