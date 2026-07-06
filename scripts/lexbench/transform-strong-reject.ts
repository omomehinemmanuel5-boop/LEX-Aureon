/**
 * scripts/lexbench/transform-strong-reject.ts
 *
 * Transform StrongREJECT dataset from HuggingFace format to LexBench JSONL format.
 * 
 * StrongREJECT dataset structure (HuggingFace):
 * - data/strong_reject-raw/*.jsonl files
 * - Each line: { "id", "prompt", "harmful_behavior", "category", ... }
 *
 * Output: data/strong_reject.jsonl in LexBench format
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const INPUT_DIR = 'data/strong_reject-raw';
const OUTPUT_FILE = 'data/strong_reject.jsonl';

interface StrongRejectRecord {
  id: string;
  prompt: string;
  category?: string;
  [key: string]: unknown;
}

async function transformStrongReject(): Promise<void> {
  console.log('[StrongREJECT] Starting transformation...');

  if (!fs.existsSync(INPUT_DIR)) {
    console.error('[StrongREJECT] ERROR: Input directory not found:', INPUT_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(INPUT_DIR);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

  if (jsonlFiles.length === 0) {
    console.error('[StrongREJECT] ERROR: No JSONL files found in', INPUT_DIR);
    process.exit(1);
  }

  console.log(`[StrongREJECT] Found ${jsonlFiles.length} JSONL file(s)`);

  const output = fs.createWriteStream(OUTPUT_FILE);
  let count = 0;

  for (const file of jsonlFiles) {
    const inputFile = path.join(INPUT_DIR, file);
    console.log(`[StrongREJECT] Processing: ${file}`);

    const rl = readline.createInterface({
      input: fs.createReadStream(inputFile),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        
        // StrongREJECT uses "harmful_behavior" or "prompt"
        const promptText = obj.prompt || obj.harmful_behavior || obj.text || '';
        
        if (!promptText) {
          console.warn(`[StrongREJECT] Skipping record — no prompt text`);
          continue;
        }

        const record: StrongRejectRecord = {
          id: obj.id || obj.test_id || `sr-${count}`,
          prompt: promptText,
          category: obj.category || obj.type || 'unknown',
          ...obj, // Preserve all original fields
        };

        output.write(JSON.stringify(record) + '\n');
        count++;
      } catch (err) {
        console.warn(`[StrongREJECT] Parse error: ${err}`);
      }
    }
  }

  output.end();
  console.log(`[StrongREJECT] ✓ Transformed ${count} records → ${OUTPUT_FILE}`);
}

transformStrongReject().catch((err) => {
  console.error('[StrongREJECT] Fatal error:', err);
  process.exit(1);
});
