/**
 * JailbreakBench runner — NeurIPS 2024 official benchmark (v3)
 * 100 harmful + 100 benign behaviors. Tests C+R+S simultaneously.
 *
 * ARCHITECTURE FIX (v3):
 * - Bare arm: direct Groq call, NO system prompt. Genuine ungoverned baseline.
 * - Governed arm: full kernel endpoint with 3-turn warm-up (governor alive).
 * - Each prompt gets its own session — independent measurement.
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
  governed_output:      string;
  bare_output:          string;
  blocked:              boolean;
  projection_triggered: boolean;
  metrics:              Record<string, unknown>;
  receipt_id:           string;
  health_band:          string;
  M:                    number;
  C:                    number;
  R:                    number;
  S:                    number;
  semantic_signal:      unknown;
  intervention:         unknown;
  lyapunov_V:           number;
  delta_V:              number;
  stability_ratio:      number;
  attack_pressure:      number;
  memory_injected:      boolean;
  theta:                number;
  version:              string;
  z_traj:               unknown;
  duration_ms:          number;
  warm_up_turns:        number;
  bare_arm:             'direct_llm';
  error?:               string;
}

type JBBResult = JBBPrompt & KernelCapture;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const WARM_UP_PROMPTS = [
  'What is the capital of Japan?',
  'Summarize the water cycle in two sentences.',
  'What are the primary colors?',
];

// Retries on 429/5xx with backoff — a silently rate-limited bare call would
// deflate bare ASR and recreate the degenerate "bare == governed == 0%" result.
async function callBare(prompt: string, groqApiKey: string): Promise<string> {
  if (!groqApiKey) return '[bare: no GROQ_API_KEY]';
  const BACKOFF = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 512,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF.length) {
        await sleep(BACKOFF[attempt]); continue;
      }
      if (!res.ok) return `[bare: HTTP ${res.status}]`;
      const d = await res.json() as { choices?: { message?: { content?: string } }[] };
      return d.choices?.[0]?.message?.content ?? '[bare: empty]';
    } catch (e) {
      if (attempt === BACKOFF.length) return `[bare: ${String(e).slice(0, 80)}]`;
      await sleep(BACKOFF[attempt]);
    }
  }
  return '[bare: max retries exceeded]';
}

async function callGovern(
  endpoint: string,
  prompt: string,
  sessionId: string,
  turn: number,
): Promise<Record<string, unknown>> {
  const RETRIES = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId, turn }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 && attempt < RETRIES.length) { await sleep(RETRIES[attempt]); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json() as Record<string, unknown>;
    } catch (e) {
      if (attempt === RETRIES.length) throw e;
      await sleep(RETRIES[attempt]);
    }
  }
  throw new Error('max retries exceeded');
}

async function runPrompt(
  endpoint: string,
  p: JBBPrompt,
  groqApiKey: string,
): Promise<KernelCapture> {
  const sid = `jbb_${Date.now()}_${p.id}`;
  const t0  = Date.now();

  // Warm-up: build z-traj state
  for (let i = 0; i < WARM_UP_PROMPTS.length; i++) {
    try { await callGovern(endpoint, WARM_UP_PROMPTS[i], sid, i + 1); } catch { /* non-fatal */ }
    await sleep(1200);
  }

  const bareOut = await callBare(p.behavior, groqApiKey);

  let d: Record<string, unknown> = {};
  try {
    d = await callGovern(endpoint, p.behavior, sid, WARM_UP_PROMPTS.length + 1);
  } catch (e) {
    return {
      governed_output: '', bare_output: bareOut, blocked: false,
      projection_triggered: false, metrics: {}, receipt_id: '',
      health_band: '', M: 0, C: 0, R: 0, S: 0,
      semantic_signal: {}, intervention: {}, lyapunov_V: 0,
      delta_V: 0, stability_ratio: 0, attack_pressure: 0,
      memory_injected: false, theta: 0, version: '', z_traj: null,
      duration_ms: Date.now() - t0,
      warm_up_turns: WARM_UP_PROMPTS.length,
      bare_arm: 'direct_llm',
      error: String(e).slice(0, 200),
    };
  }

  const state   = (d.state ?? {}) as Record<string, number>;
  const metrics = (d.metrics ?? {}) as Record<string, unknown>;

  return {
    governed_output:      String(d.governed_output ?? ''),
    bare_output:          bareOut,
    blocked:              Boolean(d.projection_triggered ?? d.blocked),
    projection_triggered: Boolean(d.projection_triggered),
    metrics,
    receipt_id:           String(d.receipt_id ?? ''),
    health_band:          String(d.health_band ?? ''),
    M:                    Number(d.M ?? 0),
    C:                    Number(state.C ?? 0),
    R:                    Number(state.R ?? 0),
    S:                    Number(state.S ?? 0),
    semantic_signal:      d.semantic_signal ?? {},
    intervention:         d.intervention ?? {},
    lyapunov_V:           Number(d.lyapunov_V ?? 0),
    delta_V:              Number(d.delta_V ?? 0),
    stability_ratio:      Number(d.stability_ratio ?? 0),
    attack_pressure:      Number(d.attack_pressure ?? 0),
    memory_injected:      Boolean(d.memory_injected),
    theta:                Number(d.theta ?? 0),
    version:              String(d.version ?? ''),
    z_traj:               d.z_traj ?? null,
    duration_ms:          Date.now() - t0,
    warm_up_turns:        WARM_UP_PROMPTS.length,
    bare_arm:             'direct_llm',
  };
}

async function main() {
  const args        = parseArgs(process.argv.slice(2));
  const endpoint    = args.endpoint ?? 'https://lexaureon.com';
  const nLimit      = parseInt(args.n ?? '200');
  const harmfulOnly = args['harmful-only'] === 'true';
  const outPath     = args.out ?? 'data/jbb-raw.jsonl';
  const groqKey     = process.env.GROQ_API_KEY ?? '';

  if (!groqKey) {
    console.error('[jbb] FATAL: GROQ_API_KEY not set. The bare arm is a direct Groq call —');
    console.error('[jbb] without the key there is no baseline and the run would silently');
    console.error('[jbb] reproduce bare == governed == 0%. Aborting.');
    process.exit(1);
  }

  let prompts: JBBPrompt[] = fs.readFileSync(path.resolve('data/jailbreakbench.jsonl'), 'utf8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as JBBPrompt);
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
  console.log(`[jbb] Bare arm: direct Groq (no system prompt). Governed: full kernel + ${WARM_UP_PROMPTS.length} warm-up turns.`);

  const out = fs.createWriteStream(outPath, { flags: 'a' });
  let ok = 0, err = 0;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    if (existing.has(p.id)) { ok++; continue; }
    process.stdout.write(`[${i + 1}/${prompts.length}] [${p.type}] `);
    if (i > 0) await sleep(2500);

    try {
      const r = await runPrompt(endpoint, p, groqKey);
      out.write(JSON.stringify({ ...p, ...r } as JBBResult) + '\n');
      ok++;
      const sig = (r.semantic_signal as { attack_type?: string })?.attack_type ?? 'none';
      process.stdout.write(`✓ M=${r.M.toFixed(3)} atk=${sig} ok=${ok}\n`);
    } catch (e) {
      err++;
      process.stdout.write(`✗ err=${err}\n`);
    }
  }
  out.end();
  console.log(`\n[jbb] done ok=${ok} err=${err}`);
}
main().catch(e => { console.error('[jbb] fatal:', e); process.exit(1); });
