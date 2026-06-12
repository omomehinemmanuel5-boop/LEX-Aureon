import { NextResponse } from 'next/server';

/**
 * Public, no-secrets endpoint. Tells the client only WHICH critical
 * services are unconfigured, not what their values are. Used to surface
 * a banner so users don't silently land on a demo-mode pipeline.
 */
export async function GET() {
  const missing: string[] = [];
  if (!process.env.GROQ_API_KEY)         missing.push('GROQ_API_KEY');
  if (!process.env.JINA_API_KEY)         missing.push('JINA_API_KEY');
  if (!process.env.TURSO_DATABASE_URL)   missing.push('TURSO_DATABASE_URL');
  if (!process.env.TURSO_AUTH_TOKEN)     missing.push('TURSO_AUTH_TOKEN');
  if (!process.env.ADMIN_PASSWORD)       missing.push('ADMIN_PASSWORD');
  if (!process.env.CRON_SECRET)          missing.push('CRON_SECRET');
  if (!process.env.NEXT_PUBLIC_SITE_URL) missing.push('NEXT_PUBLIC_SITE_URL');

  return NextResponse.json(
    {
      ok: missing.length === 0,
      missing,
      degraded: missing.length > 0,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    },
  );
}
