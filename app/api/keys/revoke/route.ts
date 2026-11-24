import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeKeyForTenant } from '@/lib/api_keys';
import { accountFromCookie } from '@/lib/auth_accounts';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

const RevokeSchema = z.object({
  id:    z.string().min(1).max(64),
}).strict();

export async function DELETE(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return NextResponse.json({ error: 'Request origin was not accepted.' }, { status: 403 });
  const user = await accountFromCookie(req.headers.get('cookie')).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Verified account sign-in required.' }, { status: 401 });
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = RevokeSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error?.issues?.[0]?.message ?? 'invalid request';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { id } = parsed.data;
  try {
    const ok = await revokeKeyForTenant(id, user.tenantId);
    if (!ok) return NextResponse.json({ error: 'Key not found in this tenant.' }, { status: 404 });
    return NextResponse.json({ ok: true, message: 'Key revoked.' });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
