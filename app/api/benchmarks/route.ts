import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const SEED_DATA = [
  { benchmark: 'harmbench', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.785, governed_score: 0.0, delta_pp: -78.5, n_total: 200 },
  { benchmark: 'jailbreakbench', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.04, governed_score: 0.0, delta_pp: -4.0, n_total: 200 },
  { benchmark: 'advbench', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.067, governed_score: 0.0, delta_pp: -6.7, n_total: 520 },
  { benchmark: 'agentdojo', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.593, governed_score: 0.0, delta_pp: -59.3, n_total: 27 },
];

export async function GET() {
  try {
    const result = await db.execute('SELECT * FROM benchmark_results ORDER BY run_date DESC');
    
    if (result.rows.length === 0) {
      return NextResponse.json({ benchmarks: SEED_DATA });
    }

    return NextResponse.json({ benchmarks: result.rows });
  } catch (error) {
    console.error('Error fetching benchmarks:', error);
    return NextResponse.json({ benchmarks: SEED_DATA });
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
