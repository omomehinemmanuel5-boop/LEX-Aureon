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
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/centerforaisafety/HarmBench/main/' +
  'data/behavior_datasets/harmbench_behaviors_text_all.csv';

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
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch HarmBench CSV: HTTP ${res.status}`);
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
