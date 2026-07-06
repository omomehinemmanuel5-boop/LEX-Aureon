/**
 * scripts/lexbench/transform-xstest.ts
 *
 * Transform XSTest dataset from HuggingFace format to LexBench JSONL format.
 * 
 * XSTest dataset structure (HuggingFace):
 * - data/xstest-raw/xstest_v2_prompts.jsonl
 * - Each line: { "id", "prompt", "category", ... }
 *
 * Output: data/xstest.jsonl in LexBench format
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const INPUT_DIR = 'data/xstest-raw';
const OUTPUT_FILE = 'data/xstest.jsonl';

interface XSTestRecord {
  id: string;
  prompt: string;
  category: string;
  [key: string]: unknown;
}

async function transformXSTest(): Promise<void> {
  console.log('[XSTest] Starting transformation...');

  // Find the XSTest JSONL file
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
    process.exit(1);
  }

  const output = fs.createWriteStream(OUTPUT_FILE);
  let count = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(inputFile),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const record: XSTestRecord = {
        id: obj.id || obj.test_id || `xs-${count}`,
        prompt: obj.prompt || obj.text || '',
        category: obj.category || obj.type || 'unknown',
        ...obj, // Preserve all original fields
      };

      if (!record.prompt) {
        console.warn(`[XSTest] Skipping record ${record.id} — no prompt text`);
        continue;
      }

      output.write(JSON.stringify(record) + '\n');
      count++;
    } catch (err) {
      console.warn(`[XSTest] Parse error on line: ${err}`);
    }
  }

  output.end();
  console.log(`[XSTest] ✓ Transformed ${count} records → ${OUTPUT_FILE}`);
}

transformXSTest().catch((err) => {
  console.error('[XSTest] Fatal error:', err);
  process.exit(1);
});
