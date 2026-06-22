import * as fs from 'fs';
import * as readline from 'readline';

interface OutputMetrics {
  asr: number;
  toxicity: number;
  truth_score: number;
}

interface LexBenchResult {
  benchmark: string;
  prompt_id: string;
  bare_metrics: OutputMetrics;
  governed_metrics: OutputMetrics;
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
  // Bare (ungoverned model) vs governed (Lex Aureon) — independently scored,
  // not one number doing double duty. See scripts/lexbench/runner.ts scoreOutput().
  avg_bare_asr: number;
  avg_governed_asr: number;
  asr_delta_pp: number; // percentage-point reduction: (bare - governed) * 100
  avg_bare_toxicity: number;
  avg_governed_toxicity: number;
  toxicity_delta_pp: number;
  avg_bare_truth_score: number;
  avg_governed_truth_score: number;
  truth_score_delta_pp: number;
  // Joint constitutional transition metrics (raw+governed scored together)
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
        avg_bare_asr: 0, avg_governed_asr: 0, asr_delta_pp: 0,
        avg_bare_toxicity: 0, avg_governed_toxicity: 0, toxicity_delta_pp: 0,
        avg_bare_truth_score: 0, avg_governed_truth_score: 0, truth_score_delta_pp: 0,
        avg_C: 0, avg_R: 0, avg_S: 0, avg_M: 0,
      };
    }

    const summary = summaryMap[benchmarkName];
    summary.total_prompts++;
    summary.avg_bare_asr += result.bare_metrics.asr;
    summary.avg_governed_asr += result.governed_metrics.asr;
    summary.avg_bare_toxicity += result.bare_metrics.toxicity;
    summary.avg_governed_toxicity += result.governed_metrics.toxicity;
    summary.avg_bare_truth_score += result.bare_metrics.truth_score;
    summary.avg_governed_truth_score += result.governed_metrics.truth_score;
    summary.avg_C += result.lex_metrics.C;
    summary.avg_R += result.lex_metrics.R;
    summary.avg_S += result.lex_metrics.S;
    summary.avg_M += result.lex_metrics.M;
  }

  for (const benchmark in summaryMap) {
    const s = summaryMap[benchmark];
    const n = s.total_prompts || 1;
    s.avg_bare_asr /= n;        s.avg_governed_asr /= n;
    s.avg_bare_toxicity /= n;   s.avg_governed_toxicity /= n;
    s.avg_bare_truth_score /= n; s.avg_governed_truth_score /= n;
    s.avg_C /= n; s.avg_R /= n; s.avg_S /= n; s.avg_M /= n;

    // ASR and toxicity: lower is better, so a positive delta_pp means improvement.
    s.asr_delta_pp = +((s.avg_bare_asr - s.avg_governed_asr) * 100).toFixed(2);
    s.toxicity_delta_pp = +((s.avg_bare_toxicity - s.avg_governed_toxicity) * 100).toFixed(2);
    // Truth score: higher is better, so improvement is (governed - bare).
    s.truth_score_delta_pp = +((s.avg_governed_truth_score - s.avg_bare_truth_score) * 100).toFixed(2);
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
