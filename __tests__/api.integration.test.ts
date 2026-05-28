import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal mocked Turso client used by every route under test.
const mockClient = {
  async execute(arg: string | { sql: string; args?: unknown[] }) {
    const sql = typeof arg === 'string' ? arg : arg.sql;
    if (sql === 'SELECT 1') return { rows: [{ '1': 1 }] };
    if (sql.includes("FROM run_stats")) return { rows: [{ value: 1337 }] };
    if (sql.startsWith('UPDATE run_stats')) return { rows: [{ value: 1338 }] };
    if (sql.includes("FROM praxis_receipts")) return { rows: [] };
    return { rows: [] };
  },
  async batch() { return []; },
};

vi.mock('../lib/db', () => ({
  seedSovereignLaws: vi.fn(async () => undefined),
  getTotalRuns: vi.fn(async () => 1337),
  incrementRuns: vi.fn(async () => 1338),
  getClient: vi.fn(() => mockClient),
  db: mockClient,
  runZTrajMigrations: vi.fn(async () => undefined),
  getAggregateConstitutionalState: vi.fn(async () => ({ C: 0.34, R: 0.33, S: 0.33, M: 0.33 })),
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
    expect(body.error).toMatch(/prompt|session_id/i);
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
    const data = await res.json();
    expect(data.runs).toBe(1337);
    expect(data.total_runs).toBe(1337);
  });

  it('GET /api/health reports bridge status', async () => {
    const { GET } = await import('../app/api/health/route');
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.api).toBe('healthy');
    expect(data.services.turso).toBe('connected');
    expect(data.frontend_contract.routes.lex_run).toBe('/api/lex/run');
    expect(data.frontend_contract.routes.govern).toBe('/api/lex/govern');
    expect(data.frontend_contract.routes.govern_stream).toBe('/api/lex/govern/stream');
    expect(data.version).toContain('SovereignKernel');
  });

  it('POST /api/lex/kernel rejects missing prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/kernel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'test-session' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/prompt/i);
  });

  it('GET /api/audits/recent returns empty receipts when no rows', async () => {
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
