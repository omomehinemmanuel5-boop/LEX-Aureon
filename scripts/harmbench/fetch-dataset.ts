/**
 * HarmBench dataset fetcher (Mazeika et al. 2024).
 *
 * Downloads the official HarmBench behaviors from the Center for AI Safety
 * repository and converts them to the JSONL shape the LexBench runner expects
 * ({ id, behavior, category }). By repo convention the prompt file is NOT
 * committed to git (see .gitignore) — it is fetched at runtime in CI and
 * locally before a benchmark run.
 *
 * Source: https://github.com/centerforaisafety/HarmBench
 *         data/behavior_datasets/harmbench_behaviors_text_all.csv
 *
 * By default only the "standard" functional category is written — that is the
 * canonical text attack-success-rate set. Pass --all to include every
 * functional category (standard + contextual + copyright).
 *
 * Usage:
 *   npx tsx scripts/harmbench/fetch-dataset.ts                 # standard set
 *   npx tsx scripts/harmbench/fetch-dataset.ts --all           # all categories
 *   npx tsx scripts/harmbench/fetch-dataset.ts --out data/harmbench.jsonl
 *
 * fix (2026-07-09) — HTTP 429 KILLED THE 2026-07-09 SCHEDULED PROD RUN: this
 * script previously made a single unretried fetch() to raw.githubusercontent.com
 * and threw immediately on any non-2xx status, including 429 (rate limit —
 * a "retry shortly" signal, not a real failure). lexbench-prod.yml calls this
 * script once in determine-shards AND once again in every shard job (up to
 * ~5-10 for a full run), all hitting the identical URL within a short window
 * on shared GitHub Actions runner infrastructure — a repeated-request pattern
 * that is exactly what trips rate limits, independent of anything specific to
 * this repo. Added retry with exponential backoff + jitter, honoring the
 * Retry-After header when the server sends one. This does not eliminate the
 * redundant per-shard refetching (a real, separate inefficiency — see
 * lexbench-extended.yml's fetch-datasets job for the better pattern: fetch
 * once, pass via actions/upload-artifact + download-artifact — that
 * restructuring of lexbench-prod.yml is a larger, separate change, not done
 * here), but makes a transient 429 recoverable rather than run-ending.
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/centerforaisafety/HarmBench/main/' +
  'data/behavior_datasets/harmbench_behaviors_text_all.csv';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry on 429/5xx. Honors Retry-After (seconds or HTTP-date) when
 * present; otherwise exponential backoff with jitter, capped at MAX_DELAY_MS.
 * Non-retryable statuses (e.g. 404) fail immediately — no point retrying those.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;

      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error(`Failed to fetch HarmBench CSV: HTTP ${res.status}`);
      }

      let delayMs: number;
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        const asSeconds = Number(retryAfter);
        delayMs = Number.isFinite(asSeconds)
          ? asSeconds * 1000
          : Math.max(0, new Date(retryAfter).getTime() - Date.now());
      } else {
        delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
      }
      delayMs = Math.min(delayMs, MAX_DELAY_MS) + Math.random() * 500; // jitter

      console.log(`[harmbench] HTTP ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${Math.round(delayMs)}ms...`);
      await sleep(delayMs);
    } catch (e) {
      lastError = e;
      if (attempt === MAX_ATTEMPTS) throw e;
      const delayMs = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS) + Math.random() * 500;
      console.log(`[harmbench] fetch error (attempt ${attempt}/${MAX_ATTEMPTS}): ${e} — retrying in ${Math.round(delayMs)}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error('fetchWithRetry: exhausted attempts');
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

/** Minimal RFC-4180 CSV parser — handles quoted fields, embedded commas,
 *  doubled quotes, and \r\n / \n line endings. Returns rows of string cells. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = (args.out as string) ?? 'data/harmbench.jsonl';
  const includeAll = Boolean(args.all);

  console.log(`[harmbench] Fetching official HarmBench behaviors from CfAS...`);
  const res = await fetchWithRetry(SOURCE_URL);
  const csv = await res.text();

  const rows = parseCSV(csv);
  const header = rows.shift();
  if (!header) throw new Error('Empty CSV');
  const col = (name: string) => header.findIndex(h => h.trim() === name);
  const iBehavior = col('Behavior');
  const iFunc     = col('FunctionalCategory');
  const iSemantic = col('SemanticCategory');
  const iId       = col('BehaviorID');
  if (iBehavior < 0 || iId < 0) {
    throw new Error(`Unexpected HarmBench columns: ${header.join(', ')}`);
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const stream = fs.createWriteStream(outPath);
  let written = 0, skipped = 0;
  for (const r of rows) {
    const behavior = (r[iBehavior] ?? '').trim();
    const func     = (r[iFunc] ?? '').trim();
    if (!behavior) { skipped++; continue; }
    if (!includeAll && func && func !== 'standard') { skipped++; continue; }
    stream.write(JSON.stringify({
      id:       (r[iId] ?? `hb-${written}`).trim(),
      behavior,
      category: (r[iSemantic] ?? 'harmbench').trim() || 'harmbench',
    }) + '\n');
    written++;
  }
  stream.end();

  console.log(`[harmbench] Wrote ${written} behaviors → ${outPath} (${includeAll ? 'all categories' : 'standard only'}, skipped ${skipped})`);
  if (written === 0) throw new Error('No behaviors written — aborting');
}

main().catch(e => { console.error('[harmbench] fatal:', e); process.exit(1); });
