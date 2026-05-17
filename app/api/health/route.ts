import { NextResponse } from 'next/server';
import { getClient, getTotalRuns } from '@/lib/db';
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

  const db = getClient();
  let runs = 0;
  let statsReadable = true;
  try {
    runs = await getTotalRuns();
  } catch (e) {
    statsReadable = false;
    logger.warn('health.stats', 'getTotalRuns failed', errorFields(e));
  }

  const probes: Record<string, ProbeResult> | undefined = deep
    ? {
        turso: await probe('turso', async () => {
          const c = getClient();
          if (!c) throw new Error('not_configured');
          await c.execute('SELECT 1');
        }),
        groq: await probe('groq', async () => {
          if (!process.env.GROQ_API_KEY) throw new Error('not_configured');
          const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            signal: AbortSignal.timeout(4000),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
        }),
        jina: await probe('jina', async () => {
          if (!process.env.JINA_API_KEY) throw new Error('not_configured');
          const r = await fetch('https://api.jina.ai/v1/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.JINA_API_KEY}`,
            },
            body: JSON.stringify({ model: 'jina-embeddings-v3', input: ['ping'], dimensions: 32 }),
            signal: AbortSignal.timeout(4000),
          });
          if (!r.ok) throw new Error(`http_${r.status}`);
        }),
      }
    : undefined;

  const allOk = !probes || Object.values(probes).every((p) => p.ok);
  const status = statsReadable && allOk ? 200 : 503;

  return NextResponse.json(
    {
      ok: statsReadable && allOk,
      api: statsReadable && allOk ? 'healthy' : 'degraded',
      now: new Date().toISOString(),
      storage: {
        mode: db ? 'turso' : 'memory',
        stats_readable: statsReadable,
      },
      counters: {
        total_runs: runs,
      },
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
