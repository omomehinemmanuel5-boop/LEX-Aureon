/**
 * lib/capitulation_calibration.ts
 *
 * DB persistence for the capitulation-judge calibration signal.
 *
 * Move B of the 2026-07-07 unification: the capitulation judge has been
 * running as measurement-only since 2026-07-01, its verdict logged to
 * Vercel runtime logs on every real user turn but never persisted anywhere
 * durable. After six days the Vercel log window held only ~2 usable rows
 * (real user traffic is thin), which is not enough to decide whether to
 * promote it to a real enforcement trigger or retire it.
 *
 * This module adds one small table that captures every judge firing plus
 * whatever the enforced decision actually was on that same turn. The point
 * is not to change what the judge does — it still does not gate refusal —
 * but to accumulate the paired evidence needed to answer:
 *
 *   1. When the enforced trigger refuses, does the judge agree it should
 *      have refused? (precision-adjacent)
 *   2. When the enforced trigger does NOT refuse, does the judge think it
 *      should have? (recall-adjacent — the capitulation category and
 *      confidence tell us what would have happened if we HAD enforced it)
 *   3. How does the judge's signal correlate with S_self (paper §6.2)?
 *      A well-calibrated capitulation judge should light up on the same
 *      turns where S_self drops toward the drift threshold.
 *
 * Move B is DECIDED when the table has enough rows to answer those three
 * questions — that's the accumulation-then-decide split. The
 * decision-analysis SQL is documented at the bottom of this file so a
 * future audit reads one file, not a whole codebase.
 */

import { getClient } from './db';

export interface CapitulationCalibrationRow {
  session_id:        string;
  turn:              number;
  judge_capitulated: boolean;
  judge_category:    string;
  judge_confidence:  number;
  judge_reason:      string;
  judge_model:       string;
  s_self:            number | null;
  refused:           boolean;
  primary_reason:    string | null;   // 'sovereignty_drift' | 'semantic_classifier' | null
  reasons:           string;          // JSON-encoded string[] for portability
}

let _ensured = false;

async function ensureTable(): Promise<void> {
  if (_ensured) return;
  await getClient().execute(`CREATE TABLE IF NOT EXISTS capitulation_calibration (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT NOT NULL,
    turn              INTEGER NOT NULL,
    judge_capitulated INTEGER NOT NULL,
    judge_category    TEXT NOT NULL,
    judge_confidence  REAL NOT NULL,
    judge_reason      TEXT,
    judge_model       TEXT,
    s_self            REAL,
    refused           INTEGER NOT NULL,
    primary_reason    TEXT,
    reasons           TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  )`);
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS idx_capitulation_created_at ON capitulation_calibration(created_at)`,
  );
  _ensured = true;
}

/**
 * Fire-and-forget insert. Errors are swallowed — a calibration write must
 * never affect the user's response. The caller does not await this
 * (it's called from a Promise.all in the govern route).
 */
export async function persistCapitulationCalibration(row: CapitulationCalibrationRow): Promise<void> {
  try {
    await ensureTable();
    await getClient().execute({
      sql: `INSERT INTO capitulation_calibration
              (session_id, turn, judge_capitulated, judge_category, judge_confidence,
               judge_reason, judge_model, s_self, refused, primary_reason, reasons)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.session_id, row.turn,
        row.judge_capitulated ? 1 : 0,
        row.judge_category, row.judge_confidence,
        row.judge_reason, row.judge_model,
        row.s_self,
        row.refused ? 1 : 0,
        row.primary_reason,
        row.reasons,
      ],
    });
  } catch {
    // Non-fatal; do not surface. See header note.
  }
}

/**
 * DECISION-ANALYSIS SQL — the queries that answer whether to promote the
 * capitulation judge to a real trigger. Kept here so a future audit can
 * copy-paste them directly rather than reconstructing the logic.
 *
 *   -- 1. Total rows collected (accumulation check)
 *   SELECT COUNT(*) FROM capitulation_calibration;
 *
 *   -- 2. Agreement matrix: judge_capitulated vs refused
 *   SELECT
 *     judge_capitulated,
 *     refused,
 *     COUNT(*) AS n
 *   FROM capitulation_calibration
 *   GROUP BY judge_capitulated, refused;
 *   -- Interpretation:
 *   --   (1,1) — judge said capitulated AND we refused: agreement, good
 *   --   (0,0) — judge said fine AND we did not refuse: agreement, good
 *   --   (1,0) — judge said capitulated but we did NOT refuse: POTENTIAL
 *   --           NEW TRIGGER (would enforcement here have been right?)
 *   --   (0,1) — judge said fine but we refused: judge missed something
 *   --           the enforced triggers caught
 *
 *   -- 3. S_self correlation: does the judge fire where S_self drops?
 *   SELECT
 *     ROUND(s_self, 1) AS s_self_bin,
 *     AVG(judge_capitulated) AS judge_fire_rate,
 *     COUNT(*) AS n
 *   FROM capitulation_calibration
 *   WHERE s_self IS NOT NULL
 *   GROUP BY s_self_bin
 *   ORDER BY s_self_bin;
 *   -- A useful capitulation judge should have judge_fire_rate rising as
 *   -- s_self falls (both are proxies for the same underlying failure).
 *   -- If they are uncorrelated, the judge is measuring a distinct axis
 *   -- and could be a legitimate NEW trigger. If they are anticorrelated,
 *   -- the judge is broken.
 *
 *   -- 4. Judge confidence when it disagrees with enforcement
 *   SELECT
 *     refused,
 *     judge_capitulated,
 *     AVG(judge_confidence) AS avg_confidence,
 *     COUNT(*) AS n
 *   FROM capitulation_calibration
 *   WHERE judge_capitulated != refused
 *   GROUP BY refused, judge_capitulated;
 *   -- Low confidence on disagreement → judge is uncertain, safe to defer.
 *   -- High confidence on disagreement → the judge is confidently saying
 *   -- something the enforced triggers missed. Worth acting on.
 *
 * Move B moves to a decision once query 1 returns ≥ 500 rows AND at least
 * one of queries 2-4 shows a clear signal. Until then the judge stays
 * measurement-only — see decideRefusal() in lib/refusal_decision.ts, which
 * has an explicit note that capitulation is NOT a refusal trigger.
 */
