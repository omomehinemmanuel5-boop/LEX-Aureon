import * as fs from 'fs';
import * as readline from 'readline';

interface LexBenchResult {
  benchmark: string;
  prompt_id: string;
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
}

interface BenchmarkSummary {
  benchmark: string;
  total_prompts: number;
  avg_asr: number;
  avg_toxicity: number;
  avg_truth_score: number;
  avg_C: number;
  avg_R: number;
  avg_S: number;
  avg_M: number;
}

async function aggregateResults(inputFile: string): Promise<Record<string, BenchmarkSummary>> {
  const results: LexBenchResult[] = [];
  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim() !== "") {
      try {
        results.push(JSON.parse(line));
      } catch (e) {
        console.error(`Error parsing line: ${line}, error: ${e}`);
      }
    }
  }

  const summaryMap: Record<string, BenchmarkSummary> = {};

  for (const result of results) {
    const benchmarkName = result.benchmark.toLowerCase();
    if (!summaryMap[benchmarkName]) {
      summaryMap[benchmarkName] = {
        benchmark: result.benchmark,
        total_prompts: 0,
        avg_asr: 0,
        avg_toxicity: 0,
        avg_truth_score: 0,
        avg_C: 0,
        avg_R: 0,
        avg_S: 0,
        avg_M: 0,
      };
    }

    const summary = summaryMap[benchmarkName];
    summary.total_prompts++;
    summary.avg_asr += result.metrics.asr;
    summary.avg_toxicity += result.metrics.toxicity;
    summary.avg_truth_score += result.metrics.truth_score;
    summary.avg_C += result.lex_metrics.C;
    summary.avg_R += result.lex_metrics.R;
    summary.avg_S += result.lex_metrics.S;
    summary.avg_M += result.lex_metrics.M;
  }

  for (const benchmark in summaryMap) {
    const summary = summaryMap[benchmark];
    summary.avg_asr /= summary.total_prompts;
    summary.avg_toxicity /= summary.total_prompts;
    summary.avg_truth_score /= summary.total_prompts;
    summary.avg_C /= summary.total_prompts;
    summary.avg_R /= summary.total_prompts;
    summary.avg_S /= summary.total_prompts;
    summary.avg_M /= summary.total_prompts;
  }

  return summaryMap;
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];

  if (!inputFile) {
    console.error("Usage: tsx scripts/lexbench/aggregate-report.ts <input_results.jsonl>");
    process.exit(1);
  }

  const summary = await aggregateResults(inputFile);
  console.log(JSON.stringify(summary, null, 2));
}

main();
