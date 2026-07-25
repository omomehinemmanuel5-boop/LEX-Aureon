/**
 * GET /api/admin/test-alert
 *
 * Fires a dummy ops alert through the REAL delivery path (lib/notify.ts
 * sendOpsAlert → Resend + structured log/log drain) so email delivery can be
 * positively confirmed without waiting for a genuine incident — the ops-alert
 * wiring added 2026-07-20 (receipt-write failure, receipt-signing failure,
 * synthetic canary failure) otherwise only proves itself when something is
 * actually wrong.
 *
 * Admin-gated with the same Basic-auth pattern as /api/debug: any username,
 * ADMIN_PASSWORD as the password. Browser-friendly:
 *   https://www.lexaureon.com/api/admin/test-alert  (enter password when prompted)
 *
 * Bypasses the per-topic throttle (this is the one caller where repeat sends
 * are the point) and returns the actual delivery result, including the
 * recipient and whether Resend accepted the email.
 */
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { sendOpsAlert, OPS_ALERT_TO } from '@/lib/notify';

function unauthorized(): NextResponse {
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Lex Aureon Admin"' },
  });
}

export async function GET(req: Request) {
  const adminPassword = env.ADMIN_PASSWORD;
  const auth = req.headers.get('authorization');

  let presented: string | null = null;
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const colonIdx = decoded.indexOf(':');
      presented = decoded.slice(colonIdx + 1);
    } catch { /* malformed base64 */ }
  }

  if (!presented || presented !== adminPassword) {
    return unauthorized();
  }

  const firedAt = new Date().toISOString();
  const result = await sendOpsAlert(
    'test_alert',
    'Test alert — delivery confirmation',
    `This is a manually triggered TEST alert from GET /api/admin/test-alert at ${firedAt}.\n\n` +
    `If you are reading this in your inbox, the ops-alert email path (Resend) is working. ` +
    `Real alerts fire on: receipt-write failure, receipt-signing failure, and synthetic canary failure ` +
    `— throttled to one email per topic per 15 minutes.\n\nNo action needed.`,
    { bypassThrottle: true },
  );

  return NextResponse.json({
    ok: true,
    fired_at: firedAt,
    recipient: OPS_ALERT_TO,
    resend_configured: !!env.RESEND_API_KEY,
    ...result,
  });
}
