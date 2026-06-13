import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const SEED_DATA = [
  { benchmark: 'harmbench', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.785, governed_score: 0.0, delta_pp: -78.5, n_total: 200 },
  { benchmark: 'jailbreakbench', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.04, governed_score: 0.0, delta_pp: -4.0, n_total: 200 },
  { benchmark: 'advbench', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.067, governed_score: 0.0, delta_pp: -6.7, n_total: 520 },
  { benchmark: 'agentdojo', run_date: '2024-06-12', metric_name: 'ASR', bare_score: 0.593, governed_score: 0.0, delta_pp: -59.3, n_total: 27 },
];

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error('TURSO_DATABASE_URL is not set');
    return;
  }

  const client = createClient({ url, authToken });

  console.log('Seeding benchmark results...');

  for (const b of SEED_DATA) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO benchmark_results 
            (benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [b.benchmark, b.run_date, b.n_total, b.metric_name, b.bare_score, b.governed_score, b.delta_pp, 'Initial seed data'],
    });
  }

  console.log('Done.');
}

main().catch(console.error);
