/**
 * scripts/lexbench/transform-xstest.ts
 *
 * Transform the XSTest "prompts" split into LexBench JSONL format.
 *
 * fix (2026-07-06): the source was pointed at an unverified HF mirror
 * (EvieQ01/XSTest) and the input format assumed pre-existing JSONL files.
 * Verified via the HF API that the real, widely-cited XSTest mirror
 * (natolambert/xstest-v2-copy — a community copy of Röttger et al., NAACL
 * 2024) stores its "prompts" split as parquet only: no jsonl/csv exists in
 * that repo at all. The workflow now downloads that parquet directly and
 * converts it to JSONL with a one-line Python/pandas step before this script
 * runs, so this script's INPUT format is unchanged (still JSONL) but its
 * SOURCE is now correct.
 *
 * fix (2026-07-06) — CRITICAL FILTERING BUG: the raw "prompts" split contains
 * BOTH the 250 genuinely-safe prompts (types: homonyms, safe_targets,
 * safe_contexts, definitions, figurative_language, historical_events,
 * privacy_public, privacy_fictional, nons_group_real_discr,
 * real_group_nons_discr) AND a 200-prompt "contrast" set of GENUINELY UNSAFE
 * prompts (types prefixed `contrast_`) that XSTest pairs with each safe
 * category as a control — the paper's over-refusal metric is measured ONLY
 * on the safe set; the contrast set exists so a paper can ALSO report that
 * the model still correctly refuses real harm. The previous version of this
 * script passed all 450 rows through with no filtering, which would have
 * scored genuine harmful compliance on the 200 contrast prompts as
 * "appropriate" (since the over-refusal judge only asks "did it answer or
 * refuse a BENIGN request" — it has no way to know a contrast prompt isn't
 * benign). That would have inflated the XSTest score by rewarding unsafe
 * compliance. Fixed: only rows whose `type` does NOT start with `contrast_`
 * are kept for the standard over-refusal benchmark.
 *
 * Output:
 *   data/xstest.jsonl          — 250 safe-set rows (over-refusal benchmark)
 *   data/xstest-contrast.jsonl — 200 contrast/unsafe rows (harm benchmark)
 *
 * The contrast file enables the complementary false-negative measurement:
 * given a genuinely unsafe prompt, does the governed model still comply?
 * It is scored with the harm-compliance judge (same as AdvBench/HarmBench)
 * via the xstest_contrast benchmark config in runner.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const INPUT_DIR = 'data/xstest-raw';
const OUTPUT_FILE = 'data/xstest.jsonl';
const CONTRAST_OUTPUT_FILE = 'data/xstest-contrast.jsonl';

interface XSTestRecord {
  id: string;
  prompt: string;
  category: string;
  [key: string]: unknown;
}

async function transformXSTest(): Promise<void> {
  console.log('[XSTest] Starting transformation...');

  let inputFile: string | null = null;
  if (fs.existsSync(INPUT_DIR)) {
    const files = fs.readdirSync(INPUT_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length > 0) {
      inputFile = path.join(INPUT_DIR, jsonlFiles[0]);
      console.log(`[XSTest] Found input file: ${inputFile}`);
    }
  }

  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error('[XSTest] ERROR: Could not find XSTest JSONL file in', INPUT_DIR);
    console.error('[XSTest] Expected the workflow to have converted the source parquet to JSONL first.');
    process.exit(1);
  }

  const output = fs.createWriteStream(OUTPUT_FILE);
  const contrastOutput = fs.createWriteStream(CONTRAST_OUTPUT_FILE);
  let count = 0;
  let contrastCount = 0;
  let skippedNoPrompt = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(inputFile),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const rawType = String(obj.type ?? obj.category ?? 'unknown');
      const promptText = obj.prompt || obj.text || '';

      if (!promptText) {
        skippedNoPrompt++;
        continue;
      }

      if (rawType.startsWith('contrast_')) {
        // Write the genuinely-unsafe contrast set to a separate file so it
        // can be scored with the harm-compliance judge (xstest_contrast
        // benchmark in runner.ts) rather than the appropriateness judge.
        // This gives the complementary false-negative measurement: given a
        // harmful prompt, does governance correctly refuse?
        const record: XSTestRecord = {
          id: obj.id || obj.test_id || `xsc-${contrastCount}`,
          prompt: promptText,
          category: rawType,
          ...obj,
        };
        contrastOutput.write(JSON.stringify(record) + '\n');
        contrastCount++;
        continue;
      }

      const record: XSTestRecord = {
        id: obj.id || obj.test_id || `xs-${count}`,
        prompt: promptText,
        category: rawType,
        ...obj, // Preserve all original fields (annotation_1, agreement, etc.)
      };

      output.write(JSON.stringify(record) + '\n');
      count++;
    } catch (err) {
      console.warn(`[XSTest] Parse error on line: ${err}`);
    }
  }

  output.end();
  contrastOutput.end();
  console.log(`[XSTest] ✓ Transformed ${count} safe-set records → ${OUTPUT_FILE}`);
  console.log(`[XSTest] ✓ Wrote ${contrastCount} contrast (unsafe) records → ${CONTRAST_OUTPUT_FILE} (scored separately with harm judge)`);
  if (skippedNoPrompt) console.warn(`[XSTest]   Skipped ${skippedNoPrompt} records with no prompt text`);
  if (count === 0) {
    console.error('[XSTest] ERROR: zero records survived filtering — check the input schema (expected a `type` field).');
    process.exit(1);
  }
}

transformXSTest().catch((err) => {
  console.error('[XSTest] Fatal error:', err);
  process.exit(1);
});
