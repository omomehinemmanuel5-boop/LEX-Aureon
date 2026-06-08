/**
 * HarmBench harness — runs adversarial prompts through Lex Aureon and saves
 * all three arms (bare / anchored / governed) for offline scoring.
 *
 * Since /api/lex/run now returns all three arms in a single response
 * (raw_output = bare, anchored_output = constitutional, governed_output =
 * PRAXIS), the harness no longer needs to make a separate Groq call for
 * the bare baseline.
 *
 * Usage:
 *   npm run harmbench -- --prompts data/harmbench.jsonl --n 25
 *   npm run harmbench -- --prompts data/harmbench.jsonl --endpoint http://localhost:3000
 *
 * Prompts file: one JSON object per line with at least { id, behavior, category? }.
 * Download HarmBench from https://huggingface.co/datasets/walledai/HarmBench
 * and convert to JSONL — never commit the file to git.
 *
 * Output: data/harmbench-results-<timestamp>.jsonl, one row per prompt:
 *   { id, behavior, category, bare_output, anchored_output, governed_output,
 *     blocked, crs, metrics, duration_ms }
 *
 * Score with: npm run harmbench:score -- --in data/harmbench-results-*.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface PromptRow {
  id:        string;
  behavior:  string;
  category?: string;
}

interface ResultRow extends PromptRow {
  bare_output:     string;
  anchored_output: string;
  governed_output: string;
  blocked:         boolean;
  metrics?:        Record<string, unknown>;
  crs?:            Record<string, number>;
  intervention?:   Record<string, unknown>;
  error?:          string;
  duration_ms:     number;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

async function loadPrompts(file: string, limit?: number): Promise<PromptRow[]> {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Prompts file not found: ${file}\n` +
      `Download HarmBench from https://huggingface.co/datasets/walledai/HarmBench\n` +
      `and save behaviors as JSONL ({id, behavior, category?}) at this path.`
    );
  }
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const rows: PromptRow[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Partial<PromptRow>;
      if (!row.id || !row.behavior) continue;
      rows.push({ id: row.id, behavior: row.behavior, category: row.category });
      if (limit && rows.length >= limit) break;
    } catch {
      // skip malformed lines silently — partial datasets are common
    }
  }
  return rows;
}

const RETRY_DELAYS = [30_000, 60_000, 120_000]; // ms between retries — token bucket needs time to refill

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callLexRun(
  endpoint: string,
  behavior: string,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useKernel = false,
): Promise<Record<string, unknown>> {
  const route = '/api/lex/govern'; // unified endpoint — all agents
  const body  = JSON.stringify({ prompt: behavior, session_id: sessionId, turn: 1 });

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const res = await fetch(`${endpoint}${route}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(90_000),
    });

    if (res.status === 429 && attempt < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[attempt];
      process.stdout.write(` [rate-limit, retry in ${delay / 1000}s]`);
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }

    return res.json() as Promise<Record<string, unknown>>;
  }

  throw new Error('Max retries exceeded after rate limiting');
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  const promptsPath = (args.prompts as string) ?? 'data/harmbench.jsonl';
  const endpoint   = (args.endpoint as string) ?? process.env.LEX_ENDPOINT ?? 'https://lexaureon.com';
  const useKernel  = !(args['no-kernel'] as boolean) && (!(args.kernel as boolean) || process.env.HARMBENCH_USE_KERNEL !== '0');
  console.log(useKernel 
    ? '[harmbench] ⚡ Unified pipeline — /api/lex/govern (all 10 agents · constitutional judge)'
    : '[harmbench] Unified pipeline — /api/lex/govern');
  const n          = args.n ? parseInt(args.n as string, 10) : undefined;
  const outPath    = (args.out as string) ??
    `data/harmbench-results-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

  const prompts = await loadPrompts(promptsPath, n);
  console.log(`[harmbench] ${prompts.length} prompts → ${endpoint}`);
  console.log(`[harmbench] output → ${outPath}\n`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath, { flags: 'a' });

  const sessionPrefix = `hb_${Date.now().toString(36)}`;
  let ok = 0, errs = 0, blocked = 0;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const t0 = Date.now();
    const sessionId = `${sessionPrefix}_${p.id}`;
    const row: ResultRow = {
      ...p,
      bare_output:     '',
      anchored_output: '',
      governed_output: '',
      blocked:         false,
      duration_ms:     0,
    };
    try {
      // 5s delay — governed arm on Gemini (1,000 RPM), raw arm on Groq 70b (graceful on 429)
      // 200 × 5s = ~17 min. Raw baseline may degrade after ~40 prompts; governed 200/200.
      if (i > 0) await sleep(5000);
      const response = await callLexRun(endpoint, p.behavior, sessionId, useKernel);
      row.bare_output     = (response.raw_output as string)      ?? '';
      row.anchored_output = (response.anchored_output as string) ?? '';
      row.governed_output = (response.governed_output as string) ?? '';
      row.blocked         = Boolean(response.blocked);
      row.crs             = response.crs_after as Record<string, number>;
      row.metrics         = response.metrics as Record<string, unknown>;
      row.intervention    = response.intervention as Record<string, unknown>;
      if (row.blocked) blocked++;
      ok++;
    } catch (e) {
      row.error = String(e).slice(0, 200);
      errs++;
    }
    row.duration_ms = Date.now() - t0;
    out.write(JSON.stringify(row) + '\n');

    const tag = row.error ? '✗' : row.blocked ? '⛔' : '✓';
    process.stdout.write(`\r[${i + 1}/${prompts.length}] ${tag} ok=${ok} blocked=${blocked} err=${errs}    `);
  }

  out.end();
  console.log(`\n\n[harmbench] done. Score with:`);
  console.log(`  npm run harmbench:score -- --in ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
