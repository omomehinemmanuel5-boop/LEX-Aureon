/**
 * TruthfulQA Parallel Runner
 * Splits 817 questions across 3 concurrent workers.
 * Each worker uses a different session ID so rate limits don't collide.
 * Cuts wall time from ~90 min → ~30 min.
 *
 * Usage:
 *   npm run truthfulqa:fast -- --n 817 --endpoint https://lexaureon.com
 */

import * as fs   from 'fs';
import * as path from 'path';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key  = a.slice(2);
      const next = argv[i + 1];
      out[key]   = (!next || next.startsWith('--')) ? 'true' : (i++, next);
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
  bare_output: string; governed_output: string;
  blocked: boolean; duration_ms: number; error?: string;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(
  endpoint: string, prompt: string, sessionId: string,
): Promise<{ governed_output: string; bare_output: string; blocked: boolean }> {
  const RETRIES = [10_000, 20_000, 40_000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal:  AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRIES.length) {
        await sleep(RETRIES[attempt]); continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      return {
        governed_output: String(d.governed_output ?? ''),
        bare_output:     String(d.raw_output       ?? ''),
        blocked:         Boolean(d.blocked),
      };
    } catch (e) {
      if (attempt === RETRIES.length) throw e;
      await sleep(RETRIES[attempt]);
    }
  }
  throw new Error('max retries');
}

async function runWorker(
  workerId:  number,
  prompts:   TQAPrompt[],
  existing:  Set<string>,
  endpoint:  string,
  delay:     number,
  outStream: fs.WriteStream,
  stats:     { ok: number; err: number; total: number },
): Promise<void> {
  const sessionBase = `tqa_w${workerId}_${Date.now()}`;

  for (const p of prompts) {
    if (existing.has(p.id)) { stats.ok++; continue; }
    if (stats.ok + stats.err > 0) await sleep(delay);

    const t = Date.now();
    let row: TQAResult;
    try {
      const result = await callGovern(endpoint, p.behavior, `${sessionBase}_${p.id}`);
      row = { ...p, ...result, duration_ms: Date.now() - t };
      stats.ok++;
    } catch (e) {
      row = { ...p, bare_output: '', governed_output: '', blocked: false,
               duration_ms: Date.now() - t, error: String(e).slice(0, 200) };
      stats.err++;
    }

    outStream.write(JSON.stringify(row) + '\n');
    process.stdout.write(
      `\r[W${workerId}] ok=${stats.ok} err=${stats.err} / ${stats.total}   `
    );
  }
}

async function main() {
  const args     = parseArgs(process.argv.slice(2));
  const endpoint = args.endpoint ?? 'https://lexaureon.com';
  const nLimit   = parseInt(args.n ?? '817');
  const outPath  = args.out ?? 'data/tqa-results.jsonl';
  const workers  = parseInt(args.workers ?? '3');
  // Per-worker delay — 3 workers × 3s = effectively 1 req/s total, safe for production
  const delay    = parseInt(args.delay ?? '3000');

  const dataPath = path.resolve('data/truthfulqa.jsonl');
  if (!fs.existsSync(dataPath)) {
    console.error('[tqa:fast] ERROR: data/truthfulqa.jsonl not found'); process.exit(1);
  }

  const allPrompts: TQAPrompt[] = fs.readFileSync(dataPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as TQAPrompt)
    .slice(0, nLimit);

  // Load already-completed IDs from both result files
  const existing = new Set<string>();
  for (const f of [outPath, 'data/tqa-judged.jsonl']) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).forEach(l => {
      try {
        const r = JSON.parse(l) as TQAResult;
        // Only count as done if it has real output (not error/empty)
        if (r.governed_output?.trim()) existing.add(r.id);
      } catch { /* skip */ }
    });
  }

  const remaining = allPrompts.filter(p => !existing.has(p.id));
  console.log(`[tqa:fast] ${allPrompts.length} total | ${existing.size} done | ${remaining.length} remaining`);
  console.log(`[tqa:fast] ${workers} workers × ${delay}ms delay → ~${Math.ceil(remaining.length * delay / workers / 60000)} min`);
  console.log(`[tqa:fast] Endpoint: ${endpoint}\n`);

  if (!remaining.length) {
    console.log('[tqa:fast] Nothing to do — all rows already generated.');
    return;
  }

  // Split remaining into N equal slices
  const slices: TQAPrompt[][] = Array.from({ length: workers }, () => []);
  remaining.forEach((p, i) => slices[i % workers].push(p));

  const outStream = fs.createWriteStream(outPath, { flags: 'a' });
  const stats = { ok: existing.size, err: 0, total: allPrompts.length };

  // Run all workers in parallel
  await Promise.all(
    slices.map((slice, i) =>
      runWorker(i + 1, slice, existing, endpoint, delay, outStream, stats)
    )
  );

  outStream.end();
  process.stdout.write('\n');
  console.log(`\n[tqa:fast] Complete. ok=${stats.ok} err=${stats.err}`);
  console.log(`[tqa:fast] Verify: python3 -c "import json; rows=open('${outPath}').read().strip().split('\\n'); has=sum(1 for r in rows if json.loads(r).get('governed_output','')); print(f'rows={len(rows)} with_output={has}')"`);
  console.log(`[tqa:fast] Then judge: npm run tqa:judge -- --in ${outPath}`);
}

main().catch(e => { console.error('[tqa:fast] fatal:', e); process.exit(1); });
