/**
 * LexBench v1 Stability Engine — Unified Benchmark Runner
 *
 * Consolidates TruthfulQA, HarmBench, JailbreakBench, AdvBench, and AgentDojo
 * into a single framework with standardized output format.
 *
 * fix (2026-07-05) — GROUNDED, FIELD-STANDARD SCORING: scoring previously used
 * a bag-of-words term-frequency cosine similarity (lib/aureonics_math.ts
 * computeCCP/computeIEC) between the PROMPT and the OUTPUT, mislabeled
 * "truth_score" and "toxicity" — neither measured truthfulness or toxicity at
 * all, only vocabulary overlap with the question, which systematically
 * penalizes governed refusals/hedges regardless of correctness. Scoring now
 * dispatches to scripts/lexbench/grounded_judge.ts, using the closest
 * practical approximation of each benchmark's actual published methodology:
 *   - AdvBench/HarmBench/JailbreakBench: an LLM judge assessing genuine
 *     harmful-content COMPLIANCE (matching the HarmBench/JailbreakBench
 *     classifier rubric structure), not refusal-keyword matching.
 *   - TruthfulQA: an LLM judge comparing the answer against the dataset's own
 *     correct_answers/incorrect_answers/best_answer ground truth — the same
 *     reference-comparison the original paper's fine-tuned GPT-judge used.
 *   - AgentDojo: an injection-resistance-only PROXY judge, explicitly NOT the
 *     official dual utility+security methodology (no tool-execution harness
 *     exists here) — see grounded_judge.ts's LIMITATIONS block.
 * This is materially slower (each prompt now makes 2 additional judge calls,
 * bare + governed) and uses more Groq quota than the previous instant local
 * calculation — an accepted tradeoff for actually measuring what the
 * published metric names claim to measure.
 *
 * NOTE on the bare arm: both bare_metrics and governed_metrics are judged from
 * outputs taken from the SAME /api/lex/govern response — i.e. the same
 * underlying model (generateGoverned), same moment, the only difference being
 * governance. This is the correct same-model comparison; the delta isolates
 * governance, not model choice.
 *
 * SESSION TAGGING (2026-07): sessions are tagged with a distinguishable
 * `lexbench-` prefix instead of the `session-<ms>` format the real
 * console/chat frontend generates, so /api/stats can exclude synthetic eval
 * traffic from the public "canonical receipt total".
 *
 * fix (2026-07-04) — CRITICAL: shard-index=0 falsy-zero bug. Args derived with
 * `args.X ? args.X : undefined` incorrectly coerced shard-index=0 (every
 * quick-test run, and shard 0 of every normal run) to undefined, skipping
 * slicing and running the entire dataset. Fixed by checking `!== undefined`.
 *
 * Usage:
 *   npm run lexbench -- --benchmark truthfulqa --n 50
 *   npm run lexbench -- --benchmark harmbench --n 100 --endpoint http://localhost:3000
 *   npm run lexbench -- --benchmark all --n 50
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Real-time evaluation imports
import { CacheManager } from '../../lib/cost_optimizer';
import { runRealAureonicsMath } from '../../lib/aureonics_math';
import {
  judgeHarmCompliance, judgeTruthfulness, judgeInjectionResistanceProxy,
} from './grounded_judge';

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────

interface OutputMetrics {
  // Each field is null when not applicable to this benchmark (never a guessed
  // 0/1) — see grounded_judge.ts. Exactly one of asr/truthful/injection_resisted
  // is non-null per benchmark type.
  asr: number | null;                 // attack-style benchmarks: 1=attack succeeded, 0=resisted
  truthful: number | null;            // TruthfulQA: 1=truthful per reference answers, 0=not
  injection_resisted: number | null;  // AgentDojo (PROXY, see grounded_judge.ts): 1=resisted, 0=complied
  judge_method: string;               // which judge/fallback actually produced this score
}

interface LexBenchResult {
  benchmark: string;
  prompt_id: string;
  prompt: string;
  raw_output: string;
  governed_output: string;
  bare_metrics: OutputMetrics;
  governed_metrics: OutputMetrics;
  lex_metrics: {
    C: number;
    R: number;
    S: number;
    M: number;
  };
  intervention: boolean;
  timestamp: string;
  duration_ms: number;
  error?: string;
}

interface PromptRecord {
  id: string;
  prompt: string;
  [key: string]: unknown;
}

interface BenchmarkConfig {
  name: string;
  kind: 'harm' | 'truthfulness' | 'injection';
  dataFile: string;
  parser: (line: string) => PromptRecord;
  limit?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Argument Parsing
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];

    if (key === 'n' || key === 'shard-index' || key === 'shard-size') {
      if (next && !next.startsWith('--')) {
        out[key] = parseInt(next, 10);
        i++;
      } else {
        out[key] = true; // Default to true if no value provided for numeric flag
      }
    } else if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Benchmark Parsers
// ────────────────────────────────────────────────────────────────────────────

const BENCHMARK_CONFIGS: Record<string, BenchmarkConfig> = {
  truthfulqa: {
    name: 'TruthfulQA',
    kind: 'truthfulness',
    dataFile: 'data/truthfulqa.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `tqa-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.behavior || obj.question || '',
        ...obj,
      };
    },
  },
  harmbench: {
    name: 'HarmBench',
    kind: 'harm',
    dataFile: 'data/harmbench.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `hb-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.behavior || obj.prompt || '',
        ...obj,
      };
    },
  },
  jailbreakbench: {
    name: 'JailbreakBench',
    kind: 'harm',
    dataFile: 'data/jailbreakbench.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `jbb-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.jailbreak || obj.behavior || '',
        ...obj,
      };
    },
  },
  advbench: {
    name: 'AdvBench',
    kind: 'harm',
    dataFile: 'data/advbench.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `adv-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.behavior || '',
        ...obj,
      };
    },
  },
  agentdojo: {
    name: 'AgentDojo',
    kind: 'injection',
    dataFile: 'data/agentdojo.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `ad-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.task || obj.behavior || '',
        ...obj,
      };
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Load Prompts from JSONL
// ────────────────────────────────────────────────────────────────────────────

async function loadPrompts(
  file: string,
  parser: (line: string) => PromptRecord,
  limit?: number,
): Promise<PromptRecord[]> {
  const prompts: PromptRecord[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = parser(line);
      prompts.push(parsed);
      if (limit && prompts.length >= limit) break;
    } catch (err) {
      console.warn(`[WARN] Failed to parse line: ${err}`);
    }
  }

  return prompts;
}

// ────────────────────────────────────────────────────────────────────────────
// Call Lex Aureon Governance API
// ────────────────────────────────────────────────────────────────────────────

async function callGovernAPI(
  endpoint: string,
  prompt: string,
  sessionId: string,
): Promise<{
  raw_output: string;
  governed_output: string;
  crs?: Record<string, number>;
  intervention?: boolean;
  error?: string;
}> {
  const RETRIES = [5000, 10000, 20000];
  for (let attempt = 0; attempt <= RETRIES.length; attempt++) {
    try {
      const res = await fetch(`${endpoint}/api/lex/govern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId }),
      });

      if (!res.ok) {
        if (attempt < RETRIES.length) {
          const delay = RETRIES[attempt];
          console.warn(
            `[WARN] API returned ${res.status}, retrying in ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return {
          raw_output: '',
          governed_output: '',
          error: `HTTP ${res.status}`,
        };
      }

      const data = await res.json();
      const state = data.crs ?? data.state;
      return {
        raw_output: data.raw_output || data.bare_output || '',
        governed_output: data.governed_output || data.anchored_output || '',
        crs: state ? {
          C: Number(state.C ?? state.c ?? 0),
          R: Number(state.R ?? state.r ?? 0),
          S: Number(state.S ?? state.s ?? 0),
          M: Number(state.M ?? state.m ?? Math.min(
            Number(state.C ?? state.c ?? 0),
            Number(state.R ?? state.r ?? 0),
            Number(state.S ?? state.s ?? 0),
          )),
        } : undefined,
        intervention: Boolean(data.intervention ?? data.projection_triggered ?? data.suspension_triggered),
      };
    } catch (err) {
      if (attempt < RETRIES.length) {
        const delay = RETRIES[attempt];
        console.warn(`[WARN] Request failed: ${err}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return {
        raw_output: '',
        governed_output: '',
        error: String(err),
      };
    }
  }

  return {
    raw_output: '',
    governed_output: '',
    error: 'Max retries exceeded',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Grounded scoring dispatch — one judge type per benchmark kind
// ────────────────────────────────────────────────────────────────────────────

async function scoreOutput(
  config: BenchmarkConfig,
  promptRecord: PromptRecord,
  output: string,
): Promise<OutputMetrics> {
  const empty: OutputMetrics = { asr: null, truthful: null, injection_resisted: null, judge_method: 'empty-output' };
  if (!output) return empty;

  if (config.kind === 'truthfulness') {
    const correct   = Array.isArray(promptRecord.correct_answers)   ? promptRecord.correct_answers as string[]   : [];
    const incorrect = Array.isArray(promptRecord.incorrect_answers) ? promptRecord.incorrect_answers as string[] : [];
    const best      = typeof promptRecord.best_answer === 'string'  ? promptRecord.best_answer : undefined;
    const { verdict, method } = await judgeTruthfulness(promptRecord.prompt, output, correct, incorrect, best);
    return { asr: null, truthful: verdict === null ? null : (verdict ? 1 : 0), injection_resisted: null, judge_method: method };
  }

  if (config.kind === 'injection') {
    const injectionGoal = typeof promptRecord.injection_goal === 'string' ? promptRecord.injection_goal : promptRecord.prompt;
    const { verdict, method } = await judgeInjectionResistanceProxy(injectionGoal, output);
    return { asr: null, truthful: null, injection_resisted: verdict === null ? null : (verdict ? 1 : 0), judge_method: method };
  }

  // 'harm' — AdvBench, HarmBench, JailbreakBench
  const target = typeof promptRecord.target === 'string' ? promptRecord.target : undefined;
  const { verdict, method } = await judgeHarmCompliance(promptRecord.prompt, output, target);
  return { asr: verdict === null ? null : (verdict ? 1 : 0), truthful: null, injection_resisted: null, judge_method: method };
}

// ────────────────────────────────────────────────────────────────────────────
// Extract CRS Metrics from API Response
// ────────────────────────────────────────────────────────────────────────────

function extractCRSMetrics(
  crs?: Record<string, number>,
): { C: number; R: number; S: number; M: number } {
  const C = crs?.C ?? 0.0;
  const R = crs?.R ?? 0.0;
  const S = crs?.S ?? 0.0;
  const M = Math.min(C, R, S);
  return { C, R, S, M };
}

// ────────────────────────────────────────────────────────────────────────────
// Run Benchmark
// ────────────────────────────────────────────────────────────────────────────

async function runBenchmark(
  benchmarkName: string,
  endpoint: string,
  limit?: number,
  shardIndex?: number,
  shardSize?: number,
): Promise<LexBenchResult[]> {
  const cacheManager = new CacheManager();
  const config = BENCHMARK_CONFIGS[benchmarkName.toLowerCase()];
  if (!config) {
    throw new Error(
      `Unknown benchmark: ${benchmarkName}. Available: ${Object.keys(BENCHMARK_CONFIGS).join(', ')}`,
    );
  }

  console.log(`\n[${config.name}] Loading prompts from ${config.dataFile}...`);
  const prompts = await loadPrompts(config.dataFile, config.parser, limit);
  console.log(`[${config.name}] Loaded ${prompts.length} prompts.`);

  let promptsToRun = prompts;
  if (shardIndex !== undefined && shardSize !== undefined) {
    const startIndex = shardIndex * shardSize;
    const endIndex = Math.min(startIndex + shardSize, prompts.length);
    promptsToRun = prompts.slice(startIndex, endIndex);
    console.log(`[${config.name}] Running shard ${shardIndex} (prompts ${startIndex}-${endIndex - 1} of ${prompts.length}). Total prompts in shard: ${promptsToRun.length}`);
  }

  const results: LexBenchResult[] = [];
  const shardTag = shardIndex !== undefined ? `s${shardIndex}` : 's0';
  const sessionId = `lexbench-${config.name.toLowerCase()}-${shardTag}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  for (let i = 0; i < promptsToRun.length; i++) {
    const prompt = promptsToRun[i];
    const startTime = Date.now();

    // Cache keyed by benchmark; grounded-judge scores are more expensive to
    // recompute (network calls) than the old local calc, so caching matters
    // more now. Cached entries must keep real (non-legacy-shaped) metrics —
    // a cache entry from before this fix won't have the new fields and is
    // treated as a miss below.
    const cachedResult = cacheManager.get(prompt.prompt, config.name);
    const cachedHasNewShape = cachedResult
      && cachedResult.bare_metrics && 'judge_method' in cachedResult.bare_metrics;

    if (cachedResult && cachedHasNewShape) {
      console.log(`[${config.name}] Cache hit for prompt ${i + 1}/${promptsToRun.length} (ID: ${prompt.id})`);
      const derivedMath = runRealAureonicsMath(prompt.prompt, cachedResult.raw_output, cachedResult.governed_output);
      const lexMetrics = cachedResult.lex_metrics ?? { C: derivedMath.C, R: derivedMath.R, S: derivedMath.S, M: derivedMath.M };
      results.push({
        benchmark: config.name,
        prompt_id: String(prompt.id),
        prompt: prompt.prompt,
        raw_output: cachedResult.raw_output,
        governed_output: cachedResult.governed_output,
        bare_metrics: cachedResult.bare_metrics as unknown as OutputMetrics,
        governed_metrics: (cachedResult.governed_metrics ?? cachedResult.metrics) as unknown as OutputMetrics,
        lex_metrics: lexMetrics,
        intervention: cachedResult.intervention ?? lexMetrics.M < 0.08,
        timestamp: cachedResult.timestamp,
        duration_ms: 0,
      });
      continue;
    }

    try {
      console.log(`[${config.name}] Processing ${i + 1}/${promptsToRun.length} (ID: ${prompt.id})...`);

      const govResponse = await callGovernAPI(endpoint, prompt.prompt, sessionId);
      const duration = Date.now() - startTime;

      const [bareMetrics, governedMetrics] = await Promise.all([
        scoreOutput(config, prompt, govResponse.raw_output),
        scoreOutput(config, prompt, govResponse.governed_output),
      ]);
      const crsMetrics = extractCRSMetrics(govResponse.crs);

      const result: LexBenchResult = {
        benchmark: config.name,
        prompt_id: String(prompt.id),
        prompt: prompt.prompt,
        raw_output: govResponse.raw_output,
        governed_output: govResponse.governed_output,
        bare_metrics: bareMetrics,
        governed_metrics: governedMetrics,
        lex_metrics: crsMetrics,
        intervention: govResponse.intervention ?? crsMetrics.M < 0.08,
        timestamp: new Date().toISOString(),
        duration_ms: duration,
      };

      if (govResponse.error) {
        // Do not cache errors: a transient 5xx/network failure should not become
        // a permanent zero-output benchmark row on future runs.
        result.error = govResponse.error;
      } else {
        cacheManager.set(prompt.prompt, config.name, govResponse.raw_output, govResponse.governed_output, {
          bare_metrics: bareMetrics,
          governed_metrics: governedMetrics,
          lex_metrics: crsMetrics,
          intervention: result.intervention,
        });
      }

      results.push(result);
    } catch (err) {
      console.error(`[${config.name}] Error processing prompt ${i + 1}: ${err}`);
      results.push({
        benchmark: config.name,
        prompt_id: String(prompt.id),
        prompt: prompt.prompt,
        raw_output: '',
        governed_output: '',
        bare_metrics: { asr: null, truthful: null, injection_resisted: null, judge_method: 'error' },
        governed_metrics: { asr: null, truthful: null, injection_resisted: null, judge_method: 'error' },
        lex_metrics: { C: 0.0, R: 0.0, S: 0.0, M: 0.0 },
        intervention: false,
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error: String(err),
      });
    }
  }

  cacheManager.saveCache();
  console.log(`[${config.name}] Cache stats: ${JSON.stringify(cacheManager.getStats())}`);
  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Save Results to JSONL
// ────────────────────────────────────────────────────────────────────────────

function saveResults(results: LexBenchResult[], benchmarkName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = path.join(
    'data',
    `lexbench-${benchmarkName.toLowerCase()}-${timestamp}.jsonl`,
  );

  const stream = fs.createWriteStream(outputFile);
  for (const result of results) {
    stream.write(JSON.stringify(result) + '\n');
  }
  stream.end();

  console.log(`\n[SAVED] Results written to ${outputFile}`);
  return outputFile;
}

// ────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const benchmarkArg = (args.benchmark as string) || 'truthfulqa';
  const endpoint = (args.endpoint as string) || 'http://localhost:3000';
  const limit      = args.n              !== undefined ? (args.n              as number) : undefined;
  const shardIndex = args["shard-index"] !== undefined ? (args["shard-index"] as number) : undefined;
  const shardSize  = args["shard-size"]  !== undefined ? (args["shard-size"]  as number) : undefined;

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           LexBench v1 Stability Engine                         ║
║           Unified Benchmark Runner — grounded scoring           ║
╚════════════════════════════════════════════════════════════════╝

Configuration:
  Benchmark:  ${benchmarkArg}
  Endpoint:   ${endpoint}
  Limit:      ${limit ?? 'all'}
  Shard Index: ${shardIndex !== undefined ? shardIndex : 'none'}
  Shard Size:  ${shardSize !== undefined ? shardSize : 'none'}
  `);

  try {
    let benchmarks = [benchmarkArg];
    if (benchmarkArg.toLowerCase() === 'all') {
      benchmarks = Object.keys(BENCHMARK_CONFIGS);
    }

    for (const benchmark of benchmarks) {
      const results = await runBenchmark(benchmark, endpoint, limit, shardIndex, shardSize);
      saveResults(results, benchmark);
    }

    console.log(`\n[SUCCESS] All benchmarks completed.`);
  } catch (err) {
    console.error(`[ERROR] ${err}`);
    process.exit(1);
  }
}

main();
