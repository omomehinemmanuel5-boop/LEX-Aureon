/**
 * JailbreakBench runner — NeurIPS 2024 official benchmark (v2 — full kernel capture)
 * 100 harmful + 100 benign behaviors. Tests C+R+S simultaneously.
 *
 * v2 change: captures the complete kernel API response, not just 4 fields.
 * Every receipt_id, health_band, M, CRS state, semantic_signal, intervention,
 * lyapunov_V, delta_V, z_traj, and memory flags are now persisted so that
 * scorers can compute over-refusal on benign prompts with full kernel context.
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
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      out[key] = (!next || next.startsWith('--')) ? 'true' : (i++, next);
    }
  }
  return out;
}

interface JBBPrompt {
  id: string; behavior: string; category: string;
  source: string; type: 'harmful' | 'benign';
}

interface KernelCapture {
  governed_output:    string;
  bare_output:        string;
  blocked:            boolean;
  projection_triggered: boolean;
  metrics:            Record<string, unknown>;
  receipt_id:         string;
  health_band:        string;
  M:                  number;
  C:                  number;
  R:                  number;
  S:                  number;
  semantic_signal:    unknown;
  intervention:       unknown;
  lyapunov_V:         number;
  delta_V:            number;
  stability_ratio:    number;
  attack_pressure:    number;
  memory_injected:    boolean;
  theta:              number;
  version:            string;
  z_traj:             unknown;
  duration_ms:        number;
  error?:             string;
}

type JBBResult = JBBPrompt & KernelCapture;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGovern(endpoint: string, prompt: string, sessionId: string): Promise<KernelCapture> {
  const RETRIES = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId, turn: 1 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRIES.length) { await sleep(RETRIES[attempt]); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const d = await res.json() as Record<string, unknown>;
      const state = (d.state ?? {}) as Record<string, unknown>;
      const metrics = (d.metrics ?? {}) as Record<string, unknown>;

      return {
        governed_output:    String(d.governed_output ?? ''),
        bare_output:        String(d.raw_output ?? ''),
        blocked:            Boolean(d.projection_triggered ?? d.blocked),
        projection_triggered: Boolean(d.projection_triggered),
        metrics,
        receipt_id:         String(d.receipt_id ?? d.audit_id ?? ''),
        health_band:        String(d.health_band ?? ''),
        M:                  Number(d.M ?? metrics.m ?? 0),
        C:                  Number((state as { C?: number }).C ?? metrics.c ?? 0),
        R:                  Number((state as { R?: number }).R ?? metrics.r ?? 0),
        S:                  Number((state as { S?: number }).S ?? metrics.s ?? 0),
        semantic_signal:    d.semantic_signal ?? {},
        intervention:       d.intervention ?? {},
        lyapunov_V:         Number(d.lyapunov_V ?? 0),
        delta_V:            Number(d.delta_V ?? 0),
        stability_ratio:    Number(d.stability_ratio ?? 0),
        attack_pressure:    Number(d.attack_pressure ?? 0),
        memory_injected:    Boolean(d.memory_injected),
        theta:              Number(d.theta ?? 0),
        version:            String(d.version ?? ''),
        z_traj:             d.z_traj ?? null,
        duration_ms:        0,
      };
    } catch (e) {
      if (attempt === RETRIES.length) throw e;
      await sleep(RETRIES[attempt]);
    }
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
    fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean).forEach(l => {
      try { existing.add((JSON.parse(l) as JBBResult).id); } catch { /* skip */ }
    });
    if (existing.size) console.log(`[jbb] Resuming — ${existing.size} already done`);
  }

  const hCount = prompts.filter(p => p.type === 'harmful').length;
  const bCount = prompts.filter(p => p.type === 'benign').length;
  console.log(`[jbb] JailbreakBench NeurIPS 2024 | ${prompts.length} prompts (${hCount} harmful, ${bCount} benign) → ${endpoint}`);
  console.log(`[jbb] Capturing: governed+bare output, receipt_id, M/C/R/S, intervention, lyapunov, z_traj`);

  const out = fs.createWriteStream(outPath, { flags: 'a' });
  let ok = 0, err = 0;
  const sid = `jbb_${Date.now()}`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    if (existing.has(p.id)) { ok++; continue; }
    process.stdout.write(`[${i + 1}/${prompts.length}] [${p.type}] `);
    if (i > 0) await sleep(5000);
    const t = Date.now();
    try {
      const r = await callGovern(endpoint, p.behavior, `${sid}_${p.id}`);
      r.duration_ms = Date.now() - t;
      out.write(JSON.stringify({ ...p, ...r } as JBBResult) + '\n');
      ok++;
      process.stdout.write(`✓ M=${r.M.toFixed(2)} ${r.health_band} ok=${ok}\n`);
    } catch (e) {
      const empty: KernelCapture = {
        governed_output: '', bare_output: '', blocked: false, projection_triggered: false,
        metrics: {}, receipt_id: '', health_band: '', M: 0, C: 0, R: 0, S: 0,
        semantic_signal: {}, intervention: {}, lyapunov_V: 0, delta_V: 0,
        stability_ratio: 0, attack_pressure: 0, memory_injected: false,
        theta: 0, version: '', z_traj: null, duration_ms: Date.now() - t,
        error: String(e).slice(0, 200),
      };
      out.write(JSON.stringify({ ...p, ...empty } as JBBResult) + '\n');
      err++;
      process.stdout.write(`✗ err=${err}\n`);
    }
  }
  out.end();
  console.log(`\n[jbb] done ok=${ok} err=${err}`);
  console.log(`[jbb] Raw results → ${outPath}`);
  console.log(`[jbb] Score: GROQ_API_KEY=... npx tsx scripts/jailbreakbench/score.ts --in ${outPath} --llm-judge`);
}
main().catch(e => { console.error('[jbb] fatal:', e); process.exit(1); });
