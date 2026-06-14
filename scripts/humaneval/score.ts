/**
 * HumanEval Scorer
 *
 * Aggregates HumanEval results and computes pass rates.
 *
 * Usage:
 *   npm run humaneval:score -- --file data/humaneval-results-1234567890.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      out[key] = !next || next.startsWith('--') ? 'true' : (i++, next);
    }
  }
  return out;
}

interface HumanEvalResult {
  task_id: string;
  bare_passed: boolean;
  governed_passed: boolean;
  duration_ms: number;
  error?: string;
}

async function scoreResults() {
  const args = parseArgs(process.argv.slice(2));
  let file = args.file;

  // If no file specified, find the most recent
  if (!file) {
    const dataDir = 'data';
    if (!fs.existsSync(dataDir)) {
      console.error('[score] No data directory found');
      process.exit(1);
    }
    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('humaneval-results-'));
    if (!files.length) {
      console.error('[score] No humaneval results found');
      process.exit(1);
    }
    file = path.join(dataDir, files.sort().pop()!);
  }

  console.log(`[score] Reading ${file}...`);
  const content = fs.readFileSync(file, 'utf8');
  const results: HumanEvalResult[] = content.split('\n').filter(Boolean).map(l => JSON.parse(l));

  const barePass = results.filter(r => r.bare_passed).length;
  const govPass = results.filter(r => r.governed_passed).length;
  const errors = results.filter(r => r.error).length;
  const totalDuration = results.reduce((s, r) => s + r.duration_ms, 0);

  const bareRate = (barePass / results.length * 100).toFixed(2);
  const govRate = (govPass / results.length * 100).toFixed(2);
  const delta = (parseFloat(govRate) - parseFloat(bareRate)).toFixed(2);

  console.log(`\n[score] HumanEval Results (${results.length} tasks)`);
  console.log(`  Bare pass rate:     ${bareRate}% (${barePass}/${results.length})`);
  console.log(`  Governed pass rate: ${govRate}% (${govPass}/${results.length})`);
  console.log(`  Delta:              ${delta}pp`);
  console.log(`  Errors:             ${errors}`);
  console.log(`  Total duration:     ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Avg per task:       ${(totalDuration / results.length).toFixed(0)}ms`);
}

scoreResults().catch(console.error);
