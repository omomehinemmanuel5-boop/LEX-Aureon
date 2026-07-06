/**
 * app/api/leads/route.ts
 *
 * fix (2026-07-06): previously this endpoint just wrote {email, txId, coin,
 * amount, plan} to a `leads` table and did nothing else — no blockchain
 * check, no key issuance, no notification. The UI promised "we'll verify
 * on-chain and send your Sovereign API key within 30 minutes"; that promise
 * depended entirely on a human manually checking the admin leads list and
 * manually issuing a key by hand, with zero automation or audit trail.
 *
 * Now: a crypto_upgrade submission with a txId triggers real on-chain
 * verification (lib/crypto_verify.ts) against the exact address/amount for
 * that coin (lib/crypto_coins.ts — the same single source the UI reads from).
 *   - 'verified'      → a Sovereign API key is generated immediately and
 *                        stored on the lead row; delivery is attempted via
 *                        lib/notify.ts (honest no-op until an email provider
 *                        is configured — the key is never lost either way).
 *   - 'needs_review'  → stored with the reason, NO key issued. Requires a
 *                        human to look at it (see the re-verify endpoint).
 *   - 'failed'         → malformed input; no key issued.
 * This fails CLOSED by design — see lib/crypto_verify.ts's header for why.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getClient } from '@/lib/db';
import { env } from '@/lib/env';
import { logger, errorFields } from '@/lib/logger';
import { verifyPayment, type CoinId } from '@/lib/crypto_verify';
import { getCoinConfig } from '@/lib/crypto_coins';
import { generateApiKey } from '@/lib/api_keys';
import { sendKeyDeliveryEmail } from '@/lib/notify';

const LeadSchema = z.object({
  email:  z.string().email().max(254),
  source: z.string().max(64).optional(),
  plan:   z.string().max(64).optional(),
  txId:   z.string().max(128).optional(),
  amount: z.string().max(64).optional(),
  coin:   z.string().max(32).optional(),
});

async function ensureLeadsTable(): Promise<void> {
  const c = getClient();
  await c.execute(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    source TEXT DEFAULT 'console',
    plan TEXT DEFAULT 'explorer',
    tx_id TEXT,
    amount TEXT,
    coin TEXT,
    verification_status TEXT,
    verification_reason TEXT,
    issued_key TEXT,
    verified_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  // Additive migration for rows created before this fix — SQLite/libSQL
  // ignores duplicate-column errors from IF NOT EXISTS-style guards, so this
  // is safe to run every time.
  for (const col of ['verification_status TEXT', 'verification_reason TEXT', 'issued_key TEXT', 'verified_at INTEGER']) {
    try { await c.execute(`ALTER TABLE leads ADD COLUMN ${col}`); } catch { /* column already exists */ }
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error?.issues?.[0]?.message ?? 'invalid request';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { email, source = 'console', plan = 'explorer', txId, amount, coin } = parsed.data;

  await ensureLeadsTable();
  const c = getClient();

  // ── Attempt on-chain verification for crypto upgrade submissions ─────────
  let verification: { status: string; reason: string } | null = null;
  let issuedKey: string | null = null;

  if (source === 'crypto_upgrade' && txId && coin) {
    const coinConfig = getCoinConfig(coin);
    if (!coinConfig) {
      verification = { status: 'needs_review', reason: `Unrecognized coin "${coin}" — verify manually.` };
    } else {
      try {
        const result = await verifyPayment(coinConfig.id as CoinId, txId.trim(), coinConfig.address, coinConfig.amount);
        verification = { status: result.status, reason: result.reason };

        if (result.status === 'verified') {
          const apiKey = await generateApiKey({ email, name: `Sovereign (${coinConfig.symbol} payment)`, plan: 'sovereign' });
          if (apiKey) {
            issuedKey = apiKey.key;
            const delivery = await sendKeyDeliveryEmail({
              to: email, apiKey: apiKey.key, plan: apiKey.plan, runsLimit: apiKey.runs_limit,
            });
            logger.info('leads.crypto_verify', 'payment verified, key issued', {
              email, coin: coinConfig.symbol, txId: txId.slice(0, 16), emailed: delivery.sent,
            });
          } else {
            verification = { status: 'needs_review', reason: 'Payment verified on-chain, but key generation failed — issue manually.' };
          }
        } else {
          logger.info('leads.crypto_verify', 'payment needs manual review', {
            email, coin: coinConfig.symbol, txId: txId.slice(0, 16), reason: result.reason,
          });
        }
      } catch (e) {
        verification = { status: 'needs_review', reason: `Verification threw an unexpected error: ${String(e).slice(0, 150)}` };
        logger.error('leads.crypto_verify', 'verification error', errorFields(e));
      }
    }
  }

  try {
    await c.execute({
      sql: `INSERT INTO leads (email, source, plan, tx_id, amount, coin, verification_status, verification_reason, issued_key, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              source = excluded.source,
              plan = excluded.plan,
              tx_id = COALESCE(excluded.tx_id, leads.tx_id),
              amount = COALESCE(excluded.amount, leads.amount),
              coin = COALESCE(excluded.coin, leads.coin),
              verification_status = COALESCE(excluded.verification_status, leads.verification_status),
              verification_reason = COALESCE(excluded.verification_reason, leads.verification_reason),
              issued_key = COALESCE(excluded.issued_key, leads.issued_key),
              verified_at = COALESCE(excluded.verified_at, leads.verified_at)`,
      args: [
        email, source, plan, txId ?? null, amount ?? null, coin ?? null,
        verification?.status ?? null, verification?.reason ?? null, issuedKey,
        verification?.status === 'verified' ? Math.floor(Date.now() / 1000) : null,
      ],
    });
    return NextResponse.json({ ok: true, verification });
  } catch (e) {
    logger.error('leads', 'insert failed', errorFields(e));
    return NextResponse.json({ error: 'storage error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const adminPassword = env.ADMIN_PASSWORD;
  const auth = req.headers.get('authorization');
  let authorized = false;
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password === adminPassword) authorized = true;
    } catch { /* malformed base64 */ }
  }
  if (!authorized) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Lex Aureon Admin"' },
    });
  }

  await ensureLeadsTable();

  try {
    const result = await getClient().execute(`
      SELECT id, email, source, plan, tx_id, amount, coin,
             verification_status, verification_reason, issued_key,
             datetime(created_at, 'unixepoch') as created_at
      FROM leads ORDER BY created_at DESC LIMIT 500
    `);
    const leads = result.rows.map(r => ({
      id: r[0], email: r[1], source: r[2], plan: r[3],
      tx_id: r[4], amount: r[5], coin: r[6],
      verification_status: r[7], verification_reason: r[8], issued_key: r[9],
      created_at: r[10],
    }));
    const needsReview = leads.filter(l => l.verification_status === 'needs_review').length;
    return NextResponse.json({ leads, total: leads.length, needs_review: needsReview });
  } catch (e) {
    logger.error('leads.get', 'query failed', errorFields(e));
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
