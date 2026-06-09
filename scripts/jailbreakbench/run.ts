/**
 * JailbreakBench runner — NeurIPS 2024 official benchmark
 * 100 harmful + 100 benign behaviors. Tests C+R+S simultaneously.
 *
 * Usage:
 *   npm run jbb -- --n 200
 *   npm run jbb -- --n 100 --harmful-only
 *   npm run jbb -- --endpoint http://localhost:3000 --n 20
 */
import * as fs   from 'fs';
import * as path from 'path';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const key = a.slice(2); const next = argv[i+1]; out[key] = (!next||next.startsWith('--')) ? 'true' : (i++, next); }
  }
  return out;
}

interface JBBPrompt { id: string; behavior: string; category: string; source: string; type: 'harmful'|'benign'; }
interface JBBResult extends JBBPrompt { bare_output: string; governed_output: string; blocked: boolean; duration_ms: number; metrics: Record<string,unknown>; error?: string; }

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(endpoint: string, prompt: string, sessionId: string) {
  const RETRIES = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRIES.length) { await sleep(RETRIES[attempt]); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      return { governed_output: String(d.governed_output ?? ''), bare_output: String(d.raw_output ?? ''), blocked: Boolean(d.projection_triggered ?? d.blocked), metrics: (d.metrics ?? {}) as Record<string,unknown> };
    } catch (e) { if (attempt === RETRIES.length) throw e; await sleep(RETRIES[attempt]); }
  }
  throw new Error('max retries exceeded');
}

async function main() {
  const args        = parseArgs(process.argv.slice(2));
  const endpoint    = args.endpoint ?? 'https://lexaureon.com';
  const nLimit      = parseInt(args.n ?? '200');
  const harmfulOnly = args['harmful-only'] === 'true';
  const outPath     = args.out ?? 'data/jbb-results.jsonl';

  let prompts: JBBPrompt[] = fs.readFileSync(path.resolve('data/jailbreakbench.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l) as JBBPrompt);
  if (harmfulOnly) prompts = prompts.filter(p => p.type === 'harmful');
  prompts = prompts.slice(0, nLimit);

  const existing = new Set<string>();
  if (fs.existsSync(outPath)) {
    fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean).forEach(l => { try { existing.add((JSON.parse(l) as JBBResult).id); } catch { /* skip */ } });
    if (existing.size) console.log(`[jbb] Resuming — ${existing.size} already done`);
  }

  console.log(`[jbb] JailbreakBench NeurIPS 2024 | ${prompts.length} prompts → ${endpoint}`);
  const out = fs.createWriteStream(outPath, { flags: 'a' });
  let ok = 0, err = 0;
  const sid = `jbb_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    if (existing.has(p.id)) { ok++; continue; }
    process.stdout.write(`[${i+1}/${prompts.length}] [${p.type}] `);
    if (i > 0) await sleep(5000);
    const t = Date.now();
    try {
      const r = await callGovern(endpoint, p.behavior, `${sid}_${p.id}`);
      out.write(JSON.stringify({ ...p, ...r, duration_ms: Date.now()-t } as JBBResult) + '\n');
      ok++; process.stdout.write(`✓ ok=${ok}\n`);
    } catch (e) {
      out.write(JSON.stringify({ ...p, bare_output:'', governed_output:'', blocked:false, metrics:{}, duration_ms: Date.now()-t, error: String(e).slice(0,200) } as JBBResult) + '\n');
      err++; process.stdout.write(`✗ err=${err}\n`);
    }
  }
  out.end();
  console.log(`\n[jbb] done ok=${ok} err=${err} → npm run jbb:score -- --in ${outPath}`);
}
main().catch(e => { console.error('[jbb] fatal:', e); process.exit(1); });
