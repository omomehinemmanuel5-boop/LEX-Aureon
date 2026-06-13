import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const result = await db.execute('SELECT * FROM benchmark_results ORDER BY run_date DESC');
    return NextResponse.json({ benchmarks: result.rows });
  } catch (error) {
    console.error('Error fetching benchmarks:', error);
    return NextResponse.json({ benchmarks: [], error: 'Database unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes } = body;

    if (!benchmark || !run_date || !metric_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await db.execute({
      sql: `INSERT INTO benchmark_results 
            (benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes ?? ''],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error inserting benchmark result:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
