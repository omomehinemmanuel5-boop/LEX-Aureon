import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const total = await db.execute(`SELECT COUNT(*) AS value FROM praxis_receipts`);
  const today = await db.execute(`SELECT COUNT(*) AS value FROM praxis_receipts WHERE DATE(created_at)=DATE('now')`);
  const sessions = await db.execute(`SELECT COUNT(DISTINCT session_id) AS value FROM praxis_receipts WHERE created_at>=datetime('now','-30 day')`);
  const real = await db.execute(`SELECT COUNT(*) AS value FROM praxis_receipts WHERE created_at>=datetime('now','-30 day') AND session_id NOT LIKE 'synthetic_%'`);
  const latest = await db.execute(`SELECT receipt_id, health_band, created_at FROM praxis_receipts ORDER BY created_at DESC LIMIT 5`);
  return NextResponse.json({ total: total.rows[0].value, today: today.rows[0].value, sessions: sessions.rows[0].value, real: real.rows[0].value, latest: latest.rows });
}
