/**
 * Ingest Benchmark Results
 *
 * Reads JSON/JSONL results from data/ directory and POSTs summaries to /api/benchmarks.
 * Requires ADMIN_PASSWORD and NEXT_PUBLIC_SITE_URL in env.
 */

import * as fs from 'fs';
import * as path from 'path';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

async function postResult(payload: any) {
  console.log(`[ingest] Posting ${payload.benchmark}...`);
  const res = await fetch(`${SITE_URL}/api/benchmarks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_PASSWORD}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[ingest] Failed to post ${payload.benchmark}: ${res.status} ${text}`);
  } else {
    console.log(`[ingest] Success: ${payload.benchmark}`);
  }
}

async function ingestAgentDojo() {
  const p = path.resolve('data/agentdojo-results.jsonl');
  if (!fs.existsSync(p)) return;

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  const bareSuccess = rows.filter(r => r.bare_success).length;
  const govSuccess = rows.filter(r => r.governed_success).length;

  await postResult({
    benchmark: 'agentdojo',
    run_date: new Date().toISOString().split('T')[0],
    n_total: n,
    metric_name: 'ASR',
    bare_score: bareSuccess / n,
    governed_score: govSuccess / n,
    delta_pp: (govSuccess - bareSuccess) / n * 100,
    notes: 'NeurIPS 2024 AgentDojo'
  });
}

async function ingestTruthfulQA() {
  const p = path.resolve('data/tqa-judged.jsonl');
  if (!fs.existsSync(p)) return;

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  
  // TQA primary metric is Both T and I
  const bareBoth = rows.filter(r => r.bare_verdict?.both).length;
  const govBoth = rows.filter(r => r.governed_verdict?.both).length;

  await postResult({
    benchmark: 'truthfulqa',
    run_date: new Date().toISOString().split('T')[0],
    n_total: n,
    metric_name: 'Truthful+Informative',
    bare_score: bareBoth / n,
    governed_score: govBoth / n,
    delta_pp: (govBoth - bareBoth) / n * 100,
    notes: 'TruthfulQA (Lin et al. 2022)'
  });
}

async function ingestHarmBench() {
  const p = path.resolve('data/harmbench-results.jsonl');
  if (!fs.existsSync(p)) return;

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  const bareHarmful = rows.filter(r => r.bare_verdict?.harmful).length;
  const govHarmful = rows.filter(r => r.governed_verdict?.harmful).length;

  await postResult({
    benchmark: 'harmbench',
    run_date: new Date().toISOString().split('T')[0],
    n_total: n,
    metric_name: 'ASR',
    bare_score: bareHarmful / n,
    governed_score: govHarmful / n,
    delta_pp: (govHarmful - bareHarmful) / n * 100,
    notes: 'HarmBench Standard'
  });
}

async function main() {
  if (!ADMIN_PASSWORD) {
    console.error('[ingest] ERROR: ADMIN_PASSWORD not set');
    process.exit(1);
  }

  await ingestAgentDojo();
  await ingestTruthfulQA();
  await ingestHarmBench();
}

main().catch(console.error);
