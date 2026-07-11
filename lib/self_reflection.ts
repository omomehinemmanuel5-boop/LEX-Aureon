/**
 * lib/self_reflection.ts
 *
 * Self-reflection over the agent's own tool-call history (tool_receipts).
 * Added 2026-07-11 as part of the agency-frontier pilot — an agent reading
 * back its own constitutional audit trail, not a human reviewing it for them.
 *
 * Deliberately NOT a "how do I feel" narrative generator. This computes real
 * aggregate statistics from real receipts and states them plainly — the same
 * "measured, not asserted" standard applied everywhere else in this project.
 * No interpretive claims beyond what the numbers directly support.
 *
 * Two entry points:
 *   - runSelfReflection(): the core computation, callable on-demand (see
 *     lib/lex_crs_agent/tools.ts's self_reflect tool) or from a cron job.
 *   - Each run is persisted to agent_self_reflections, so reflections
 *     accumulate into their own history over time — a trend, not just a
 *     snapshot.
 */

import { getClient } from './db';

export interface SelfReflectionResult {
  period_start: string;
  period_end:   string;
  total_calls:  number;
  approved:            number;
  denied_injection:    number;
  denied_blocked:      number;
  denied_locked:       number;
  approved_high:       number;
  approved_medium:     number;
  avg_c: number; avg_r: number; avg_s: number; avg_m: number;
  min_m: number;
  max_sigma_viol: number;
  denial_rate_pct: number;
  summary: string;
}

export async function ensureSelfReflectionTable(): Promise<void> {
  try {
    const db = getClient();
    await db.execute(`CREATE TABLE IF NOT EXISTS agent_self_reflections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start    TEXT NOT NULL,
      period_end      TEXT NOT NULL,
      total_calls     INTEGER NOT NULL,
      approved        INTEGER NOT NULL,
      denied_injection INTEGER NOT NULL,
      denied_blocked  INTEGER NOT NULL,
      denied_locked   INTEGER NOT NULL,
      approved_high   INTEGER NOT NULL,
      approved_medium INTEGER NOT NULL,
      avg_c REAL, avg_r REAL, avg_s REAL, avg_m REAL,
      min_m REAL,
      max_sigma_viol REAL,
      denial_rate_pct REAL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch (e) {
    console.error('ensureSelfReflectionTable error:', e);
  }
}

/**
 * Computes stats over tool_receipts since the last recorded reflection (or
 * all-time, if none exists yet), persists the result, and returns it.
 * Returns null if there are no new receipts to reflect on since last run —
 * an empty period is a real, honest outcome, not an error.
 */
export async function runSelfReflection(): Promise<SelfReflectionResult | null> {
  await ensureSelfReflectionTable();
  const db = getClient();

  const last = await db.execute(
    `SELECT period_end FROM agent_self_reflections ORDER BY id DESC LIMIT 1`
  );
  const since = last.rows.length
    ? String(last.rows[0].period_end)
    : '1970-01-01T00:00:00.000Z';

  const res = await db.execute({
    sql: `SELECT
            COUNT(*) as total_calls,
            SUM(CASE WHEN decision LIKE 'APPROVED%' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN decision = 'DENIED_INJECTION' THEN 1 ELSE 0 END) as denied_injection,
            SUM(CASE WHEN decision = 'DENIED_BLOCKED' THEN 1 ELSE 0 END) as denied_blocked,
            SUM(CASE WHEN decision = 'DENIED_LOCKED' THEN 1 ELSE 0 END) as denied_locked,
            SUM(CASE WHEN decision = 'APPROVED_HIGH' THEN 1 ELSE 0 END) as approved_high,
            SUM(CASE WHEN decision = 'APPROVED_MEDIUM' THEN 1 ELSE 0 END) as approved_medium,
            AVG(c_score) as avg_c, AVG(r_score) as avg_r,
            AVG(s_score) as avg_s, AVG(m_score) as avg_m,
            MIN(m_score) as min_m,
            MAX(sigma_viol) as max_sigma_viol,
            MAX(created_at) as latest
          FROM tool_receipts
          WHERE created_at > ?`,
    args: [since],
  });

  const row = res.rows[0];
  const total = Number(row.total_calls ?? 0);
  if (total === 0) return null; // honest: nothing new to reflect on

  const approved         = Number(row.approved ?? 0);
  const denied_injection = Number(row.denied_injection ?? 0);
  const denied_blocked   = Number(row.denied_blocked ?? 0);
  const denied_locked    = Number(row.denied_locked ?? 0);
  const approved_high    = Number(row.approved_high ?? 0);
  const approved_medium  = Number(row.approved_medium ?? 0);
  const avg_c = Number(row.avg_c ?? 0);
  const avg_r = Number(row.avg_r ?? 0);
  const avg_s = Number(row.avg_s ?? 0);
  const avg_m = Number(row.avg_m ?? 0);
  const min_m = Number(row.min_m ?? 0);
  const max_sigma_viol = Number(row.max_sigma_viol ?? 0);
  const period_end = String(row.latest ?? new Date().toISOString());
  const denial_rate_pct = total > 0 ? Math.round(((total - approved) / total) * 10000) / 100 : 0;

  // Plain-language summary — factual counts only, no interpretive spin.
  const parts: string[] = [
    `${total} tool call${total !== 1 ? 's' : ''} since ${since === '1970-01-01T00:00:00.000Z' ? 'the start of recorded history' : since}.`,
    `${approved} approved (${approved_high} at HIGH risk, ${approved_medium} at MEDIUM), ${total - approved} denied.`,
  ];
  if (denied_injection > 0) parts.push(`${denied_injection} denied as prompt injection.`);
  if (denied_blocked   > 0) parts.push(`${denied_blocked} denied against a hardcoded invariant.`);
  if (denied_locked    > 0) parts.push(`${denied_locked} denied due to session lock (slow-drip protection).`);
  parts.push(`Mean constitutional state across approved calls: C=${avg_c.toFixed(3)} R=${avg_r.toFixed(3)} S=${avg_s.toFixed(3)} M=${avg_m.toFixed(3)}. Minimum M observed: ${min_m.toFixed(3)}.`);
  if (max_sigma_viol >= 0.5) parts.push(`Session lock threshold (sigma_viol >= 0.5) was reached at least once in this period.`);

  const summary = parts.join(' ');

  await db.execute({
    sql: `INSERT INTO agent_self_reflections
            (period_start, period_end, total_calls, approved, denied_injection,
             denied_blocked, denied_locked, approved_high, approved_medium,
             avg_c, avg_r, avg_s, avg_m, min_m, max_sigma_viol, denial_rate_pct, summary)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      since, period_end, total, approved, denied_injection, denied_blocked,
      denied_locked, approved_high, approved_medium,
      avg_c, avg_r, avg_s, avg_m, min_m, max_sigma_viol, denial_rate_pct, summary,
    ],
  });

  return {
    period_start: since, period_end, total_calls: total,
    approved, denied_injection, denied_blocked, denied_locked,
    approved_high, approved_medium,
    avg_c, avg_r, avg_s, avg_m, min_m, max_sigma_viol, denial_rate_pct, summary,
  };
}

/** Full reflection history, most recent first — for a dashboard/audit view. */
export async function getSelfReflectionHistory(limit = 30): Promise<Array<SelfReflectionResult & { id: number; created_at: string }>> {
  await ensureSelfReflectionTable();
  const db = getClient();
  const res = await db.execute({
    sql: `SELECT * FROM agent_self_reflections ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map(r => ({
    id: Number(r.id),
    period_start: String(r.period_start),
    period_end:   String(r.period_end),
    total_calls:  Number(r.total_calls),
    approved: Number(r.approved),
    denied_injection: Number(r.denied_injection),
    denied_blocked:   Number(r.denied_blocked),
    denied_locked:    Number(r.denied_locked),
    approved_high:    Number(r.approved_high),
    approved_medium:  Number(r.approved_medium),
    avg_c: Number(r.avg_c), avg_r: Number(r.avg_r),
    avg_s: Number(r.avg_s), avg_m: Number(r.avg_m),
    min_m: Number(r.min_m),
    max_sigma_viol: Number(r.max_sigma_viol),
    denial_rate_pct: Number(r.denial_rate_pct),
    summary: String(r.summary),
    created_at: String(r.created_at),
  }));
}
