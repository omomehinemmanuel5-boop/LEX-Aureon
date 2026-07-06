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

export interface KeyDeliveryEmail {
  to: string;
  apiKey: string;
  plan: string;
  runsLimit: number;
}

export async function sendKeyDeliveryEmail(params: KeyDeliveryEmail): Promise<{ sent: boolean; reason: string }> {
  const resendKey = process.env.RESEND_API_KEY;

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
