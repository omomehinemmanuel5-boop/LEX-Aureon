import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateApiKey, getKeysByTenantId } from '@/lib/api_keys';
import { accountFromCookie } from '@/lib/auth_accounts';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

const KeyCreateSchema = z.object({
  name:  z.string().max(64).optional(),
}).strict();

export async function POST(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return NextResponse.json({ error: 'Request origin was not accepted.' }, { status: 403 });
  const user = await accountFromCookie(req.headers.get('cookie')).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Verified account sign-in required.' }, { status: 401 });
  try {
    let raw: unknown;
    try { raw = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = KeyCreateSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error?.issues?.[0]?.message ?? 'invalid request';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { name } = parsed.data;
    const existing = await getKeysByTenantId(user.tenantId);
    if (existing.length >= 3) {
      return NextResponse.json({ error: 'Free tier limit: 3 keys per tenant.' }, { status: 429 });
    }
    const apiKey = await generateApiKey({ email: user.email, name, plan: 'free', tenantId: user.tenantId });
    if (!apiKey) return NextResponse.json({ error: 'Failed to generate key' }, { status: 500 });
    return NextResponse.json({
      ok: true, key: apiKey.key, id: apiKey.id, name: apiKey.name,
      plan: apiKey.plan, runs_limit: apiKey.runs_limit, expires_at: apiKey.expires_at,
      message: `Your API key has been generated. Store it safely — it won't be shown again.`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const user = await accountFromCookie(req.headers.get('cookie'));
    if (!user) return NextResponse.json({ error: 'Verified account sign-in required.' }, { status: 401 });
    const keys = await getKeysByTenantId(user.tenantId);
    const masked = keys.map(k => ({
      id: k.id, name: k.name,
      key_preview: k.key_preview,
      plan: k.plan, runs_used: k.runs_used, runs_limit: k.runs_limit,
      created_at: k.created_at, last_used_at: k.last_used_at, expires_at: k.expires_at,
    }));
    return NextResponse.json({ ok: true, keys: masked, total: masked.length });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
