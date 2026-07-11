/**
 * GET /api/cron/self-reflect
 *
 * Recurring self-reflection over the agent's own tool-call history — see
 * lib/self_reflection.ts for the actual computation. Runs daily, offset from
 * the existing synthetic-probe cron (noon UTC) to spread cron load.
 *
 * A run with no new tool_receipts since the last reflection is a valid,
 * honest outcome (ok:true, reflected:false) — not treated as a failure.
 */

import { NextResponse } from 'next/server';
import { runSelfReflection } from '@/lib/self_reflection';
import { logger, errorFields } from '@/lib/logger';
import { env } from '@/lib/env';

export const maxDuration = 30;

export async function GET(req: Request) {
  const cronSecret = env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') !== null;
  if (!isVercelCron && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSelfReflection();
    if (!result) {
      logger.info('cron.self-reflect', 'no new tool_receipts since last reflection');
      return NextResponse.json({ ok: true, reflected: false, now: new Date().toISOString() });
    }
    logger.info('cron.self-reflect', 'reflection recorded', {
      total_calls: result.total_calls, denial_rate_pct: result.denial_rate_pct,
    });
    return NextResponse.json({ ok: true, reflected: true, result, now: new Date().toISOString() });
  } catch (e) {
    logger.error('cron.self-reflect', 'reflection failed', errorFields(e));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
