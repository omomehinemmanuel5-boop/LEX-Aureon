/**
 * POST /api/admin/mcp-test-key
 *
 * Creates a private, high-quota MCP key. This is intentionally separate from
 * the public /api/keys route: the caller must know ADMIN_PASSWORD, and the
 * private_test plan is not accepted by public key generation.
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { generateApiKey } from '@/lib/api_keys';
import { checkRateLimit, getClientIp } from '@/lib/rate_limit';

function isAdmin(req: Request): boolean {
  const configured = env.ADMIN_PASSWORD;
  const direct = req.headers.get('x-admin-password')?.trim();
  const authorization = req.headers.get('authorization') ?? '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  return direct === configured || bearer === configured;
}

export async function POST(req: Request) {
  if (!isAdmin(req)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const rate = await checkRateLimit(`admin:mcp-test-key:${getClientIp(req)}`, 5, 60 * 60);
  if (rate.storageError) {
    return NextResponse.json({ error: 'Credential issuance temporarily unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Credential issuance rate limit exceeded' }, {
      status: 429,
      headers: { 'Retry-After': String(rate.retryAfter), 'Cache-Control': 'no-store' },
    });
  }

  let body: { email?: unknown; name?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Defaults are safe; the endpoint is already admin-protected.
  }

  const email = typeof body.email === 'string' && body.email.includes('@')
    ? body.email.slice(0, 254)
    : 'private-test@lexaureon.local';
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 64)
    : 'Private MCP test';

  const apiKey = await generateApiKey({ email, name, plan: 'private_test' });
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Failed to generate key' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({
    ok: true,
    key: apiKey.key,
    id: apiKey.id,
    name: apiKey.name,
    plan: apiKey.plan,
    runs_limit: apiKey.runs_limit,
    expires_at: apiKey.expires_at,
    message: 'Private MCP test key generated. Store it safely; it will not be shown again.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
