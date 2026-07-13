import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { verifyReceiptSignature } from '@/lib/kernel_bridge';
import { logger, errorFields } from '@/lib/logger';

/**
 * POST /api/audits/verify
 *
 * Recomputes the HMAC signature for a receipt from its OWN stored canonical
 * fields (server-side, using the server-only signing key) and compares it
 * against the signature stored on that row. This is the actual tamper-
 * evidence check — it answers "has this specific row been altered since Lex
 * Aureon wrote it", which the pre-existing plain receipt_hash column cannot
 * answer on its own (see lib/kernel_bridge.ts's computeReceiptSignature
 * docstring for why).
 *
 * Body: { receipt_id: string }
 *
 * Three distinct outcomes, not collapsed into a single true/false:
 *   - not_found        — no row with that receipt_id exists
 *   - unsigned          — row predates the signature column (written before
 *                         this fix shipped); nothing to verify against
 *   - valid / tampered  — the actual verification result
 *
 * Collapsing "not_found" or "unsigned" into "invalid" would be misleading —
 * a receipt written before signing existed is not evidence of tampering,
 * and neither is a typo'd receipt_id. Each gets its own explicit status so
 * a caller (human or automated) can't misread "we don't have data" as
 * "this was tampered with".
 */
export async function POST(req: Request) {
  let body: { receipt_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const receiptId = typeof body.receipt_id === 'string' ? body.receipt_id.trim() : '';
  if (!receiptId) {
    return NextResponse.json({ ok: false, error: 'receipt_id is required' }, { status: 400 });
  }

  try {
    await initSchema();
    const r = await getClient().execute({
      sql: `SELECT receipt_id, session_id, m_after, health_band, governor_mode,
                   input_hash, output_hash, receipt_hash, signature, created_at,
                   c_after, r_after, s_after
            FROM praxis_receipts
            WHERE receipt_id = ?
            LIMIT 1`,
      args: [receiptId],
    });

    if (r.rows.length === 0) {
      return NextResponse.json({ ok: true, status: 'not_found', receipt_id: receiptId });
    }

    const row = r.rows[0];
    const signature = row.signature as string | null;

    if (!signature) {
      return NextResponse.json({
        ok: true,
        status: 'unsigned',
        receipt_id: receiptId,
        note: 'This receipt was written before cryptographic signing was enabled and cannot be verified against a signature. It may still be legitimate — absence of a signature is not evidence of tampering, only of age.',
      });
    }

    if (row.c_after === null || row.r_after === null || row.s_after === null) {
      return NextResponse.json({
        ok: true,
        status: 'unsigned',
        receipt_id: receiptId,
        note: 'This receipt predates the c_after/r_after/s_after columns and cannot be verified — the full state its signature was computed over is not recoverable from this row.',
      });
    }

    // health_band column may be null on older rows (see db.ts migration note);
    // fall back to deriving it from governor_mode ("kernel-optimal" -> "OPTIMAL")
    // for the purpose of signature verification, matching how it was originally
    // signed in kernel_bridge.ts at write time.
    const healthBand = (row.health_band as string | null)
      ?? (row.governor_mode as string).replace(/^kernel-/, '').toUpperCase();

    const valid = verifyReceiptSignature(
      {
        receiptId: row.receipt_id as string,
        sessionId: row.session_id as string,
        state: { C: row.c_after as number, R: row.r_after as number, S: row.s_after as number },
        M: row.m_after as number,
        healthBand,
        inputHash: (row.input_hash as string) ?? '',
        outputHash: (row.output_hash as string) ?? '',
        receiptHash: (row.receipt_hash as string) ?? '',
        createdAt: row.created_at as string,
      },
      signature,
    );

    return NextResponse.json({
      ok: true,
      status: valid ? 'valid' : 'tampered',
      receipt_id: receiptId,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn('audits.verify', 'verification query failed', errorFields(e));
    return NextResponse.json({ ok: false, error: 'verification unavailable' }, { status: 503 });
  }
}
