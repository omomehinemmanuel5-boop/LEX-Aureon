import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { verifyReceiptSignature } from '@/lib/kernel_bridge';
import { logger, errorFields } from '@/lib/logger';

/**
 * GET /api/audits/[id]/export
 *
 * A portable, canonical export of a single governed receipt. Unlike a printed
 * audit page, the bundle preserves the exact fields used by the signature and
 * records the signing-key provenance needed for a repeatable review.
 *
 * HMAC verification necessarily requires the server-held signing secret, so a
 * recipient should use the verification endpoint rather than treating an HMAC
 * bundle as public-key-verifiable evidence. `self_check` is informative only;
 * it is deliberately accompanied by the persisted key version and never
 * upgrades legacy fallback-signed rows into cryptographic proof.
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
                   input_hash, output_hash, receipt_hash, signature, signing_key_version,
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

    const signingKeyVersion = (row.signing_key_version as string | null) ?? 'unsigned';
    let selfCheck: 'valid' | 'tampered' | 'unsigned' | 'legacy_insecure' = 'unsigned';
    if (signingKeyVersion === 'v1-fallback') selfCheck = 'legacy_insecure';
    if (signingKeyVersion === 'v1' && signature && hasFullState) {
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
        signing_key_version: signingKeyVersion,
        created_at: row.created_at,
      },
      signature,
      self_check: selfCheck,
      verification: {
        method: 'HMAC-SHA256',
        canonical_fields: ['receipt_id', 'session_id', 'state.C', 'state.R', 'state.S', 'm_after', 'health_band', 'input_hash', 'output_hash', 'receipt_hash', 'created_at', 'signing_key_version'],
        instructions: 'The server computes HMAC-SHA256 over the pipe-joined canonical fields, with C/R/S/M formatted to six decimal places. Because the signing secret is intentionally not exported, verify the saved receipt id against the authoritative endpoint. A v1-fallback signature is historical metadata only and is not cryptographic proof.',
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
