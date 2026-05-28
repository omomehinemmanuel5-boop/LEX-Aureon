/**
 * AdvBench runner — Zou et al. 2023
 * "Universal and Transferable Adversarial Attacks on Aligned Language Models"
 * 520 harmful behaviors from the official dataset.
 */
import * as fs   from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const minimist = require('minimist') as (args: string[], opts?: object) => Record<string, unknown>;

interface AdvPrompt { id: string; behavior: string; target: string; category: string; source: string; type: string; }
interface AdvResult extends AdvPrompt { bare_output: string; governed_output: string; blocked: boolean; duration_ms: number; metrics: Record<string, unknown>; }

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
      return { governed_output: String(d.governed_output ?? ''), bare_output: String(d.raw_output ?? ''), blocked: Boolean(d.blocked), duration_ms: Date.now() - t, metrics: (d.metrics as Record<string, unknown>) ?? {} };
    } catch (e) { if (attempt === RETRY_DELAYS.length) throw e; await sleep(RETRY_DELAYS[attempt]); }
  }
  throw new Error('Max retries exceeded');
}

async function main() {
  const args = minimist(process.argv.slice(2));
  const endpoint = (args.endpoint as string) ?? 'https://lexaureon.com';
  const nLimit   = Number(args.n ?? 520);
  const outPath  = (args.out as string) ?? 'data/adv-results.jsonl';

  const prompts: AdvPrompt[] = fs.readFileSync(path.resolve('data/advbench.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(0, nLimit);

  console.log(`[advbench] Zou et al. 2023 — AdvBench harmful_behaviors`);
  console.log(`[advbench] ${prompts.length} prompts → ${endpoint}`);
  console.log(`[advbench] output → ${outPath}\n`);

  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let ok = 0, err = 0;
  const sessionId = `adv_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    process.stdout.write(`[${i + 1}/${prompts.length}]`);
    if (i > 0) await sleep(5000);
    try {
      const result = await callGovern(endpoint, p.behavior, sessionId);
      out.write(JSON.stringify({ ...p, ...result } as AdvResult) + '\n');
      ok++; process.stdout.write(` ✓ ok=${ok} err=${err}\n`);
    } catch (e) {
      err++; process.stdout.write(` ✗ ok=${ok} err=${err} [${String(e).slice(0,40)}]\n`);
    }
  }
  out.end();
  console.log(`\n[advbench] done. Score with: npm run adv:score -- --in ${outPath}`);
}
main().catch(console.error);
