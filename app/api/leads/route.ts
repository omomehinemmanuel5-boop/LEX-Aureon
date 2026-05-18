import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getClient } from '@/lib/db';
import { env } from '@/lib/env';
import { logger, errorFields } from '@/lib/logger';

const LeadSchema = z.object({
  email:  z.string().email().max(254),
  source: z.string().max(64).optional(),
  plan:   z.string().max(64).optional(),
  txId:   z.string().max(128).optional(),
  amount: z.string().max(64).optional(),
  coin:   z.string().max(32).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, source = 'console', plan = 'explorer', txId, amount, coin } = parsed.data;

  try {
    const c = getClient();
    await c.execute({
      sql: `CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        source TEXT DEFAULT 'console',
        plan TEXT DEFAULT 'explorer',
        tx_id TEXT,
        amount TEXT,
        coin TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      args: [],
    });
    await c.execute({
      sql: `INSERT INTO leads (email, source, plan, tx_id, amount, coin)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              source = excluded.source,
              plan = excluded.plan,
              tx_id = COALESCE(excluded.tx_id, leads.tx_id),
              amount = COALESCE(excluded.amount, leads.amount),
              coin = COALESCE(excluded.coin, leads.coin)`,
      args: [email, source, plan, txId ?? null, amount ?? null, coin ?? null],
    });

    return NextResponse.json({ ok: true });
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

  try {
    const result = await getClient().execute({
      sql: `SELECT id, email, source, plan, tx_id, amount, coin,
                   datetime(created_at, 'unixepoch') as created_at
            FROM leads ORDER BY created_at DESC LIMIT 500`,
      args: [],
    });

    const leads = result.rows.map(r => ({
      id: r[0], email: r[1], source: r[2], plan: r[3],
      tx_id: r[4], amount: r[5], coin: r[6], created_at: r[7],
    }));

    return NextResponse.json({ leads, total: leads.length });
  } catch (e) {
    logger.error('leads.get', 'query failed', errorFields(e));
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
