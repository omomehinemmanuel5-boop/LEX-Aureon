import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeKey } from '@/lib/api_keys';

const RevokeSchema = z.object({
  id:    z.string().min(1).max(64),
  email: z.string().email().max(254),
});

// DELETE /api/keys/revoke — revoke a key
export async function DELETE(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = RevokeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id, email } = parsed.data;

  try {
    const ok = await revokeKey(id, email);
    if (!ok) return NextResponse.json({ error: 'Key not found or email mismatch' }, { status: 404 });
    return NextResponse.json({ ok: true, message: 'Key revoked.' });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
