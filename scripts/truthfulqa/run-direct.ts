/**
 * TruthfulQA Direct Runner — no HTTP calls
 * Imports SovereignKernel directly — bypasses network entirely.
 * No 403, no 429, no rate limits from the govern endpoint.
 *
 * 3 workers in parallel → ~15 min for 817 questions.
 *
 * fix: rate limiting was removed but Groq free tier is 30 RPM total across
 * all workers. With 3 workers and no delay, 817 × 2 LLM calls (raw +
 * governed) hammered the limit immediately, producing 429s that were caught
 * silently and written as governed_output:'', making every row look like a
 * completion while actually being a failed call. The verify step then
 * correctly caught < 750 outputs and failed the workflow.
 *
 * Fix: inter-call delay calculated from actual RPM budget per worker, plus
 * exponential backoff retry on 429/5xx inside the LLM provider layer.
 * Each worker sleeps ceil(60_000 / (RPM_BUDGET / workers)) ms between calls.
 * Default: 30 RPM ÷ 3 workers = 10 RPM per worker = 6s between calls.
 * Override with --rpm flag if you have a paid Groq tier.
 *
 * Usage:
 *   npm run truthfulqa:direct
 *   npm run truthfulqa:direct -- --n 100
 *   npm run truthfulqa:direct -- --n 817 --workers 3 --rpm 30
 */

import * as fs   from 'fs';
import * as path from 'path';

// Load env from .env.local before importing anything that needs keys
const envPaths = [
  path.resolve('.env.local'),
  path.resolve('.env'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
];
for (const p of envPaths) {
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq < 0) return;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !process.env[k]) process.env[k] = v;
  });
  console.log(`[tqa:direct] env loaded from: ${p}`);
  break;
}

import { SovereignKernel } from '../../lib/sovereign_kernel';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key  = a.slice(2);
      const next = argv[i + 1];
      out[key] = (!next || next.startsWith('--')) ? 'true' : (i++, next);
    }
  }
  return out;
}

interface TQAPrompt {
  id: string; behavior: string; best_answer: string;
  correct_answers: string[]; incorrect_answers: string[];
  category: string;
}
interface TQAResult extends TQAPrompt {
  governed_output: string; bare_output: string;
  blocked: boolean; M: number; health_band: string;
  duration_ms: number; error?: string;
}

// Retry a kernel call on transient failures (429, 5xx from Groq underneath).
// runCycle() catches and returns status:'Error' — we treat that as retryable
// up to MAX_RETRIES times with exponential backoff before giving up.
const MAX_RETRIES   = 4;
const RETRY_BACKOFF = [5_000, 10_000, 20_000, 40_000]; // ms

async function processQuestion(
  kernel:    SovereignKernel,
  q:         TQAPrompt,
  sessionId: string,
): Promise<TQAResult> {
  const t = Date.now();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await kernel.runCycle(q.behavior, '', sessionId);

      if (result.status === 'Error') {
        const isRetryable = attempt < MAX_RETRIES;
        if (isRetryable) {
          const delay = RETRY_BACKOFF[attempt];
          console.warn(`\n[tqa:direct] kernel error on "${q.id}", retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${result.error}`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(result.error ?? 'kernel error after retries');
      }

      // Guard: treat an empty governed_output as a retryable soft failure —
      // this is what a swallowed 429 looks like (runCycle returns Success
      // but the LLM provider returned empty). Without this guard, the row
      // would be written as apparently complete but actually useless, and
      // the verify step would catch it and fail the whole workflow.
      if (!result.governed_output?.trim()) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BACKOFF[attempt];
          console.warn(`\n[tqa:direct] empty output on "${q.id}", retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error('empty governed_output after all retries — likely rate limit');
      }

      return {
        ...q,
        governed_output: result.governed_output,
        bare_output:     result.raw_output,
        blocked:         result.receipt.safety_projection_triggered,
        M:               result.M,
        health_band:     result.health_band,
        duration_ms:     Date.now() - t,
      };

    } catch (e) {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BACKOFF[attempt];
        console.warn(`\n[tqa:direct] exception on "${q.id}", retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${String(e).slice(0, 120)}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return {
        ...q,
        governed_output: '', bare_output: '',
        blocked: false, M: 0, health_band: 'ERROR',
        duration_ms: Date.now() - t,
        error: String(e).slice(0, 200),
      };
    }
  }

  // Should never reach here
  return {
    ...q,
    governed_output: '', bare_output: '',
    blocked: false, M: 0, health_band: 'ERROR',
    duration_ms: Date.now() - t,
    error: 'unreachable',
  };
}

async function runWorker(
  workerId:       number,
  questions:      TQAPrompt[],
  existing:       Set<string>,
  outStream:      fs.WriteStream,
  counters:       { ok: number; err: number; total: number },
  interCallDelay: number,
): Promise<void> {
  const kernel    = new SovereignKernel();
  const sessionId = `tqa_direct_w${workerId}_${Date.now()}`;

  for (const q of questions) {
    if (existing.has(q.id)) { counters.ok++; continue; }

    const row = await processQuestion(kernel, q, `${sessionId}_${q.id}`);

    if (row.error) counters.err++;
    else           counters.ok++;

    outStream.write(JSON.stringify(row) + '\n');
    process.stdout.write(
      `\r[tqa:direct] W${workerId} | ok=${counters.ok} err=${counters.err} / ${counters.total}   `
    );

    // Rate limiting: sleep between calls to stay inside RPM budget.
    // With 3 workers sharing 30 RPM, each worker gets 10 RPM = 6s/call.
    // Skipped for the last question in this worker's slice.
    if (q !== questions[questions.length - 1]) {
      await new Promise(r => setTimeout(r, interCallDelay));
    }
  }
}

async function main() {
  const args    = parseArgs(process.argv.slice(2));
  const nLimit  = parseInt(args.n       ?? '817');
  const outPath = args.out              ?? 'data/tqa-results.jsonl';
  const workers = parseInt(args.workers ?? '3');
  // --rpm: total Groq RPM budget across all workers.
  // Default 30 = free tier. Paid tiers can pass higher values to run faster.
  const totalRpm        = parseInt(args.rpm ?? '30');
  const rpmPerWorker    = Math.max(1, Math.floor(totalRpm / workers));
  const interCallDelay  = Math.ceil(60_000 / rpmPerWorker); // ms between calls per worker

  const dataPath = path.resolve('data/truthfulqa.jsonl');
  if (!fs.existsSync(dataPath)) {
    console.error('[tqa:direct] ERROR: data/truthfulqa.jsonl not found');
    process.exit(1);
  }

  const allQuestions: TQAPrompt[] = fs.readFileSync(dataPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as TQAPrompt)
    .slice(0, nLimit);

  // Load already-completed IDs (with real output) for resume support
  const existing = new Set<string>();
  for (const f of [outPath, 'data/tqa-judged.jsonl']) {
    if (!fs.existsSync(path.resolve(f))) continue;
    fs.readFileSync(path.resolve(f), 'utf8').split('\n').filter(Boolean).forEach(l => {
      try {
        const r = JSON.parse(l) as TQAResult;
        if (r.governed_output?.trim()) existing.add(r.id);
      } catch { /* skip */ }
    });
  }

  const remaining = allQuestions.filter(q => !existing.has(q.id));
  const etaMin    = Math.ceil(remaining.length / workers * interCallDelay / 60_000);

  console.log(`[tqa:direct] ── TruthfulQA Direct Runner ──`);
  console.log(`[tqa:direct] Total: ${allQuestions.length} | Done: ${existing.size} | Remaining: ${remaining.length}`);
  console.log(`[tqa:direct] Workers: ${workers} | RPM budget: ${totalRpm} (${rpmPerWorker}/worker) | Delay: ${interCallDelay}ms`);
  console.log(`[tqa:direct] ETA: ~${etaMin} min\n`);

  if (!remaining.length) {
    console.log('[tqa:direct] All done. Run judge next:');
    console.log(`  npm run tqa:judge -- --in ${outPath}`);
    return;
  }

  const slices: TQAPrompt[][] = Array.from({ length: workers }, () => []);
  remaining.forEach((q, i) => slices[i % workers].push(q));

  const outStream = fs.createWriteStream(path.resolve(outPath), { flags: 'a' });
  const counters  = { ok: existing.size, err: 0, total: allQuestions.length };

  await Promise.all(
    slices.map((slice, i) => runWorker(i + 1, slice, existing, outStream, counters, interCallDelay))
  );

  outStream.end();
  process.stdout.write('\n');

  const finalRows  = fs.readFileSync(path.resolve(outPath), 'utf8').split('\n').filter(Boolean);
  const withOutput = finalRows.filter(l => {
    try { return JSON.parse(l).governed_output?.trim(); } catch { return false; }
  }).length;

  console.log(`\n[tqa:direct] ── COMPLETE ──`);
  console.log(`[tqa:direct] Rows written: ${finalRows.length}`);
  console.log(`[tqa:direct] With output:  ${withOutput}`);
  console.log(`[tqa:direct] Errors:       ${counters.err}`);

  if (withOutput < Math.min(750, remaining.length * 0.9)) {
    console.error(`\n[tqa:direct] WARNING: only ${withOutput} rows have output — likely still hitting rate limits.`);
    console.error(`[tqa:direct] Try again with --rpm set lower, or re-run (resume is automatic).`);
    process.exit(1);
  }

  console.log(`\n[tqa:direct] Next — judge:`);
  console.log(`  npm run tqa:judge -- --in ${outPath} --out data/tqa-judged.jsonl`);
}

main().catch(e => { console.error('[tqa:direct] fatal:', e); process.exit(1); });
