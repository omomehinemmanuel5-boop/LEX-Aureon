/**
 * scripts/lexbench/transform-strong-reject.ts
 *
 * Transform the StrongREJECT dataset into LexBench JSONL format.
 *
 * fix (2026-07-06): the source was pointed at ggwp/strong_reject_eval, which
 * does not appear anywhere in the StrongREJECT literature (an unverified
 * mirror). The real dataset (Souly et al. 2024, arXiv:2402.10260) is
 * distributed two ways: a gated HuggingFace mirror (walledai/StrongREJECT —
 * confirmed via the HF API to require an accepted-terms token, which a CI
 * workflow doesn't have) and the ORIGINAL AUTHORS' OWN GitHub repository,
 * hosting a plain, ungated CSV — the HF dataset card itself links to this
 * exact file as the canonical source. Switched to that: no HuggingFace CLI,
 * no auth token, straight from the paper's own authors.
 *
 * Verified schema (fetched and inspected directly): a 3-column CSV —
 * `category, source, forbidden_prompt` — 313 rows. `forbidden_prompt` is the
 * harmful behavior text.
 *
 * Output: data/strong_reject.jsonl
 */

import * as fs from 'fs';

const INPUT_FILE = 'data/strong_reject-raw/strongreject_dataset.csv';
const OUTPUT_FILE = 'data/strong_reject.jsonl';

interface StrongRejectRecord {
  id: string;
  prompt: string;
  category: string;
  source: string;
}

// Minimal RFC-4180-ish CSV line splitter — handles double-quoted fields that
// may contain embedded commas and doubled-quote escapes ("" -> "), which the
// actual dataset uses (several `forbidden_prompt` values contain commas).
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// The dataset has quoted fields that can contain literal newlines, so a
// naive line-by-line read would split one record across multiple lines.
// Reassemble physical lines into logical CSV records by tracking quote parity.
function splitIntoRecords(raw: string): string[] {
  const lines = raw.split(/\r\n|\n/);
  const records: string[] = [];
  let buffer = '';
  let quoteCount = 0;
  for (const line of lines) {
    buffer = buffer ? `${buffer}\n${line}` : line;
    quoteCount += (line.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      if (buffer.trim()) records.push(buffer);
      buffer = '';
      quoteCount = 0;
    }
  }
  if (buffer.trim()) records.push(buffer);
  return records;
}

async function transformStrongReject(): Promise<void> {
  console.log('[StrongREJECT] Starting transformation...');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('[StrongREJECT] ERROR: Input file not found:', INPUT_FILE);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
  const records = splitIntoRecords(raw);
  if (records.length < 2) {
    console.error('[StrongREJECT] ERROR: CSV appears empty or unparseable');
    process.exit(1);
  }

  const header = parseCsvLine(records[0]).map(h => h.trim().toLowerCase());
  const categoryIdx = header.indexOf('category');
  const sourceIdx   = header.indexOf('source');
  const promptIdx   = header.indexOf('forbidden_prompt');

  if (promptIdx === -1) {
    console.error(`[StrongREJECT] ERROR: expected a "forbidden_prompt" column, got: ${header.join(', ')}`);
    process.exit(1);
  }

  const output = fs.createWriteStream(OUTPUT_FILE);
  let count = 0;

  for (let i = 1; i < records.length; i++) {
    const fields = parseCsvLine(records[i]);
    const promptText = (fields[promptIdx] ?? '').trim();
    if (!promptText) continue;

    const record: StrongRejectRecord = {
      id: `sr-${count}`,
      prompt: promptText,
      category: categoryIdx >= 0 ? (fields[categoryIdx] ?? 'unknown').trim() : 'unknown',
      source: sourceIdx >= 0 ? (fields[sourceIdx] ?? '').trim() : '',
    };

    output.write(JSON.stringify(record) + '\n');
    count++;
  }

  output.end();
  console.log(`[StrongREJECT] ✓ Transformed ${count} records → ${OUTPUT_FILE}`);
  if (count === 0) {
    console.error('[StrongREJECT] ERROR: zero records produced — check the CSV format/columns.');
    process.exit(1);
  }
}

transformStrongReject().catch((err) => {
  console.error('[StrongREJECT] Fatal error:', err);
  process.exit(1);
});
