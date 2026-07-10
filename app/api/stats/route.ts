import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';

// fix (2026-07-10, take two) — `export const revalidate = 300` alone did NOT
// produce cache HITs on Vercel's edge for this route: five requests over 10s
// all showed x-vercel-cache: MISS, and the response's own Cache-Control
// header read "public, max-age=0, must-revalidate" — which explicitly tells
// any HTTP cache, including Vercel's edge, NOT to store the response. The
// `revalidate` route-segment export does not reliably translate into edge
// caching for a Route Handler doing live async I/O the way it does for
// static-generatable pages. Switched to an explicit Cache-Control response
// header (the standard, verifiable mechanism for CDN caching on Vercel) —
// s-maxage governs the shared/edge cache, stale-while-revalidate lets a
// stale response serve instantly while a fresh one regenerates in the
// background, so visitors never see a slow path even at the cache boundary.
async function ensureTable() {
  const c = getClient();
  await c.execute(`
    CREATE TABLE IF NOT EXISTS run_stats (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    )
  `);
  await c.execute(`INSERT OR IGNORE INTO run_stats (key, value) VALUES ('total_runs', 0)`);
}

const HEAVY_SESSIONS = `
  SELECT session_id FROM praxis_receipts GROUP BY session_id HAVING COUNT(*) > 80
`;
const REAL_ONLY = `
  session_id NOT LIKE 'lexbench-%'
  AND session_id NOT LIKE 'synthetic_%'
  AND session_id NOT LIKE 'bench-%'
  AND session_id NOT LIKE 'jbb_%'
  AND session_id NOT LIKE 'adv_%'
  AND session_id NOT LIKE 'hb_%'
  AND session_id NOT IN (${HEAVY_SESSIONS})
`;

export async function GET() {
  await ensureTable();
  const c = getClient();

  const [
    runsResult,
    receiptsAllResult,
    receiptsRealResult,
    memoryResult,
    cacheResult,
    interventionResult,
  ] = await Promise.all([
    c.execute(`SELECT value FROM run_stats WHERE key = 'total_runs'`),
    c.execute(`SELECT COUNT(*) as cnt FROM praxis_receipts`).catch(() => null),
    c.execute(`SELECT COUNT(*) as cnt FROM praxis_receipts WHERE ${REAL_ONLY}`).catch(() => null),
    c.execute(`SELECT COUNT(*) as cnt FROM lex_memory`).catch(() => null),
    c.execute(`
      SELECT COUNT(*) as entries, COALESCE(SUM(hits), 0) as total_hits
      FROM embedding_cache
    `).catch(() => null),
    c.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN intervention = 1 THEN 1 ELSE 0 END) as interventions,
        ROUND(AVG(m_after), 4) as avg_m,
        ROUND(MIN(m_after), 4) as min_m
      FROM praxis_receipts
      WHERE ${REAL_ONLY}
    `).catch(() => null),
  ]);

  const total_runs                  = (runsResult.rows[0]?.value as number) ?? 0;
  const total_receipts_including_eval = Number(receiptsAllResult?.rows[0]?.cnt ?? 0);
  const total_receipts              = Number(receiptsRealResult?.rows[0]?.cnt ?? total_receipts_including_eval);
  const eval_receipts               = Math.max(0, total_receipts_including_eval - total_receipts);
  const memory_events               = Number(memoryResult?.rows[0]?.cnt ?? 0);

  const cacheRow        = cacheResult?.rows[0];
  const cache_entries   = Number(cacheRow?.entries ?? 0);
  const cache_total_hits = Number(cacheRow?.total_hits ?? 0);
  const cache_hit_rate = cache_entries + cache_total_hits > 0
    ? Math.round((cache_total_hits / (cache_entries + cache_total_hits)) * 10000) / 100
    : 0;

  const ivRow             = interventionResult?.rows[0];
  const governed_turns    = Number(ivRow?.total ?? 0);
  const intervention_count = Number(ivRow?.interventions ?? 0);
  const intervention_rate = governed_turns > 0
    ? Math.round((intervention_count / governed_turns) * 10000) / 100
    : 0;
  const avg_m = Number(ivRow?.avg_m ?? 0);
  const min_m = Number(ivRow?.min_m ?? 0);

  return NextResponse.json({
    total_runs,
    runs: total_runs,
    total_receipts,
    total_receipts_including_eval,
    eval_receipts,
    memory_events,
    governed_turns,
    intervention_count,
    intervention_rate_pct: intervention_rate,
    avg_stability_margin: avg_m,
    min_stability_margin: min_m,
    embedding_cache: {
      entries:    cache_entries,
      total_hits: cache_total_hits,
      hit_rate_pct: cache_hit_rate,
    },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' },
  });
}

export async function POST() {
  await ensureTable();
  const result = await getClient().execute(`
    UPDATE run_stats SET value = value + 1 WHERE key = 'total_runs' RETURNING value
  `);
  const total_runs = (result.rows[0]?.value as number) ?? 0;
  return NextResponse.json({ total_runs, runs: total_runs });
}
