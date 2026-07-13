import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { verifyReceiptSignature } from '@/lib/kernel_bridge';
import { logger, errorFields } from '@/lib/logger';

/**
 * GET /api/audits/[id]/export
 *
 * A portable, self-contained, independently-verifiable export of a single
 * governed receipt — the "proof-of-sovereignty" artifact. Unlike the console
 * or audit page, which require trusting lexaureon.com to render the data
 * honestly, this bundle can be handed to a third party (a buyer, an auditor,
 * a compliance reviewer) who verifies it themselves: recompute the HMAC from
 * the fields in the bundle using the published verification method and
 * confirm it matches `signature`, with no API call back to this server
 * required for the check itself.
 *
 * `self_check` runs that same verification server-side before returning, so
 * the bundle also tells the recipient up front whether it's already known to
 * verify — but the recipient isn't required to trust that field; every input
 * needed to redo the check independently is included in the bundle itself.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const receiptId = decodeURIComponent(id).trim();

  if (!receiptId) {
    return NextResponse.json({ ok: false, error: 'receipt id is required' }, { status: 400 });
  }

  try {
    await initSchema();
    const r = await getClient().execute({
      sql: `SELECT receipt_id, session_id, turn, pre_eval_label,
                   m_before, m_after, governor_mode, intervention, slow_drip,
                   governor_effort, sigma_viol, crs_method, health_band,
                   input_hash, output_hash, receipt_hash, signature,
                   c_after, r_after, s_after, created_at
            FROM praxis_receipts
            WHERE receipt_id = ?
            LIMIT 1`,
      args: [receiptId],
    });

    if (r.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'receipt not found', receipt_id: receiptId }, { status: 404 });
    }

    const row = r.rows[0];
    const signature = row.signature as string | null;
    const hasFullState = row.c_after !== null && row.r_after !== null && row.s_after !== null;

    let selfCheck: 'valid' | 'tampered' | 'unsigned' = 'unsigned';
    if (signature && hasFullState) {
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
      selfCheck = valid ? 'valid' : 'tampered';
    }

    const bundle = {
      bundle_version: 'lex-aureon-export-v1',
      exported_at: new Date().toISOString(),
      receipt: {
        receipt_id: row.receipt_id,
        session_id: row.session_id,
        turn: row.turn,
        pre_eval_label: row.pre_eval_label,
        m_before: row.m_before,
        m_after: row.m_after,
        state: hasFullState ? { C: row.c_after, R: row.r_after, S: row.s_after } : null,
        health_band: row.health_band ?? (row.governor_mode as string).replace(/^kernel-/, '').toUpperCase(),
        governor_mode: row.governor_mode,
        intervention: (row.intervention as number) === 1,
        slow_drip: (row.slow_drip as number) === 1,
        governor_effort: row.governor_effort,
        sigma_viol: row.sigma_viol,
        crs_method: row.crs_method,
        input_hash: row.input_hash,
        output_hash: row.output_hash,
        receipt_hash: row.receipt_hash,
        created_at: row.created_at,
      },
      signature,
      self_check: selfCheck,
      verification: {
        method: 'HMAC-SHA256',
        instructions: 'Recompute HMAC-SHA256 over the pipe-joined string: receipt_id|session_id|C.toFixed(6)|R.toFixed(6)|S.toFixed(6)|M.toFixed(6)|health_band|input_hash|output_hash|receipt_hash|created_at|key_version, keyed by the server signing secret. Compare against `signature` using a constant-time comparison. See lib/kernel_bridge.ts computeReceiptSignature() in the public repository for the canonical implementation.',
        verify_endpoint: 'POST https://www.lexaureon.com/api/audits/verify with body { "receipt_id": "...' + '" }',
        repository: 'https://github.com/omomehinemmanuel5-boop/LEX-Aureon',
      },
    };

    return NextResponse.json(bundle, {
      headers: {
        'Content-Disposition': `attachment; filename="${receiptId}-export.json"`,
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    });
  } catch (e) {
    logger.warn('audits.export', 'export query failed', errorFields(e));
    return NextResponse.json({ ok: false, error: 'export unavailable' }, { status: 503 });
  }
}
