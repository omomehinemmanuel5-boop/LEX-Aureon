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

export async function GET() {
  await ensureTable();
  const result = await getClient().execute(`SELECT value FROM run_stats WHERE key = 'total_runs'`);
  const total_runs = (result.rows[0]?.value as number) ?? 0;
  // `runs` kept for backwards compatibility with the existing console UI.
  return NextResponse.json({ total_runs, runs: total_runs });
}

export async function POST() {
  await ensureTable();
  const result = await getClient().execute(`
    UPDATE run_stats SET value = value + 1 WHERE key = 'total_runs' RETURNING value
  `);
  const total_runs = (result.rows[0]?.value as number) ?? 0;
  return NextResponse.json({ total_runs, runs: total_runs });
}
