import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { verifyReceiptSignature } from '@/lib/kernel_bridge';
import { logger, errorFields } from '@/lib/logger';

const GOLD = '#c9a84c';
const GREEN = '#10b981';
const RED = '#ef4444';
const SLATE = '#94a3b8';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badgeSvg(opts: { receiptId: string; status: 'valid' | 'tampered' | 'unsigned' | 'not_found'; m?: number; healthBand?: string }): string {
  const { receiptId, status, m, healthBand } = opts;
  const statusColor = status === 'valid' ? GREEN : status === 'tampered' ? RED : SLATE;
  const statusLabel = status === 'valid' ? 'VERIFIED'
    : status === 'tampered' ? 'SIGNATURE MISMATCH'
    : status === 'not_found' ? 'NOT FOUND'
    : 'UNSIGNED';
  const mLine = typeof m === 'number' ? `M = ${m.toFixed(3)}` : '';
  const bandLine = healthBand ?? '';

  // Deliberately plain, high-contrast SVG (no external fonts/assets) so it
  // renders identically wherever it's embedded — a README, a slide, an
  // og:image — without depending on this domain being reachable at render
  // time for anything other than the initial fetch.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120">
  <rect width="360" height="120" rx="10" fill="#07070d" stroke="${statusColor}" stroke-width="2"/>
  <text x="18" y="28" font-family="monospace" font-size="11" font-weight="bold" fill="${GOLD}" letter-spacing="1">LEX AUREON · CONSTITUTIONAL RECEIPT</text>
  <text x="18" y="50" font-family="monospace" font-size="10" fill="${SLATE}">${escapeXml(receiptId)}</text>
  <circle cx="28" cy="78" r="6" fill="${statusColor}"/>
  <text x="42" y="82" font-family="monospace" font-size="13" font-weight="bold" fill="${statusColor}">${statusLabel}</text>
  <text x="18" y="104" font-family="monospace" font-size="10" fill="${SLATE}">${escapeXml(mLine)}${mLine && bandLine ? '  ·  ' : ''}${escapeXml(bandLine)}</text>
  <text x="342" y="104" font-family="monospace" font-size="8" fill="${SLATE}" text-anchor="end">lexaureon.com</text>
</svg>`;
}

/**
 * GET /api/audits/[id]/badge
 *
 * SVG "proof-of-sovereignty" badge for a single receipt — the shareable,
 * embeddable visual counterpart to /export (the machine-verifiable JSON
 * bundle). Runs the same signature verification server-side and renders the
 * real result (VERIFIED / SIGNATURE MISMATCH / UNSIGNED / NOT FOUND) rather
 * than a static "governed" graphic — a badge that can only ever say
 * "verified" regardless of what actually happened would be decoration, not
 * proof.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const receiptId = decodeURIComponent(id).trim();
  const svgHeaders = { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' };

  if (!receiptId) {
    return new NextResponse(badgeSvg({ receiptId: '(missing id)', status: 'not_found' }), { headers: svgHeaders, status: 400 });
  }

  try {
    await initSchema();
    const r = await getClient().execute({
      sql: `SELECT receipt_id, session_id, m_after, health_band, governor_mode,
                   input_hash, output_hash, receipt_hash, signature,
                   c_after, r_after, s_after, created_at
            FROM praxis_receipts
            WHERE receipt_id = ?
            LIMIT 1`,
      args: [receiptId],
    });

    if (r.rows.length === 0) {
      return new NextResponse(badgeSvg({ receiptId, status: 'not_found' }), { headers: svgHeaders, status: 404 });
    }

    const row = r.rows[0];
    const signature = row.signature as string | null;
    const hasFullState = row.c_after !== null && row.r_after !== null && row.s_after !== null;
    const healthBand = (row.health_band as string | null)
      ?? (row.governor_mode as string).replace(/^kernel-/, '').toUpperCase();

    let status: 'valid' | 'tampered' | 'unsigned' = 'unsigned';
    if (signature && hasFullState) {
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
      status = valid ? 'valid' : 'tampered';
    }

    return new NextResponse(
      badgeSvg({ receiptId, status, m: row.m_after as number, healthBand }),
      { headers: svgHeaders },
    );
  } catch (e) {
    logger.warn('audits.badge', 'badge query failed', errorFields(e));
    return new NextResponse(badgeSvg({ receiptId, status: 'unsigned' }), { headers: svgHeaders, status: 503 });
  }
}
