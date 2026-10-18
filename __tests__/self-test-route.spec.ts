import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runSelfTest } = vi.hoisted(() => ({ runSelfTest: vi.fn() }));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  },
}));

vi.mock('@/lib/lex_crs_agent/tools', () => ({ run_self_test: runSelfTest }));

import { POST } from '../app/api/self-test/route';

describe('self-test route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the local self-test implementation without an unauthenticated MCP request', async () => {
    runSelfTest.mockResolvedValue('SELF-TEST OK');

    const response = await POST();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result: 'SELF-TEST OK' });
    expect(runSelfTest).toHaveBeenCalledOnce();
  });

  it('returns a bounded failure when the self-test throws', async () => {
    runSelfTest.mockRejectedValue(new Error('self-test failed'));

    const response = await POST();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'self-test failed' });
  });
});
