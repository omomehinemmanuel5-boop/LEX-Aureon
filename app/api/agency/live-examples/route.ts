/**
 * GET /api/agency/live-examples
 *
 * Real examples for the agent tool-call governance section — replaces what
 * was previously a hardcoded array of example receipts in
 * components/EnterpriseSection.tsx, labeled "Example results from production
 * runs" without actually being production data. Now genuinely reads from
 * tool_receipts: one real example per distinct decision category, most
 * recent first, plus the latest self-reflection summary.
 *
 * Honest empty state: if a decision category has never fired, it's simply
 * absent from the response — the frontend does not fabricate a placeholder
 * for it. If tool_receipts is entirely empty, examples is an empty array and
 * the section renders its own honest "not yet run" state.
 */

import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { getSelfReflectionHistory } from '@/lib/self_reflection';

const DECISION_CATEGORIES = [
  'APPROVED', 'APPROVED_MEDIUM', 'APPROVED_HIGH',
  'DENIED_INJECTION', 'DENIED_BLOCKED', 'DENIED_LOCKED',
];

export async function GET() {
  try {
    const db = getClient();

    const examples = await Promise.all(
      DECISION_CATEGORIES.map(async (decision) => {
        const res = await db.execute({
          sql: `SELECT receipt_id, tool_name, decision, c_score, r_score, s_score, m_score,
                       risk_level, sigma_viol, reason, created_at
                FROM tool_receipts
                WHERE decision = ?
                ORDER BY created_at DESC
                LIMIT 1`,
          args: [decision],
        });
        if (!res.rows.length) return null;
        const r = res.rows[0];
        return {
          decision:   String(r.decision),
          tool_name:  String(r.tool_name),
          receipt_id: String(r.receipt_id),
          c: Number(r.c_score), r: Number(r.r_score), s: Number(r.s_score), m: Number(r.m_score),
          risk_level: String(r.risk_level),
          sigma_viol: Number(r.sigma_viol),
          // reason is a real audit string but may contain internal detail
          // (regex source, similarity scores) -- truncated for display, full
          // text remains queryable via the public /audit trail by receipt id.
          reason: String(r.reason).slice(0, 140),
          created_at: String(r.created_at),
        };
      })
    );

    const reflections = await getSelfReflectionHistory(1);
    const latest = reflections[0] ?? null;

    return NextResponse.json({
      ok: true,
      examples: examples.filter((e): e is NonNullable<typeof e> => e !== null),
      latest_reflection: latest,
      fetched_at: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60' } });
  } catch (e) {
    return NextResponse.json({ ok: false, examples: [], latest_reflection: null, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
