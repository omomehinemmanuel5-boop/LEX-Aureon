/**
 * HarmBench harness — runs adversarial prompts through Lex Aureon and saves
 * raw_output + governed_output for offline scoring.
 *
 * Usage:
 *   npm run harmbench -- --prompts data/harmbench.jsonl --n 25
 *   npm run harmbench -- --prompts data/harmbench.jsonl --endpoint http://localhost:3000
 *   npm run harmbench -- --prompts data/harmbench.jsonl --bare  # also probe ungoverned Groq baseline
 *
 * Prompts file: one JSON object per line with at least { id, behavior, category? }.
 * Download HarmBench from https://huggingface.co/datasets/walledai/HarmBench
 * and convert to JSONL — never commit the file to git.
 *
 * Output: data/harmbench-results-<timestamp>.jsonl, one row per prompt:
 *   { id, behavior, category, anchored_output, governed_output, blocked,
 *     bare_output?, crs, metrics, duration_ms }
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
  anchored_output: string;
  governed_output: string;
  blocked:         boolean;
  bare_output?:    string;
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

async function callLexRun(endpoint: string, behavior: string, sessionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint}/api/lex/run`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ prompt: behavior, session_id: sessionId }),
    signal:  AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return await res.json() as Record<string, unknown>;
}

async function callGroqBare(behavior: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: behavior }],
      max_tokens:  512,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const promptsPath = (args.prompts as string) ?? 'data/harmbench.jsonl';
  const endpoint   = (args.endpoint as string) ?? process.env.LEX_ENDPOINT ?? 'https://lexaureon.com';
  const n          = args.n ? parseInt(args.n as string, 10) : undefined;
  const probeBare  = !!args.bare;
  const outPath    = (args.out as string) ??
    `data/harmbench-results-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

  if (probeBare && !process.env.GROQ_API_KEY) {
    throw new Error('--bare requires GROQ_API_KEY in env');
  }

  const prompts = await loadPrompts(promptsPath, n);
  console.log(`[harmbench] ${prompts.length} prompts → ${endpoint}`);
  console.log(`[harmbench] output → ${outPath}`);
  console.log(`[harmbench] bare baseline: ${probeBare ? 'yes' : 'no'}\n`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath, { flags: 'a' });

  const sessionPrefix = `hb_${Date.now().toString(36)}`;
  let ok = 0, errs = 0, blocked = 0;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const t0 = Date.now();
    const sessionId = `${sessionPrefix}_${p.id}`;
    let row: ResultRow = {
      ...p,
      anchored_output: '',
      governed_output: '',
      blocked:         false,
      duration_ms:     0,
    };
    try {
      const response = await callLexRun(endpoint, p.behavior, sessionId);
      row.anchored_output = (response.raw_output as string) ?? '';
      row.governed_output = (response.governed_output as string) ?? '';
      row.blocked         = Boolean(response.blocked);
      row.crs             = response.crs_after as Record<string, number>;
      row.metrics         = response.metrics as Record<string, unknown>;
      row.intervention    = response.intervention as Record<string, unknown>;
      if (row.blocked) blocked++;
      if (probeBare) {
        try { row.bare_output = await callGroqBare(p.behavior, process.env.GROQ_API_KEY!); }
        catch (e) { row.bare_output = `[bare error: ${String(e).slice(0, 100)}]`; }
      }
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
