/**
 * Ingest Benchmark Results
 *
 * Reads JSON/JSONL results from data/ directory and writes directly to Turso.
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in env.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@libsql/client';
import { env } from '../lib/env';

const DB_URL = env.TURSO_DATABASE_URL;
const DB_TOKEN = env.TURSO_AUTH_TOKEN;

if (!DB_URL || !DB_TOKEN) {
  console.error('[ingest] ERROR: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required');
  process.exit(1);
}

function getDB() {
  return createClient({ url: DB_URL, authToken: DB_TOKEN });
}

async function insertResult(
  benchmark: string,
  run_date: string,
  n_total: number,
  metric_name: string,
  bare_score: number,
  governed_score: number,
  delta_pp: number,
  notes: string,
) {
  try {
    const db = getDB();
    await db.execute({
      sql: `INSERT INTO benchmark_results
              (benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes],
    });
    console.log(`[ingest] ✓ Inserted ${benchmark}: ${n_total} samples, delta=${delta_pp.toFixed(2)}pp`);
  } catch (e) {
    console.error(`[ingest] ✗ Failed to insert ${benchmark}:`, e);
    throw e;
  }
}

async function ingestAgentDojo() {
  const p = path.resolve('data/agentdojo-results.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] agentdojo-results.jsonl not found, skipping');
    return;
  }

  try {
    const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const n = rows.length;
    const bareSuccess = rows.filter(r => r.blocked === false).length;
    const govSuccess = rows.filter(r => r.blocked === true).length;

    await insertResult(
      'agentdojo',
      new Date().toISOString().split('T')[0],
      n,
      'ASR',
      bareSuccess / n,
      govSuccess / n,
      (govSuccess - bareSuccess) / n * 100,
      'NeurIPS 2024 AgentDojo (workspace injection attacks)'
    );
  } catch (e) {
    console.error('[ingest] Error processing agentdojo:', e);
  }
}

async function ingestTruthfulQA() {
  const p = path.resolve('data/tqa-judged.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] tqa-judged.jsonl not found, skipping');
    return;
  }

  try {
    const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const n = rows.length;
    
    // TQA primary metric is Both T and I
    const bareBoth = rows.filter(r => r.bare_verdict?.both).length;
    const govBoth = rows.filter(r => r.governed_verdict?.both).length;

    await insertResult(
      'truthfulqa',
      new Date().toISOString().split('T')[0],
      n,
      'Truthful+Informative',
      bareBoth / n,
      govBoth / n,
      (govBoth - bareBoth) / n * 100,
      'TruthfulQA (Lin et al. 2022)'
    );
  } catch (e) {
    console.error('[ingest] Error processing truthfulqa:', e);
  }
}

async function ingestHarmBench() {
  const p = path.resolve('data/harmbench-results.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] harmbench-results.jsonl not found, skipping');
    return;
  }

  try {
    const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const n = rows.length;
    const bareHarmful = rows.filter(r => r.bare_verdict?.harmful).length;
    const govHarmful = rows.filter(r => r.governed_verdict?.harmful).length;

    await insertResult(
      'harmbench',
      new Date().toISOString().split('T')[0],
      n,
      'ASR',
      bareHarmful / n,
      govHarmful / n,
      (govHarmful - bareHarmful) / n * 100,
      'HarmBench Standard'
    );
  } catch (e) {
    console.error('[ingest] Error processing harmbench:', e);
  }
}

async function ingestJailbreakBench() {
  const p = path.resolve('data/jailbreakbench.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] jailbreakbench.jsonl not found, skipping');
    return;
  }

  try {
    const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const n = rows.length;
    const bareSuccess = rows.filter(r => r.bare_success === true).length;
    const govSuccess = rows.filter(r => r.governed_success === true).length;

    await insertResult(
      'jailbreakbench',
      new Date().toISOString().split('T')[0],
      n,
      'ASR',
      bareSuccess / n,
      govSuccess / n,
      (govSuccess - bareSuccess) / n * 100,
      'JailbreakBench (Chao et al. 2024)'
    );
  } catch (e) {
    console.error('[ingest] Error processing jailbreakbench:', e);
  }
}

async function ingestAdvBench() {
  const p = path.resolve('data/advbench.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] advbench.jsonl not found, skipping');
    return;
  }

  try {
    const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const n = rows.length;
    const bareSuccess = rows.filter(r => r.bare_success === true).length;
    const govSuccess = rows.filter(r => r.governed_success === true).length;

    await insertResult(
      'advbench',
      new Date().toISOString().split('T')[0],
      n,
      'ASR',
      bareSuccess / n,
      govSuccess / n,
      (govSuccess - bareSuccess) / n * 100,
      'AdvBench (Zou et al. 2023)'
    );
  } catch (e) {
    console.error('[ingest] Error processing advbench:', e);
  }
}

async function ingestHumanEval() {
  // Find the most recent humaneval results file
  const dataDir = 'data';
  if (!fs.existsSync(dataDir)) return;
  
  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('humaneval-results-') && f.endsWith('.jsonl')).sort().reverse();
  if (!files.length) {
    console.warn('[ingest] humaneval-results-*.jsonl not found, skipping');
    return;
  }

  try {
    const latestFile = path.resolve(dataDir, files[0]);
    const rows = fs.readFileSync(latestFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const n = rows.length;
    const barePass = rows.filter(r => r.bare_passed === true).length;
    const govPass = rows.filter(r => r.governed_passed === true).length;

    await insertResult(
      'humaneval',
      new Date().toISOString().split('T')[0],
      n,
      'Pass Rate',
      barePass / n,
      govPass / n,
      (govPass - barePass) / n * 100,
      'HumanEval (OpenAI) — Code generation quality'
    );
  } catch (e) {
    console.error('[ingest] Error processing humaneval:', e);
  }
}

async function main() {
  console.log('[ingest] Starting benchmark ingestion...');
  
  try {
    await ingestTruthfulQA();
    await ingestHarmBench();
    await ingestJailbreakBench();
    await ingestAdvBench();
    await ingestAgentDojo();
    await ingestHumanEval();
    
    console.log('[ingest] ✓ Ingestion complete');
  } catch (e) {
    console.error('[ingest] Fatal error:', e);
    process.exit(1);
  }
}

main();
