import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';

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

// Synthetic evaluation traffic (benchmark / eval harnesses) is excluded from the
// public "real governance" counts, so the canonical receipt total the site shows
// reflects genuine usage rather than self-generated eval load. Real console/chat
// sessions use the `session-<ms>-<rand>` format, which none of these prefixes
// match — so NO real traffic is dropped by this filter.
//
// LIMITATION (honest): benchmark runs BEFORE the 2026-07 session tagging used the
// same `session-<ms>` format as the console and therefore cannot be separated by
// prefix. Those historical eval receipts remain counted; they surface in the
// `*_including_eval` fields and age out of relevance as real traffic accrues. A
// stricter heuristic (exclude sessions with an abnormally high turn count) could
// remove them but risks dropping legitimate long sessions, so it is intentionally
// not applied here.
const REAL_ONLY = `
  session_id NOT LIKE 'lexbench-%'
  AND session_id NOT LIKE 'synthetic_%'
  AND session_id NOT LIKE 'bench-%'
  AND session_id NOT LIKE 'jbb_%'
  AND session_id NOT LIKE 'adv_%'
  AND session_id NOT LIKE 'hb_%'
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
    // Cache hit-rate: sum(hits) / count(*) gives avg hits per entry
    c.execute(`
      SELECT COUNT(*) as entries, COALESCE(SUM(hits), 0) as total_hits
      FROM embedding_cache
    `).catch(() => null),
    // Governance behaviour stats over REAL traffic only — eval traffic is
    // adversarial-heavy and would skew the intervention rate and margins.
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
  // Public "canonical total" = real governance only.
  const total_receipts              = Number(receiptsRealResult?.rows[0]?.cnt ?? total_receipts_including_eval);
  const eval_receipts               = Math.max(0, total_receipts_including_eval - total_receipts);
  const memory_events               = Number(memoryResult?.rows[0]?.cnt ?? 0);

  const cacheRow        = cacheResult?.rows[0];
  const cache_entries   = Number(cacheRow?.entries ?? 0);
  const cache_total_hits = Number(cacheRow?.total_hits ?? 0);
  // hit_rate = total_hits / (entries + total_hits) — approximates cache efficiency
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
    // legacy fields kept for backwards compat
    total_runs,
    runs: total_runs,
    // governance telemetry — real (non-eval) traffic
    total_receipts,
    total_receipts_including_eval,
    eval_receipts,
    memory_events,
    governed_turns,
    intervention_count,
    intervention_rate_pct: intervention_rate,
    avg_stability_margin: avg_m,
    min_stability_margin: min_m,
    // embedding cache efficiency (fix #10)
    embedding_cache: {
      entries:    cache_entries,
      total_hits: cache_total_hits,
      hit_rate_pct: cache_hit_rate,
    },
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
