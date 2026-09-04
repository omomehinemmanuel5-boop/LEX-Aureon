import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_PROMPT_CHARS } from '../lib/schemas';

const mockClient = {
  async execute(arg: string | { sql: string; args?: unknown[] }) {
    const sql = typeof arg === 'string' ? arg : arg.sql;
    if (sql === 'SELECT 1') return { rows: [{ '1': 1 }] };
    if (sql.includes('FROM run_stats')) return { rows: [{ value: 1337 }] };
    if (sql.startsWith('UPDATE run_stats')) return { rows: [{ value: 1338 }] };
    if (sql.includes('FROM praxis_receipts')) return { rows: [] };
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
  initSchema: vi.fn(async () => undefined),
}));

vi.mock('../lib/lex_memory', () => ({
  embedText: vi.fn(async () => new Array(256).fill(0.01)),
  retrieveSimilar: vi.fn(async () => []),
  buildMemoryContext: vi.fn(() => ''),
  storeMemory: vi.fn(async () => undefined),
  classifyStateLabel: vi.fn(() => 'STABLE'),
  ensureLexMemoryTable: vi.fn(async () => undefined),
  getConstitutionalCentroid: vi.fn(async () => null),
  getSessionCentroid: vi.fn(async () => null),
  invalidateCentroidCache: vi.fn(),
  pruneEmbeddingCache: vi.fn(async () => 0),
}));

vi.mock('../lib/rate_limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, retryAfter: 0 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  getRateLimitKey: vi.fn((ip: string) => 'rate:' + ip),
}));

vi.mock('../lib/api_keys', () => ({
  validateApiKey: vi.fn(async () => ({ valid: true, key: undefined })),
  consumeApiKey: vi.fn(async () => ({ valid: true, key: undefined })),
  validateAndConsumeKey: vi.fn(async () => ({ valid: true, key: undefined })),
}));

describe('API integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/lex/govern rejects missing prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: 's1' }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/prompt/i);
  });

  it('POST /api/lex/govern rejects blank prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '   ', session_id: 's1' }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/prompt/i);
  });

  it('POST /api/lex/govern rejects oversized prompt', async () => {
    const { POST } = await import('../app/api/lex/govern/route');
    const req = new Request('http://localhost/api/lex/govern', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a'.repeat(MAX_PROMPT_CHARS + 1), session_id: 's1' }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/prompt/i);
  });

  it('observability metrics reject invalid windows with correlation headers', async () => {
    const { GET } = await import('../app/api/observability/metrics/route');
    const traceId = '0123456789abcdef0123456789abcdef';
    const res = await GET(new Request('http://localhost/api/observability/metrics?window_minutes=2', { headers: { 'x-request-id': 'observability-test', traceparent: '00-' + traceId + '-0123456789abcdef-01' } }) as Request);
    expect(res.status).toBe(400);
    expect(res.headers.get('x-request-id')).toBe('observability-test');
    expect(res.headers.get('x-trace-id')).toBe(traceId);
  });

  it('exposes a Prometheus-compatible observability endpoint', async () => {
    const { GET } = await import('../app/api/observability/prometheus/route');
    const res = await GET(new Request('http://localhost/api/observability/prometheus') as Request);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\\/plain/);
    expect(body).toMatch(/lex_governance_calls_in_window/);
    expect(body).toMatch(/lex_observability_up 1/);
  });
});
