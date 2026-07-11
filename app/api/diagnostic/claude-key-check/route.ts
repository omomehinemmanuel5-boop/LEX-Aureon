/**
 * GET /api/diagnostic/claude-key-check
 *
 * TEMPORARY, one-off diagnostic (2026-07-11) — checking whether the
 * Claude_api_key env var (present in Vercel, referenced nowhere in the
 * codebase as of this writing) is a real, working Anthropic API key, or a
 * stale/invalid leftover. Directly relevant to the agency-frontier project's
 * P1 blocker: no frontier-model baseline is currently wired in.
 *
 * Deliberately never logs, returns, or otherwise exposes the key value
 * itself — only whether the call succeeded and, if so, which model
 * responded. Safe to leave in briefly for this one check; should be removed
 * once the finding is confirmed either way (not meant as permanent
 * infrastructure).
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.Claude_api_key;
  if (!key) {
    return NextResponse.json({ ok: false, present: false, error: 'env var not set' });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json() as {
      model?: string;
      content?: Array<{ text?: string }>;
      error?: { type?: string; message?: string };
    };

    if (!res.ok) {
      return NextResponse.json({
        ok: false, present: true, http_status: res.status,
        error_type: data.error?.type ?? 'unknown',
        error_message: (data.error?.message ?? '').slice(0, 200),
      });
    }

    return NextResponse.json({
      ok: true, present: true, http_status: res.status,
      model_responded: data.model ?? 'unknown',
      reply: data.content?.[0]?.text ?? '',
    });
  } catch (e) {
    return NextResponse.json({ ok: false, present: true, error: String(e).slice(0, 200) });
  }
}
