import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { env } from '@/lib/env';
import { logger, errorFields } from '@/lib/logger';

interface ProbeResult { ok: boolean; latency_ms: number; error?: string }

async function probe(name: string, fn: () => Promise<unknown>): Promise<ProbeResult> {
  const t = Date.now();
  try {
    await fn();
    return { ok: true, latency_ms: Date.now() - t };
  } catch (e) {
    const fields = errorFields(e);
    logger.warn(`health.${name}`, 'probe failed', fields);
    return { ok: false, latency_ms: Date.now() - t, error: String(fields.error ?? 'unknown') };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get('deep') === 'true';

  let turso: 'connected' | string = 'connected';
  const tursoStart = Date.now();
  try {
    await getClient().execute('SELECT 1');
  } catch (e) {
    turso = `error: ${(e as Error).message}`;
    logger.warn('health.turso', 'turso probe failed', errorFields(e));
  }
  const tursoLatency = Date.now() - tursoStart;

  let total_runs: number | null = null;
  try {
    const r = await getClient().execute(`SELECT value FROM run_stats WHERE key = 'total_runs'`);
    total_runs = (r.rows[0]?.value as number) ?? 0;
  } catch { /* table may not exist yet */ }

  let groqConfigured = false, jinaConfigured = false;
  try { groqConfigured = !!env.GROQ_API_KEY; } catch { /* missing */ }
  try { jinaConfigured = !!env.JINA_API_KEY; } catch { /* missing */ }

  const probes: Record<string, ProbeResult> | undefined = deep
    ? {
        turso: { ok: turso === 'connected', latency_ms: tursoLatency, ...(turso === 'connected' ? {} : { error: turso }) },
        groq: await probe('groq', async () => {
          if (!groqConfigured) throw new Error('not_configured');
          const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
            signal: AbortSignal.timeout(4000),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
        }),
        jina: await probe('jina', async () => {
          if (!jinaConfigured) throw new Error('not_configured');
          const r = await fetch('https://api.jina.ai/v1/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.JINA_API_KEY}` },
            body: JSON.stringify({ model: 'jina-embeddings-v3', input: ['ping'], dimensions: 32 }),
            signal: AbortSignal.timeout(4000),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
        }),
        kernel: await probe('kernel', async () => {
          const r = await fetch(`${env.NEXT_PUBLIC_SITE_URL}/api/lex/kernel`, {
            signal: AbortSignal.timeout(4000),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
        }),
      }
    : undefined;

  const allProbesOk = !probes || Object.values(probes).every((p) => p.ok);
  const ok = turso === 'connected' && allProbesOk;

  // fix: was reading process.env.GEMINI_API_KEY / process.env.MISTRAL_API_KEY
  // directly, bypassing the centralized env contract. MISTRAL_API_KEY is now
  // declared in lib/env.ts's EnvShape (it wasn't before — implicitly
  // supported here but undeclared everywhere else).
  let geminiConfigured = false, mistralConfigured = false, cerebrasConfigured = false;
  try { geminiConfigured   = !!env.GEMINI_API_KEY; } catch { /* missing */ }
  try { mistralConfigured  = !!env.MISTRAL_API_KEY; } catch { /* missing */ }
  // 2026-07-20: Cerebras joined the provider chain on 2026-07-10 (see
  // lib/llm_provider.ts) but was never added here.
  try { cerebrasConfigured = !!env.CEREBRAS_API_KEY; } catch { /* missing */ }

  // 2026-07-20: optional integrations that are otherwise invisible per
  // deployment — surface presence (never the value) so "did my env var take
  // effect in this deployment?" is a one-URL check. serper gates the async
  // governor's search grounding; auditor_secret gates real receipt signing
  // (unsigned without it — see lib/kernel_bridge.ts); resend gates ops-alert
  // and key-delivery email.
  let serperConfigured = false, auditorConfigured = false, resendConfigured = false;
  try { serperConfigured  = !!env.SERPER_API_KEY;  } catch { /* missing */ }
  try { auditorConfigured = !!env.AUDITOR_SECRET;  } catch { /* missing */ }
  try { resendConfigured  = !!env.RESEND_API_KEY;  } catch { /* missing */ }

  return NextResponse.json(
    {
      ok,
      status:    ok ? 'ok' : 'degraded',
      api:       ok ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      now:       new Date().toISOString(),
      services: {
        turso,
        groq:    groqConfigured  ? 'configured' : 'missing',
        jina:    jinaConfigured  ? 'configured' : 'missing',
        gemini:   geminiConfigured   ? 'configured' : 'missing',
        mistral:  mistralConfigured  ? 'configured' : 'missing',
        cerebras: cerebrasConfigured ? 'configured' : 'missing',
        // Optional integrations (presence only, never the value):
        serper:        serperConfigured   ? 'configured' : 'missing',
        auditor_secret: auditorConfigured ? 'configured' : 'missing',
        resend:        resendConfigured   ? 'configured' : 'missing',
      },
      storage: {
        mode:           turso === 'connected' ? 'turso' : 'error',
        stats_readable: total_runs !== null,
      },
      counters: { total_runs: total_runs ?? 0 },
      version:       'SovereignKernel-TS-v2+Memory+Metrics',
      kernel_active: true,
      constitution:  'C+R+S=1',
      ...(probes ? { probes } : {}),
      frontend_contract: {
        routes: {
          govern:        '/api/lex/govern',
          govern_stream: '/api/lex/govern/stream',
          validate:      '/api/lex/validate',
          stats:         '/api/stats',
          health:        '/api/health',
          // legacy (deprecated, proxied to /api/lex/govern)
          kernel:        '/api/lex/kernel',
          lex_run:       '/api/lex/run',
        },
        required_fields: ['raw_output', 'governed_output', 'M', 'health_band', 'state', 'receipt_id', 'projection_triggered'],
      },
    },
    { status: ok ? 200 : 503 },
  );
}
