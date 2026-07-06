/**
 * POST /api/leads/reverify
 *
 * Admin-only (Basic Auth). Re-runs on-chain verification for a specific lead
 * that landed in 'needs_review' (e.g. the transaction wasn't confirmed yet at
 * submission time, or a coin's verification API had a transient error).
 * On a clean pass, issues the Sovereign key exactly like the original
 * submission path would have.
 *
 * Body: { id: number }
 */

import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { env } from '@/lib/env';
import { logger, errorFields } from '@/lib/logger';
import { verifyPayment, type CoinId } from '@/lib/crypto_verify';
import { getCoinConfig } from '@/lib/crypto_coins';
import { generateApiKey } from '@/lib/api_keys';
import { sendKeyDeliveryEmail } from '@/lib/notify';

function checkAdminAuth(req: Request): boolean {
  const adminPassword = env.ADMIN_PASSWORD;
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const password = decoded.slice(decoded.indexOf(':') + 1);
    return password === adminPassword;
  } catch { return false; }
}

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) {
    return new NextResponse('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Lex Aureon Admin"' } });
  }

  let body: { id?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const c = getClient();
  const row = await c.execute({ sql: `SELECT * FROM leads WHERE id = ?`, args: [body.id] });
  if (!row.rows.length) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  const lead = row.rows[0] as unknown as { email: string; tx_id: string | null; coin: string | null; issued_key: string | null };
  if (lead.issued_key) {
    return NextResponse.json({ ok: true, message: 'A key was already issued for this lead — no action taken.', already_issued: true });
  }
  if (!lead.tx_id || !lead.coin) {
    return NextResponse.json({ error: 'lead has no txId/coin to verify' }, { status: 400 });
  }

  const coinConfig = getCoinConfig(lead.coin);
  if (!coinConfig) return NextResponse.json({ error: `unrecognized coin: ${lead.coin}` }, { status: 400 });

  try {
    const result = await verifyPayment(coinConfig.id as CoinId, lead.tx_id, coinConfig.address, coinConfig.amount);
    let issuedKey: string | null = null;

    if (result.status === 'verified') {
      const apiKey = await generateApiKey({ email: lead.email, name: `Sovereign (${coinConfig.symbol} payment, re-verified)`, plan: 'sovereign' });
      if (apiKey) {
        issuedKey = apiKey.key;
        await sendKeyDeliveryEmail({ to: lead.email, apiKey: apiKey.key, plan: apiKey.plan, runsLimit: apiKey.runs_limit });
      }
    }

    await c.execute({
      sql: `UPDATE leads SET verification_status = ?, verification_reason = ?, issued_key = COALESCE(?, issued_key),
                              verified_at = CASE WHEN ? = 'verified' THEN unixepoch() ELSE verified_at END
            WHERE id = ?`,
      args: [result.status, result.reason, issuedKey, result.status, body.id],
    });

    logger.info('leads.reverify', 're-verification complete', { id: body.id, status: result.status, issued: !!issuedKey });
    return NextResponse.json({ ok: true, status: result.status, reason: result.reason, issued_key: issuedKey });
  } catch (e) {
    logger.error('leads.reverify', 'error', errorFields(e));
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
