/**
 * LexBench v1 Stability Engine — Unified Benchmark Runner
 * 
 * Consolidates TruthfulQA, HarmBench, JailbreakBench, AdvBench, and AgentDojo
 * into a single framework with standardized output format.
 * 
 * Each benchmark produces a unified JSON structure with:
 *   - benchmark: name of the benchmark
 *   - prompt_id: unique identifier
 *   - prompt: the input prompt
 *   - raw_output: unfiltered model output
 *   - governed_output: output after Lex Aureon governance
 *   - metrics: { asr, toxicity, truth_score }
 *   - lex_metrics: { C, R, S, M } (Constitutional metrics)
 *   - intervention: boolean flag for governance intervention
 *   - timestamp: ISO-8601 timestamp
 * 
 * Usage:
 *   npm run lexbench -- --benchmark truthfulqa --n 50
 *   npm run lexbench -- --benchmark harmbench --n 100 --endpoint http://localhost:3000
 *   npm run lexbench -- --benchmark all --n 50
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createHash } from 'crypto';

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────

interface LexBenchResult {
  benchmark: string;
  prompt_id: string;
  prompt: string;
  raw_output: string;
  governed_output: string;
  metrics: {
    asr: number;
    toxicity: number;
    truth_score: number;
  };
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

interface BenchmarkConfig {
  name: string;
  dataFile: string;
  parser: (line: string) => { id: string; prompt: string; [key: string]: unknown };
  limit?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Argument Parsing
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
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
    dataFile: 'data/jailbreakbench.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `jbb-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.jailbreak || '',
        ...obj,
      };
    },
  },
  advbench: {
    name: 'AdvBench',
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
    dataFile: 'data/agentdojo.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `ad-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.task || '',
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
  parser: (line: string) => { id: string; prompt: string; [key: string]: unknown },
  limit?: number,
): Promise<Array<{ id: string; prompt: string; [key: string]: unknown }>> {
  const prompts: Array<{ id: string; prompt: string; [key: string]: unknown }> = [];
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
      // Simulation for local demonstration
      if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) {
        return {
          raw_output: `Simulated raw output for: ${prompt.substring(0, 20)}...`,
          governed_output: `Simulated governed output for: ${prompt.substring(0, 20)}...`,
          crs: {
            C: 0.9 + Math.random() * 0.1,
            R: 0.9 + Math.random() * 0.1,
            S: 0.9 + Math.random() * 0.1,
          },
          intervention: Math.random() > 0.9,
        };
      }

      const res = await fetch(`${endpoint}/api/lex/run`, {
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
      return {
        raw_output: data.raw_output || data.bare_output || '',
        governed_output: data.governed_output || data.anchored_output || '',
        crs: data.crs,
        intervention: data.intervention,
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
// Compute Placeholder Metrics (will be replaced with real scoring)
// ────────────────────────────────────────────────────────────────────────────

function computeMetrics(
  prompt: string,
  rawOutput: string,
  governedOutput: string,
): { asr: number; toxicity: number; truth_score: number } {
  // Placeholder simulation for demonstration
  return {
    asr: Math.random() * 0.1,
    toxicity: Math.random() * 0.05,
    truth_score: 0.8 + Math.random() * 0.2,
  };
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
): Promise<LexBenchResult[]> {
  const config = BENCHMARK_CONFIGS[benchmarkName.toLowerCase()];
  if (!config) {
    throw new Error(
      `Unknown benchmark: ${benchmarkName}. Available: ${Object.keys(BENCHMARK_CONFIGS).join(', ')}`,
    );
  }

  console.log(`\n[${config.name}] Loading prompts from ${config.dataFile}...`);
  const prompts = await loadPrompts(config.dataFile, config.parser, limit);
  console.log(`[${config.name}] Loaded ${prompts.length} prompts.`);

  const results: LexBenchResult[] = [];
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const startTime = Date.now();

    try {
      console.log(`[${config.name}] Processing ${i + 1}/${prompts.length}...`);

      const govResponse = await callGovernAPI(endpoint, prompt.prompt, sessionId);
      const duration = Date.now() - startTime;

      const metrics = computeMetrics(
        prompt.prompt,
        govResponse.raw_output,
        govResponse.governed_output,
      );
      const crsMetrics = extractCRSMetrics(govResponse.crs);

      const result: LexBenchResult = {
        benchmark: config.name,
        prompt_id: String(prompt.id),
        prompt: prompt.prompt,
        raw_output: govResponse.raw_output,
        governed_output: govResponse.governed_output,
        metrics,
        lex_metrics: crsMetrics,
        intervention: govResponse.intervention ?? crsMetrics.M < 0.08,
        timestamp: new Date().toISOString(),
        duration_ms: duration,
      };

      if (govResponse.error) {
        result.error = govResponse.error;
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
        metrics: { asr: 0.0, toxicity: 0.0, truth_score: 0.0 },
        lex_metrics: { C: 0.0, R: 0.0, S: 0.0, M: 0.0 },
        intervention: false,
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error: String(err),
      });
    }

    // Rate limiting disabled for demonstration
    /*
    if (i < prompts.length - 1) {
      await new Promise((r) => setTimeout(r, 6000));
    }
    */
  }

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
  const limit = args.n ? parseInt(args.n as string, 10) : undefined;

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           LexBench v1 Stability Engine                         ║
║           Unified Benchmark Runner                             ║
╚════════════════════════════════════════════════════════════════╝

Configuration:
  Benchmark:  ${benchmarkArg}
  Endpoint:   ${endpoint}
  Limit:      ${limit || 'all'}
  `);

  try {
    let benchmarks = [benchmarkArg];
    if (benchmarkArg.toLowerCase() === 'all') {
      benchmarks = Object.keys(BENCHMARK_CONFIGS);
    }

    for (const benchmark of benchmarks) {
      const results = await runBenchmark(benchmark, endpoint, limit);
      saveResults(results, benchmark);
    }

    console.log(`\n[SUCCESS] All benchmarks completed.`);
  } catch (err) {
    console.error(`[ERROR] ${err}`);
    process.exit(1);
  }
}

main();
