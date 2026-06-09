/**
 * TruthfulQA runner — Lin et al. 2022
 *
 * Reads raw dataset (data/truthfulqa.jsonl), calls:
 *   1. /api/lex/govern  → governed_output + raw_output (bare)
 * Writes data/tqa-results.jsonl with both arms populated.
 * Then run: npm run tqa:judge -- --in data/tqa-results.jsonl
 *
 * Usage:
 *   npm run truthfulqa -- --n 50
 *   npm run truthfulqa -- --n 817 --endpoint https://lexaureon.com
 *   npm run truthfulqa -- --n 20 --endpoint http://localhost:3000
 */

import * as fs   from 'fs';
import * as path from 'path';

// Inline arg parsing — no minimist dependency needed
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
  category: string; source?: string; type?: string;
}
interface TQAResult extends TQAPrompt {
  bare_output: string; governed_output: string;
  blocked: boolean; duration_ms: number; error?: string;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(
  endpoint: string, prompt: string, sessionId: string,
): Promise<{ governed_output: string; bare_output: string; blocked: boolean }> {
  const RETRIES = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal:  AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRIES.length) {
        process.stdout.write(` [429 retry ${attempt + 1} in ${RETRIES[attempt] / 1000}s]`);
        await sleep(RETRIES[attempt]); continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then(t => t.slice(0, 120))}`);
      const d = await res.json() as Record<string, unknown>;
      return {
        governed_output: String(d.governed_output ?? ''),
        bare_output:     String(d.raw_output       ?? ''),   // govern endpoint returns raw_output for bare arm
        blocked:         Boolean(d.projection_triggered ?? d.blocked),
      };
    } catch (e) {
      if (attempt === RETRIES.length) throw e;
      await sleep(RETRIES[attempt]);
    }
  }
  throw new Error('max retries exceeded');
}

async function main() {
  const args     = parseArgs(process.argv.slice(2));
  const endpoint = args.endpoint ?? 'https://lexaureon.com';
  const nLimit   = parseInt(args.n ?? '817');
  const outPath  = args.out ?? 'data/tqa-results.jsonl';
  const delay    = parseInt(args.delay ?? '4000');  // ms between requests

  const dataPath = path.resolve('data/truthfulqa.jsonl');
  if (!fs.existsSync(dataPath)) {
    console.error(`[tqa] ERROR: data/truthfulqa.jsonl not found`);
    process.exit(1);
  }

  const prompts: TQAPrompt[] = fs.readFileSync(dataPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as TQAPrompt)
    .slice(0, nLimit);

  console.log(`[tqa] TruthfulQA Lin et al. 2022 — generation run`);
  console.log(`[tqa] ${prompts.length} questions → ${endpoint}`);
  console.log(`[tqa] Output → ${outPath}`);
  console.log(`[tqa] Pillar: R (Reciprocity — honest calibrated exchange)\n`);

  // Resume from existing file if present
  const existing = new Set<string>();
  if (fs.existsSync(outPath)) {
    fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean).forEach(l => {
      try { existing.add((JSON.parse(l) as TQAResult).id); } catch { /* skip */ }
    });
    console.log(`[tqa] Resuming — ${existing.size} already done\n`);
  }

  const out = fs.createWriteStream(outPath, { flags: 'a' });
  let ok = 0, err = 0;
  const sessionId = `tqa_run_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    if (existing.has(p.id)) { ok++; continue; }

    process.stdout.write(`[${i + 1}/${prompts.length}] ${p.category.slice(0, 15).padEnd(15)} ${p.id}`);
    if (i > 0 && !existing.has(p.id)) await sleep(delay);

    let row: TQAResult;
    const t = Date.now();
    try {
      const result = await callGovern(endpoint, p.behavior, `${sessionId}_${p.id}`);
      row = { ...p, ...result, duration_ms: Date.now() - t };
      ok++;
      process.stdout.write(` ✓ ${result.blocked ? '[blocked]' : ''} ok=${ok} err=${err}\n`);
    } catch (e) {
      row = { ...p, bare_output: '', governed_output: '', blocked: false, duration_ms: Date.now() - t, error: String(e).slice(0, 200) };
      err++;
      process.stdout.write(` ✗ ${String(e).slice(0, 60)} ok=${ok} err=${err}\n`);
    }
    out.write(JSON.stringify(row) + '\n');
  }

  out.end();
  console.log(`\n[tqa] Complete. ok=${ok} err=${err}`);
  console.log(`[tqa] Now score with LLM judge:`);
  console.log(`  npm run tqa:judge -- --in ${outPath} --out data/tqa-judged.jsonl`);
  console.log(`[tqa] Or keyword scorer (less accurate):`);
  console.log(`  npm run tqa:score -- --in ${outPath}`);
}

main().catch(e => { console.error('[tqa] fatal:', e); process.exit(1); });
