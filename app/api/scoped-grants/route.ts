import { NextResponse } from 'next/server';
import { isOperatorSecret } from '@/lib/lex_crs_agent/mcp_access';
import { createScopedGrant, revokeScopedGrant } from '@/lib/scoped_grants';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Operator-only control plane for issuing and revoking scoped branch-work grants. */
export async function POST(req: Request) {
  if (!isOperatorSecret(req.headers.get('x-lex-operator-secret'))) {
    return NextResponse.json({ error: 'Operator authority required.' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'A JSON request body is required.' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'action must be create or revoke.' }, { status: 400 });
  }
  try {
    if (body.action === 'create') {
      const grant = await createScopedGrant({
        owner_id: typeof body.owner_id === 'string' ? body.owner_id : '',
        allowed_tools: Array.isArray(body.allowed_tools) ? body.allowed_tools as string[] : [],
        branch_prefixes: body.branch_prefixes === undefined ? undefined : Array.isArray(body.branch_prefixes) ? body.branch_prefixes as string[] : [],
        path_prefixes: Array.isArray(body.path_prefixes) ? body.path_prefixes as string[] : [],
        max_uses: Number(body.max_uses),
        expires_at: typeof body.expires_at === 'number' || typeof body.expires_at === 'string' ? body.expires_at : Number.NaN,
      }, true);
      return NextResponse.json({ grant }, { status: 201 });
    }
    if (body.action === 'revoke') {
      if (typeof body.grant_id !== 'string' || !body.grant_id.trim()) {
        return NextResponse.json({ error: 'grant_id is required.' }, { status: 400 });
      }
      const revoked = await revokeScopedGrant(body.grant_id, true);
      return revoked
        ? NextResponse.json({ revoked: true, grant_id: body.grant_id })
        : NextResponse.json({ revoked: false, error: 'Grant not found or already revoked.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'action must be create or revoke.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Scoped grant operation failed.',
    }, { status: 400 });
  }
}
