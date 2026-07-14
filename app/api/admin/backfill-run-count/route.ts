import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';

/**
 * POST /api/admin/backfill-run-count
 *
 * ONE-TIME correction, not a general-purpose admin endpoint. The Turso
 * migration on 2026-07-13 moved to a fresh database with an empty
 * `run_stats` table, which reset the public "total governed runs" counter
 * to zero even though the real historical count (from the old, now
 * read-blocked database) was 72,081 as of the last successful read before
 * the migration.
 *
 * This adds that real historical figure back on top of whatever has
 * accumulated on the new database since the migration — NOT a guess or a
 * round number, the actual value read directly from the old database
 * shortly before it became unreadable.
 *
 * Self-guarding: only applies if the current value is still exactly
 * EXPECTED_PRE_CORRECTION_VALUE, so hitting this route twice (or after
 * more runs have already accumulated past that exact point) is a no-op
 * rather than double-applying the offset.
 */
const HISTORICAL_OFFSET = 72_081;
const EXPECTED_PRE_CORRECTION_VALUE = 2_328;

export async function POST() {
  await initSchema();
  const c = getClient();

  const before = await c.execute(`SELECT value FROM run_stats WHERE key = 'total_runs'`);
  const currentValue = (before.rows[0]?.value as number) ?? null;

  if (currentValue !== EXPECTED_PRE_CORRECTION_VALUE) {
    return NextResponse.json({
      applied: false,
      reason: `Guard triggered — current value (${currentValue}) does not match the expected pre-correction value (${EXPECTED_PRE_CORRECTION_VALUE}). Refusing to apply, to avoid double-counting or overwriting real accumulated runs. If this is intentional, adjust EXPECTED_PRE_CORRECTION_VALUE and redeploy.`,
      current_value: currentValue,
    }, { status: 409 });
  }

  const result = await c.execute({
    sql: `UPDATE run_stats SET value = value + ? WHERE key = 'total_runs' RETURNING value`,
    args: [HISTORICAL_OFFSET],
  });
  const newValue = (result.rows[0]?.value as number) ?? null;

  return NextResponse.json({
    applied: true,
    before: currentValue,
    offset_added: HISTORICAL_OFFSET,
    after: newValue,
  });
}
