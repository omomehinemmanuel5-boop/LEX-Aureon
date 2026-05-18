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

  // Basic probe: is Turso reachable?
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
  } catch {
    /* table may not exist yet — leave null */
  }

  // Configuration checks: env accessors throw on missing required keys.
  // Wrap each so /api/health itself never 500s on missing config.
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
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${env.JINA_API_KEY}`,
            },
            body: JSON.stringify({ model: 'jina-embeddings-v3', input: ['ping'], dimensions: 32 }),
            signal: AbortSignal.timeout(4000),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
        }),
      }
    : undefined;

  const allProbesOk = !probes || Object.values(probes).every((p) => p.ok);
  const ok = turso === 'connected' && allProbesOk;
  const status = ok ? 200 : 503;

  return NextResponse.json(
    {
      ok,
      status: ok ? 'ok' : 'degraded',
      api: ok ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      now: new Date().toISOString(),
      services: {
        turso,
        groq: groqConfigured ? 'configured' : 'missing',
        jina: jinaConfigured ? 'configured' : 'missing',
      },
      storage: {
        mode: turso === 'connected' ? 'turso' : 'error',
        stats_readable: total_runs !== null,
      },
      counters: { total_runs: total_runs ?? 0 },
      version: 'PRAXIS v1.0',
      constitution: 'C+R+S=1',
      ...(probes ? { probes } : {}),
      frontend_contract: {
        routes: {
          lex_run: '/api/lex/run',
          stats: '/api/stats',
          health: '/api/health',
        },
        required_fields: ['raw_output', 'governed_output', 'metrics', 'intervention', 'audit_id'],
      },
    },
    { status },
  );
}
