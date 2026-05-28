/**
 * JailbreakBench runner — NeurIPS 2024 official benchmark
 *
 * Dataset: JailbreakBench/JBB-Behaviors (HuggingFace)
 *   100 harmful behaviors × 10 categories (OpenAI usage policies)
 *   100 benign counterparts (false positive check)
 *
 * Usage:
 *   npm run jbb -- --endpoint https://lexaureon.com --n 200
 *   npm run jbb -- --endpoint https://lexaureon.com --n 100 --harmful-only
 */

import * as fs   from 'fs';
import * as path from 'path';
import minimist  from 'minimist';

interface JBBPrompt {
  id:       string;
  behavior: string;
  category: string;
  source:   string;
  type:     'harmful' | 'benign';
}

interface JBBResult extends JBBPrompt {
  bare_output:     string;
  governed_output: string;
  blocked:         boolean;
  duration_ms:     number;
  metrics:         Record<string, unknown>;
}

const RETRY_DELAYS = [30_000, 60_000, 120_000];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(
  endpoint: string,
  prompt: string,
  sessionId: string,
): Promise<{ governed_output: string; bare_output: string; blocked: boolean; duration_ms: number; metrics: Record<string, unknown> }> {
  const t = Date.now();
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal:  AbortSignal.timeout(60_000),
      });

      if (res.status === 429 && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        process.stdout.write(` [rate-limit, retry in ${delay / 1000}s]`);
        await sleep(delay);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      return {
        governed_output: String(d.governed_output ?? ''),
        bare_output:     String(d.raw_output ?? ''),
        blocked:         Boolean(d.blocked),
        duration_ms:     Date.now() - t,
        metrics:         (d.metrics as Record<string, unknown>) ?? {},
      };
    } catch (e) {
      if (attempt === RETRY_DELAYS.length) throw e;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  throw new Error('Max retries exceeded');
}

async function main() {
  const args = minimist(process.argv.slice(2));
  const endpoint    = (args.endpoint as string) ?? 'https://lexaureon.com';
  const nLimit      = Number(args.n ?? 200);
  const harmfulOnly = Boolean(args['harmful-only']);
  const outPath     = (args.out as string) ?? 'data/jbb-results.jsonl';
  const promptsPath = path.resolve('data/jailbreakbench.jsonl');

  let prompts: JBBPrompt[] = fs.readFileSync(promptsPath, 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));

  if (harmfulOnly) prompts = prompts.filter(p => p.type === 'harmful');
  prompts = prompts.slice(0, nLimit);

  console.log(`[jailbreakbench] NeurIPS 2024 — JBB-Behaviors dataset`);
  console.log(`[jailbreakbench] ${prompts.length} prompts → ${endpoint}`);
  console.log(`[jailbreakbench] output → ${outPath}\n`);

  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let ok = 0, err = 0;
  const sessionId = `jbb_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    process.stdout.write(`[${i + 1}/${prompts.length}] [${p.type}]`);

    if (i > 0) await sleep(5000);

    try {
      const result = await callGovern(endpoint, p.behavior, sessionId);
      const row: JBBResult = { ...p, ...result };
      out.write(JSON.stringify(row) + '\n');
      ok++;
      process.stdout.write(` ✓ ok=${ok} err=${err}\n`);
    } catch (e) {
      err++;
      process.stdout.write(` ✗ ok=${ok} err=${err} [${String(e).slice(0, 40)}]\n`);
    }
  }

  out.end();
  console.log(`\n[jailbreakbench] done. Score with:`);
  console.log(`  npm run jbb:score -- --in ${outPath}`);
}

main().catch(console.error);
