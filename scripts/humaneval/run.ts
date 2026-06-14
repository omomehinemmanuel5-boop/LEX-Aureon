/**
 * HumanEval Runner
 *
 * Runs the HumanEval benchmark against Lex Aureon.
 * Measures code generation quality under constitutional governance.
 *
 * Usage:
 *   npm run humaneval -- --n 10
 *   npm run humaneval -- --n 164 --endpoint https://lexaureon.com
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadHumanEvalDataset, getTaskSubset, type HumanEvalTask } from './dataset';
import { judgeCode, type JudgeResult } from './judge';

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

interface HumanEvalResult extends HumanEvalTask {
  bare_output: string;
  governed_output: string;
  bare_passed: boolean;
  governed_passed: boolean;
  duration_ms: number;
  error?: string;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function callGovern(endpoint: string, prompt: string, sessionId: string) {
  const RETRIES = [15_000, 30_000, 60_000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId }),
      });

      if (!res.ok) {
        if (res.status === 429 && attempt < RETRIES.length) {
          const delay = RETRIES[attempt];
          console.log(`  [429] Rate limited, waiting ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      return {
        governed_output: data.response || data.governed_output || '',
        raw_output: data.raw_output || '',
      };
    } catch (e) {
      if (attempt < RETRIES.length) {
        const delay = RETRIES[attempt];
        console.log(`  Error: ${e}, retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw e;
      }
    }
  }
  throw new Error('All retries exhausted');
}

async function runBenchmark() {
  const args = parseArgs(process.argv.slice(2));
  const n = parseInt(args.n || '10', 10);
  const endpoint = args.endpoint || 'http://localhost:3000';

  console.log(`[humaneval] Loading dataset...`);
  const allTasks = await loadHumanEvalDataset();
  const tasks = getTaskSubset(allTasks, n);
  console.log(`[humaneval] Running ${tasks.length} tasks against ${endpoint}`);

  const results: HumanEvalResult[] = [];
  const outputFile = path.resolve(`data/humaneval-results-${Date.now()}.jsonl`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const sessionId = `humaneval-${task.task_id}`;
    const startTime = Date.now();

    try {
      console.log(`[${i + 1}/${tasks.length}] ${task.task_id}...`);

      // Get both bare and governed responses
      const { governed_output, raw_output } = await callGovern(
        endpoint,
        `Complete this Python function:\n\n${task.prompt}`,
        sessionId,
      );

      // Judge both responses
      const bareJudge = await judgeCode(
        task.task_id,
        task.entry_point,
        raw_output,
        task.test,
      );

      const governedJudge = await judgeCode(
        task.task_id,
        task.entry_point,
        governed_output,
        task.test,
      );

      const result: HumanEvalResult = {
        ...task,
        bare_output: raw_output,
        governed_output,
        bare_passed: bareJudge.passed,
        governed_passed: governedJudge.passed,
        duration_ms: Date.now() - startTime,
      };

      results.push(result);

      // Stream to file
      fs.appendFileSync(outputFile, JSON.stringify(result) + '\n');

      console.log(
        `  bare: ${bareJudge.passed ? '✓' : '✗'} | governed: ${governedJudge.passed ? '✓' : '✗'} (${result.duration_ms}ms)`,
      );
    } catch (e) {
      const result: HumanEvalResult = {
        ...task,
        bare_output: '',
        governed_output: '',
        bare_passed: false,
        governed_passed: false,
        duration_ms: Date.now() - startTime,
        error: String(e),
      };
      results.push(result);
      fs.appendFileSync(outputFile, JSON.stringify(result) + '\n');
      console.log(`  ERROR: ${e}`);
    }
  }

  // Summary
  const barePass = results.filter(r => r.bare_passed).length;
  const govPass = results.filter(r => r.governed_passed).length;
  const bareRate = (barePass / results.length * 100).toFixed(1);
  const govRate = (govPass / results.length * 100).toFixed(1);

  console.log(`\n[humaneval] Results saved to ${outputFile}`);
  console.log(`[humaneval] Bare pass rate: ${bareRate}% (${barePass}/${results.length})`);
  console.log(`[humaneval] Governed pass rate: ${govRate}% (${govPass}/${results.length})`);
  console.log(`[humaneval] Delta: ${(parseFloat(govRate) - parseFloat(bareRate)).toFixed(1)}pp`);
}

runBenchmark().catch(console.error);
