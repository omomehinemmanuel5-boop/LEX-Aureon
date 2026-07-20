/**
 * lib/notify.ts
 *
 * Customer notification for the Sovereign key delivery flow.
 *
 * HONEST STATE: there is no email-sending provider configured anywhere in this
 * project (checked: no SendGrid/Resend/SMTP/Nodemailer integration exists).
 * Building a real email integration requires an API key from a provider —
 * something only the account owner can obtain (a free-tier signup, e.g.
 * Resend.com or SendGrid, takes a few minutes and gives an API key instantly).
 *
 * Rather than fake an email that silently never sends, this function is an
 * explicit, logged no-op until RESEND_API_KEY (or another provider) is
 * configured. The issued key is ALWAYS also stored directly on the lead row
 * (see app/api/leads/route.ts), visible via the authenticated admin view, so
 * nothing is lost if email isn't wired up yet — it just requires the account
 * owner to manually copy/forward the key until this is connected.
 *
 * TO ACTUALLY SEND EMAIL: sign up for a free Resend account, add
 * RESEND_API_KEY to Vercel env vars, and uncomment the fetch call below. No
 * other code changes needed — this is the one integration point.
 */

import { logger } from './logger';
import { env } from './env';

// ── Ops alerts (2026-07-20) ──────────────────────────────────────────────────
// Failures that violate a core guarantee (receipt not persisted, synthetic
// canary failing) must reach a human, not just the log stream. Sent to the
// owner via the same Resend integration as key delivery; per-topic throttle
// so an incident burst (e.g. the 2026-07-14 window with 1,802 receipt-write
// failures) produces ONE email per topic per window, not thousands.
// Alerts also reach the log drain via logger.error regardless of email
// configuration.

const OPS_ALERT_TO = env.OPS_ALERT_EMAIL || 'omomehinemmanuel5@gmail.com';
const OPS_ALERT_THROTTLE_MS = 15 * 60 * 1000; // one email per topic per 15 min per instance
const lastAlertAt = new Map<string, number>();

export async function sendOpsAlert(topic: string, subject: string, body: string): Promise<void> {
  // Always hits the structured log (and the log drain when configured),
  // even when email is throttled or unconfigured.
  logger.error(`ops_alert.${topic}`, subject, { body: body.slice(0, 500) });

  const now = Date.now();
  const last = lastAlertAt.get(topic) ?? 0;
  if (now - last < OPS_ALERT_THROTTLE_MS) return;
  lastAlertAt.set(topic, now);

  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) return; // logged above; email needs RESEND_API_KEY

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Lex Aureon Ops <noreply@lexaureon.com>',
        to: OPS_ALERT_TO,
        subject: `[lexaureon ops] ${subject}`,
        text: body,
      }),
    });
  } catch (e) {
    logger.error('ops_alert.send', 'ops alert email failed', { error: String(e).slice(0, 200) });
  }
}

export interface KeyDeliveryEmail {
  to: string;
  apiKey: string;
  plan: string;
  runsLimit: number;
}

export async function sendKeyDeliveryEmail(params: KeyDeliveryEmail): Promise<{ sent: boolean; reason: string }> {
  const resendKey = env.RESEND_API_KEY;

  if (!resendKey) {
    logger.info('notify.key_delivery', 'email provider not configured — key stored on lead row only, needs manual delivery', {
      to: params.to, plan: params.plan,
    });
    return { sent: false, reason: 'No email provider configured (RESEND_API_KEY unset) — key saved to leads table for manual delivery.' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Lex Aureon <noreply@lexaureon.com>',
        to: params.to,
        subject: 'Your Lex Aureon Sovereign API Key',
        text: `Your payment has been verified on-chain. Your Sovereign API key:\n\n${params.apiKey}\n\nPlan: ${params.plan} (${params.runsLimit} runs)\n\nStore this key safely — it won't be shown again. See https://www.lexaureon.com/api-docs for usage.`,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('notify.key_delivery', 'Resend API error', { status: res.status, body: text.slice(0, 200) });
      return { sent: false, reason: `Email provider error (HTTP ${res.status}) — key still saved to leads table.` };
    }
    return { sent: true, reason: 'Sent via Resend.' };
  } catch (e) {
    logger.error('notify.key_delivery', 'email send failed', { error: String(e).slice(0, 200) });
    return { sent: false, reason: 'Email send failed — key still saved to leads table.' };
  }
}
