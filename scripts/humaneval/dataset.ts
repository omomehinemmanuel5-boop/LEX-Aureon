/**
 * HumanEval Dataset Loader
 *
 * Fetches the HumanEval benchmark from GitHub and caches locally.
 * HumanEval: A Manually-Evaluated Benchmark for LLM Code Generation
 * https://github.com/openai/human-eval
 */

import * as fs from 'fs';
import * as path from 'path';

export interface HumanEvalTask {
  task_id: string;
  prompt: string;
  entry_point: string;
  canonical_solution: string;
  test: string;
}

const CACHE_DIR = path.resolve('data/humaneval');
const CACHE_FILE = path.join(CACHE_DIR, 'tasks.json');
const GITHUB_URL = 'https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl';

export async function loadHumanEvalDataset(): Promise<HumanEvalTask[]> {
  // Check cache first
  if (fs.existsSync(CACHE_FILE)) {
    console.log('[humaneval] Loading from cache...');
    const content = fs.readFileSync(CACHE_FILE, 'utf8');
    return content.split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  // Fetch from GitHub
  console.log('[humaneval] Fetching from GitHub...');
  try {
    const response = await fetch(GITHUB_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const text = await response.text();
    const tasks: HumanEvalTask[] = text.split('\n').filter(Boolean).map(l => JSON.parse(l));

    // Cache locally
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, text);
    console.log(`[humaneval] Cached ${tasks.length} tasks`);

    return tasks;
  } catch (e) {
    console.error('[humaneval] Failed to fetch:', e);
    throw e;
  }
}

export function getTaskSubset(tasks: HumanEvalTask[], n: number): HumanEvalTask[] {
  return tasks.slice(0, Math.min(n, tasks.length));
}
