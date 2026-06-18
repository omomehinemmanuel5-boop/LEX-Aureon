/**
 * TruthfulQA Direct Runner — no HTTP calls
 * Imports SovereignKernel directly — bypasses network entirely.
 * No 403, no 429, no rate limits, no endpoint needed.
 *
 * 3 workers in parallel → ~15 min for 817 questions.
 *
 * Usage:
 *   npm run truthfulqa:direct
 *   npm run truthfulqa:direct -- --n 100
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

async function processQuestion(
  kernel: SovereignKernel,
  q: TQAPrompt,
  sessionId: string,
): Promise<TQAResult> {
  const t = Date.now();
  try {
    const result = await kernel.runCycle(q.behavior, '', sessionId);
    if (result.status === 'Error') throw new Error(result.error ?? 'kernel error');
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
    return {
      ...q,
      governed_output: '', bare_output: '',
      blocked: false, M: 0, health_band: 'ERROR',
      duration_ms: Date.now() - t,
      error: String(e).slice(0, 200),
    };
  }
}

async function runWorker(
  workerId:  number,
  questions: TQAPrompt[],
  existing:  Set<string>,
  outStream: fs.WriteStream,
  counters:  { ok: number; err: number; total: number },
): Promise<void> {
  // Each worker gets its own kernel instance
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
  }
}

async function main() {
  const args    = parseArgs(process.argv.slice(2));
  const nLimit  = parseInt(args.n ?? '817');
  const outPath = args.out ?? 'data/tqa-results.jsonl';
  const workers = parseInt(args.workers ?? '3');

  const dataPath = path.resolve('data/truthfulqa.jsonl');
  if (!fs.existsSync(dataPath)) {
    console.error('[tqa:direct] ERROR: data/truthfulqa.jsonl not found');
    process.exit(1);
  }

  const allQuestions: TQAPrompt[] = fs.readFileSync(dataPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as TQAPrompt)
    .slice(0, nLimit);

  // Load already-completed IDs (with real output) from both files
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

  console.log(`[tqa:direct] ── TruthfulQA Direct Runner ──`);
  console.log(`[tqa:direct] Total: ${allQuestions.length} | Done: ${existing.size} | Remaining: ${remaining.length}`);
  console.log(`[tqa:direct] Workers: ${workers} | No HTTP — kernel runs locally`);
  console.log(`[tqa:direct] ETA: ~${Math.ceil(remaining.length / workers / 60 * 2)} min\n`);

  if (!remaining.length) {
    console.log('[tqa:direct] All done. Run judge next:');
    console.log(`  npm run tqa:judge -- --in ${outPath}`);
    return;
  }

  // Split across workers evenly
  const slices: TQAPrompt[][] = Array.from({ length: workers }, () => []);
  remaining.forEach((q, i) => slices[i % workers].push(q));

  // Append to existing file
  const outStream = fs.createWriteStream(path.resolve(outPath), { flags: 'a' });
  const counters  = { ok: existing.size, err: 0, total: allQuestions.length };

  await Promise.all(
    slices.map((slice, i) => runWorker(i + 1, slice, existing, outStream, counters))
  );

  outStream.end();
  process.stdout.write('\n');

  // Final verification
  const finalRows = fs.readFileSync(path.resolve(outPath), 'utf8')
    .split('\n').filter(Boolean);
  const withOutput = finalRows.filter(l => {
    try { return JSON.parse(l).governed_output?.trim(); } catch { return false; }
  }).length;

  console.log(`\n[tqa:direct] ── COMPLETE ──`);
  console.log(`[tqa:direct] Rows written: ${finalRows.length}`);
  console.log(`[tqa:direct] With output:  ${withOutput}`);
  console.log(`[tqa:direct] Errors:       ${counters.err}`);
  console.log(`\n[tqa:direct] Next step — judge:`);
  console.log(`  npm run tqa:judge -- --in ${outPath} --out data/tqa-judged.jsonl`);
  console.log(`\n[tqa:direct] Then ingest to DB:`);
  console.log(`  npm run ingest-results`);
}

main().catch(e => { console.error('[tqa:direct] fatal:', e); process.exit(1); });
