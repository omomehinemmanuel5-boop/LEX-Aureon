import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';

// fix (2026-07-10) — LIKELY THE DOMINANT TURSO ROW-READ CONSUMER ON THE
// SITE: this route runs SIX queries per call, including COUNT(*) over the
// entire praxis_receipts table (~47,000+ rows and growing — see the
// homepage's own "~47,000 logged turns" copy) and a GROUP BY session_id
// HAVING COUNT(*) > 80 subquery that scans that same table a second time.
// It had zero caching, and is polled every 10s by components/LiveStatsBar.tsx
// on the homepage (every visitor, for as long as the tab is open) and every
// 5s by components/LiveAuditFeed.tsx. Turso reported ~80% of its row-read
// quota consumed. A handful of concurrent visitors polling this for even a
// few minutes can plausibly account for millions of row reads on its own —
// this is a much larger contributor than any single benchmark run. These
// stats (total runs, intervention rate, avg margin) don't need
// second-by-second accuracy for a marketing stats bar; a 5-minute cache
// window is imperceptible to a visitor and cuts the read volume by roughly
// (poll frequency x concurrent visitors x 30).
export const revalidate = 300;

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
// reflects genuine usage rather than self-generated eval load.
//
// Two exclusions:
//  1. PREFIX — newly-tagged eval sessions (lexbench-/synthetic_/bench-/jbb_/adv_/
//     hb_). Real console/chat sessions use `session-<ms>-<rand>`, which none of
//     these match, so no real traffic is dropped.
//  2. TURN-COUNT — sessions with an abnormally high number of turns (> 80). This
//     catches historical benchmark runs that (before the 2026-07 session tagging)
//     used the SAME `session-<ms>` format as the console and so cannot be
//     separated by prefix. A single benchmark run fires 200–800 prompts under one
//     session id; a real console/chat session realistically never approaches 80
//     turns. Measured: 120 such sessions accounted for ~21.9k receipts, all
//     benchmark. The threshold is deliberately conservative — a genuine long
//     session would be undercounted, which is the safe direction for an honesty
//     metric. Both the filtered and unfiltered totals are returned for
//     transparency (`total_receipts` vs `total_receipts_including_eval`).
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
