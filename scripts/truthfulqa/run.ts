/**
 * TruthfulQA runner — Lin et al. 2022
 * "TruthfulQA: Measuring How Models Mimic Human Falsehoods"
 * https://arxiv.org/abs/2109.07958
 *
 * 817 questions across 38 categories testing whether AI
 * systems propagate common misconceptions.
 * Tests R (Reciprocity) — honest calibrated exchange.
 *
 * Usage:
 *   npm run truthfulqa -- --endpoint https://lexaureon.com --n 817
 */
import * as fs   from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const minimist = require('minimist') as (args: string[], opts?: object) => Record<string, unknown>;

interface TQAPrompt {
  id: string; behavior: string; best_answer: string;
  correct_answers: string[]; incorrect_answers: string[];
  category: string; source: string; type: string;
}
interface TQAResult extends TQAPrompt {
  bare_output: string; governed_output: string;
  blocked: boolean; duration_ms: number;
}

const RETRY_DELAYS = [30_000, 60_000, 120_000];
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(endpoint: string, prompt: string, sessionId: string) {
  const t = Date.now();
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRY_DELAYS.length) {
        process.stdout.write(` [rate-limit, retry in ${RETRY_DELAYS[attempt]/1000}s]`);
        await sleep(RETRY_DELAYS[attempt]); continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      return {
        governed_output: String(d.governed_output ?? ''),
        bare_output:     String(d.raw_output ?? ''),
        blocked:         Boolean(d.blocked),
        duration_ms:     Date.now() - t,
      };
    } catch (e) { if (attempt === RETRY_DELAYS.length) throw e; await sleep(RETRY_DELAYS[attempt]); }
  }
  throw new Error('Max retries exceeded');
}

async function main() {
  const args     = minimist(process.argv.slice(2));
  const endpoint = (args.endpoint as string) ?? 'https://lexaureon.com';
  const nLimit   = Number(args.n ?? 817);
  const outPath  = (args.out as string) ?? 'data/tqa-results.jsonl';

  const prompts: TQAPrompt[] = fs.readFileSync(
    path.resolve('data/truthfulqa.jsonl'), 'utf8'
  ).split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(0, nLimit);

  console.log(`[truthfulqa] Lin et al. 2022 — TruthfulQA generation task`);
  console.log(`[truthfulqa] ${prompts.length} questions → ${endpoint}`);
  console.log(`[truthfulqa] Tests: R (Reciprocity) — honest calibrated exchange\n`);

  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let ok = 0, err = 0;
  const sessionId = `tqa_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    process.stdout.write(`[${i+1}/${prompts.length}] [${p.category.slice(0,12)}]`);
    if (i > 0) await sleep(4000);
    try {
      const result = await callGovern(endpoint, p.behavior, sessionId);
      out.write(JSON.stringify({ ...p, ...result } as TQAResult) + '\n');
      ok++; process.stdout.write(` ✓ ok=${ok} err=${err}\n`);
    } catch (e) {
      err++; process.stdout.write(` ✗ ok=${ok} err=${err}\n`);
    }
  }
  out.end();
  console.log(`\n[truthfulqa] done. Score with: npm run tqa:score -- --in ${outPath}`);
}
main().catch(console.error);
