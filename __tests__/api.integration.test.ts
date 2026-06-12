import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Turso DB ─────────────────────────────────────────────────────────────
const mockClient = {
  async execute(arg: string | { sql: string; args?: unknown[] }) {
    const sql = typeof arg === 'string' ? arg : arg.sql;
    if (sql === 'SELECT 1') return { rows: [{ '1': 1 }] };
    if (sql.includes('FROM run_stats'))      return { rows: [{ value: 1337 }] };
    if (sql.startsWith('UPDATE run_stats'))  return { rows: [{ value: 1338 }] };
    if (sql.includes('FROM praxis_receipts')) return { rows: [] };
    return { rows: [] };
  },
  async batch() { return []; },
};

vi.mock('../lib/db', () => ({
  seedSovereignLaws:             vi.fn(async () => undefined),
  getTotalRuns:                  vi.fn(async () => 1337),
  incrementRuns:                 vi.fn(async () => 1338),
  getClient:                     vi.fn(() => mockClient),
  db:                            mockClient,
  runZTrajMigrations:            vi.fn(async () => undefined),
  getAggregateConstitutionalState: vi.fn(async () => ({ C: 0.34, R: 0.33, S: 0.33, M: 0.33 })),
  initSchema:                    vi.fn(async () => undefined),
}));

// ── Mock lex_memory — avoids Jina API calls and crypto.subtle in test env ─────
// The govern route imports embedText, retrieveSimilar, storeMemory, etc.
// None of those should actually run in a unit/integration test.
vi.mock('../lib/lex_memory', () => ({
  embedText:                  vi.fn(async () => new Array(256).fill(0.01)),
  retrieveSimilar:            vi.fn(async () => []),
  buildMemoryContext:         vi.fn(() => ''),
  storeMemory:                vi.fn(async () => undefined),
  classifyStateLabel:         vi.fn(() => 'STABLE'),
  ensureLexMemoryTable:       vi.fn(async () => undefined),
  getConstitutionalCentroid:  vi.fn(async () => null),
  getSessionCentroid:         vi.fn(async () => null),
  invalidateCentroidCache:    vi.fn(),
  pruneEmbeddingCache:        vi.fn(async () => 0),
}));

// ── Mock rate_limit — avoids Turso calls from within the govern route ─────────
vi.mock('../lib/rate_limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, reset: 0 })),
  getRateLimitKey: vi.fn((ip: string) => `rate:${ip}`),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('API integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/lex/govern rejects missing prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/prompt/i);
  });

  it('POST /api/lex/govern rejects blank prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ', session_id: 's1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/prompt/i);
  });

  it('POST /api/lex/govern rejects oversized prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a'.repeat(8001), session_id: 's1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/too long/i);
  });

  it('POST /api/lex/govern rejects missing session_id', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/session_id/i);
  });

  it('GET /api/stats returns current run count', async () => {
    const { GET } = await import('../app/api/stats/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json() as { runs: number; total_runs: number };
    expect(data.runs).toBe(1337);
    expect(data.total_runs).toBe(1337);
  });

  it('GET /api/health reports bridge status', async () => {
    const { GET } = await import('../app/api/health/route');
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const data = await res.json() as {
      ok: boolean; api: string;
      services: { turso: string };
      frontend_contract: { routes: { lex_run: string; govern: string; govern_stream: string } };
      version: string;
    };
    expect(data.ok).toBe(true);
    expect(data.api).toBe('healthy');
    expect(data.services.turso).toBe('connected');
    expect(data.frontend_contract.routes.govern).toBe('/api/lex/govern');
    expect(data.version).toContain('SovereignKernel');
  });

  it('GET /api/audits/recent returns empty receipts when no rows', async () => {
    const { GET } = await import('../app/api/audits/recent/route');
    const req = new Request('http://localhost/api/audits/recent?limit=5');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { receipts: unknown[] };
    expect(Array.isArray(data.receipts)).toBe(true);
  });

  it('GET /api/live-state returns aggregate CRS state summing to 1', async () => {
    const { GET } = await import('../app/api/live-state/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json() as { state: { C: number; R: number; S: number }; total_runs: number };
    expect(data.state.C + data.state.R + data.state.S).toBeCloseTo(1, 6);
    expect(data.total_runs).toBe(1337);
  });
});
