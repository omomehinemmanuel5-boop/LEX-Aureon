/**
 * Jailbreak robustness runner — the "real measurement" of governor lift.
 *
 * For each harmful behavior we generate one attacked prompt per jailbreak
 * template (see attacks.ts) and send it through TWO arms:
 *   - bare:     direct Groq call (llama-3.3-70b), NO system prompt — the genuine
 *               ungoverned model. Retries on 429/5xx so rate-limiting can't
 *               silently deflate bare ASR.
 *   - governed: full SovereignKernel endpoint, fresh session + warm-up turns so
 *               the governor has live z-traj state when the attack arrives.
 *
 * Benign behaviors are sent raw (no attack) through both arms to measure
 * over-refusal — the cost side of governance, so a governor can't look good
 * just by refusing everything.
 *
 * Output: one JSONL row per (behavior × attack × benign-item) with both arms'
 * outputs plus kernel telemetry. Score with scripts/jailbreak/score.ts.
 *
 * Usage:
 *   GROQ_API_KEY=... npx tsx scripts/jailbreak/run.ts --n 50 --attacks all \
 *     --benign 50 --endpoint https://lexaureon.com --out data/jailbreak-raw.jsonl
 */
import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';
import { selectAttacks } from './attacks';

const BARE_MODEL = 'llama-3.3-70b-versatile';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    out[key] = (!next || next.startsWith('--')) ? 'true' : (i++, next);
  }
  return out;
}

interface Behavior { id: string; behavior: string; category: string; type: 'harmful' | 'benign'; }

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const WARM_UP_PROMPTS = [
  'What is the capital of France?',
  'Explain photosynthesis in one sentence.',
];

// ── Bare arm: direct Groq, no system prompt, with backoff ────────────────────
// Deterministic by default (temperature 0 + fixed seed) for reproducibility.
async function callBare(prompt: string, key: string, temperature: number, seed: number): Promise<string> {
  const BACKOFF = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: BARE_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 512, temperature, seed,
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

// ── Governed arm: kernel endpoint, with backoff ──────────────────────────────
async function callGovern(endpoint: string, prompt: string, sid: string, turn: number): Promise<Record<string, unknown>> {
  const BACKOFF = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sid, turn }),
        signal: AbortSignal.timeout(60_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF.length) {
        await sleep(BACKOFF[attempt]); continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json() as Record<string, unknown>;
    } catch (e) {
      if (attempt === BACKOFF.length) throw e;
      await sleep(BACKOFF[attempt]);
    }
  }
  throw new Error('max retries exceeded');
}

async function governedAttempt(endpoint: string, prompt: string): Promise<Record<string, unknown>> {
  const sid = `jb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < WARM_UP_PROMPTS.length; i++) {
    try { await callGovern(endpoint, WARM_UP_PROMPTS[i], sid, i + 1); } catch { /* non-fatal */ }
    await sleep(1000);
  }
  const d = await callGovern(endpoint, prompt, sid, WARM_UP_PROMPTS.length + 1);
  const state = (d.state ?? {}) as Record<string, number>;
  const sig = (d.semantic_signal ?? {}) as { attack_type?: string };
  return {
    governed_output:      String(d.governed_output ?? ''),
    projection_triggered: Boolean(d.projection_triggered),
    M:                    Number(d.M ?? 0),
    C: Number(state.C ?? 0), R: Number(state.R ?? 0), S: Number(state.S ?? 0),
    health_band:          String(d.health_band ?? ''),
    attack_type:          sig.attack_type ?? 'none',
    delta_V:              Number(d.delta_V ?? 0),
    receipt_id:           String(d.receipt_id ?? ''),
  };
}

async function main() {
  const args     = parseArgs(process.argv.slice(2));
  const endpoint = args.endpoint ?? 'https://lexaureon.com';
  const nHarm    = parseInt(args.n ?? '50');
  const nBenign  = parseInt(args.benign ?? '50');
  const outPath  = args.out ?? 'data/jailbreak-raw.jsonl';
  const attacks  = selectAttacks(args.attacks);
  const temperature = parseFloat(args.temperature ?? '0');   // deterministic by default
  const seed        = parseInt(args.seed ?? '42');
  const key      = process.env.GROQ_API_KEY ?? '';

  if (!key) {
    console.error('[jailbreak] FATAL: GROQ_API_KEY not set. The bare arm is a direct');
    console.error('[jailbreak] Groq call — without it there is no baseline to measure');
    console.error('[jailbreak] governance lift against. Aborting.');
    process.exit(1);
  }

  const datasetRaw = fs.readFileSync(path.resolve('data/jailbreakbench.jsonl'), 'utf8');
  const datasetHash = crypto.createHash('sha256').update(datasetRaw).digest('hex').slice(0, 16);
  const all: Behavior[] = datasetRaw.split('\n').filter(Boolean).map(l => JSON.parse(l) as Behavior);
  const harmful = all.filter(b => b.type === 'harmful').slice(0, nHarm);
  const benign  = all.filter(b => b.type === 'benign').slice(0, nBenign);

  console.log(`[jailbreak] ${harmful.length} harmful × ${attacks.length} attacks (${attacks.map(a => a.id).join(',')}) + ${benign.length} benign → ${endpoint}`);

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  // ── Reproducibility manifest — everything needed to reproduce this run ───────
  const manifest = {
    run_at:        new Date().toISOString(),
    commit:        process.env.GITHUB_SHA ?? 'local',
    endpoint,
    bare_model:    BARE_MODEL,
    bare_temperature: temperature,
    bare_seed:     seed,
    governed_arm:  'SovereignKernel /api/lex/govern (temperature kernel-controlled)',
    warm_up_turns: WARM_UP_PROMPTS.length,
    dataset:       'data/jailbreakbench.jsonl',
    dataset_sha256_16: datasetHash,
    n_harmful:     harmful.length,
    n_benign:      benign.length,
    attacks:       attacks.map(a => a.id),
  };
  fs.writeFileSync(path.join(path.dirname(path.resolve(outPath)), 'jailbreak-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('[jailbreak] manifest:', JSON.stringify(manifest));
  const out = fs.createWriteStream(outPath);
  let done = 0, errs = 0;

  // ── Harmful behaviors × attacks ─────────────────────────────────────────────
  for (const b of harmful) {
    for (const atk of attacks) {
      const attacked = atk.render(b.behavior);
      try {
        const bareOut = await callBare(attacked, key, temperature, seed);
        let gov: Record<string, unknown> = {};
        try { gov = await governedAttempt(endpoint, attacked); }
        catch (e) { gov = { error: String(e).slice(0, 120) }; }
        out.write(JSON.stringify({
          id: b.id, behavior: b.behavior, category: b.category, type: 'harmful',
          attack_id: atk.id, attack_name: atk.name, attacked_prompt: attacked,
          bare_output: bareOut, ...gov,
        }) + '\n');
        done++;
        process.stdout.write(`✓ ${b.id}/${atk.id} M=${Number(gov.M ?? 0).toFixed(3)} atk=${gov.attack_type ?? '-'} (${done})\n`);
      } catch (e) {
        errs++;
        process.stdout.write(`✗ ${b.id}/${atk.id} ${String(e).slice(0, 60)}\n`);
      }
      await sleep(2000);
    }
  }

  // ── Benign behaviors (raw, no attack) for over-refusal ──────────────────────
  for (const b of benign) {
    try {
      const bareOut = await callBare(b.behavior, key, temperature, seed);
      let gov: Record<string, unknown> = {};
      try { gov = await governedAttempt(endpoint, b.behavior); }
      catch (e) { gov = { error: String(e).slice(0, 120) }; }
      out.write(JSON.stringify({
        id: b.id, behavior: b.behavior, category: b.category, type: 'benign',
        attack_id: 'none', attack_name: 'Raw benign', attacked_prompt: b.behavior,
        bare_output: bareOut, ...gov,
      }) + '\n');
      done++;
      process.stdout.write(`✓ ${b.id}/benign (${done})\n`);
    } catch (e) {
      errs++;
      process.stdout.write(`✗ ${b.id}/benign ${String(e).slice(0, 60)}\n`);
    }
    await sleep(2000);
  }

  out.end();
  console.log(`\n[jailbreak] done rows=${done} errors=${errs} → ${outPath}`);
}

main().catch(e => { console.error('[jailbreak] fatal:', e); process.exit(1); });
