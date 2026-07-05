import * as fs from 'fs';
import * as readline from 'readline';

// Matches scripts/lexbench/grounded_judge.ts / runner.ts OutputMetrics shape.
// Exactly one of asr/truthful/injection_resisted is non-null per benchmark
// kind — never a guessed 0/1 for a metric that wasn't actually judged.
interface OutputMetrics {
  asr: number | null;
  truthful: number | null;
  injection_resisted: number | null;
  judge_method: string;
}

interface LexBenchResult {
  benchmark: string;
  prompt_id: string;
  bare_metrics: OutputMetrics;
  governed_metrics: OutputMetrics;
  lex_metrics: { C: number; R: number; S: number; M: number };
}

type BenchmarkKind = 'harm' | 'truthfulness' | 'injection';

function kindOf(benchmarkNameLower: string): BenchmarkKind {
  if (benchmarkNameLower === 'truthfulqa') return 'truthfulness';
  if (benchmarkNameLower === 'agentdojo')  return 'injection';
  return 'harm'; // advbench, harmbench, jailbreakbench
}

interface BenchmarkSummary {
  benchmark: string;
  kind: BenchmarkKind;
  total_prompts: number;
  // How many prompts actually got a non-null verdict from a judge, for BOTH
  // arms. A gap between total_prompts and scored_prompts means some judge
  // calls failed/were unparseable (see judge_methods_used) — surfaced
  // honestly rather than silently averaged over fewer items than reported.
  scored_prompts: number;
  judge_methods_used: string[];

  // Populated only for the matching kind — see fields above. Percentages 0–100.
  avg_bare_pct?: number;
  avg_governed_pct?: number;
  delta_pp?: number; // sign convention noted per kind in buildRows()

  // Joint constitutional transition metrics (unaffected by the judge change)
  avg_C: number; avg_R: number; avg_S: number; avg_M: number;
}

async function aggregateResults(inputFile: string): Promise<Record<string, BenchmarkSummary>> {
  const results: LexBenchResult[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(inputFile), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() !== '') {
      try { results.push(JSON.parse(line)); }
      catch (e) { console.error(`Error parsing line: ${line}, error: ${e}`); }
    }
  }

  interface Accum {
    benchmark: string; kind: BenchmarkKind;
    total: number; bareSum: number; bareN: number; govSum: number; govN: number;
    judgeMethods: Set<string>;
    cSum: number; rSum: number; sSum: number; mSum: number;
  }
  const acc: Record<string, Accum> = {};

  for (const r of results) {
    const key = r.benchmark.toLowerCase();
    const kind = kindOf(key);
    if (!acc[key]) {
      acc[key] = { benchmark: r.benchmark, kind, total: 0, bareSum: 0, bareN: 0, govSum: 0, govN: 0, judgeMethods: new Set(), cSum: 0, rSum: 0, sSum: 0, mSum: 0 };
    }
    const a = acc[key];
    a.total++;
    a.judgeMethods.add(r.bare_metrics?.judge_method ?? 'unknown');
    a.judgeMethods.add(r.governed_metrics?.judge_method ?? 'unknown');

    const bareVal = kind === 'harm' ? r.bare_metrics?.asr
      : kind === 'truthfulness' ? r.bare_metrics?.truthful
      : r.bare_metrics?.injection_resisted;
    const govVal = kind === 'harm' ? r.governed_metrics?.asr
      : kind === 'truthfulness' ? r.governed_metrics?.truthful
      : r.governed_metrics?.injection_resisted;

    if (bareVal !== null && bareVal !== undefined) { a.bareSum += bareVal; a.bareN++; }
    if (govVal  !== null && govVal  !== undefined) { a.govSum  += govVal;  a.govN++;  }

    a.cSum += r.lex_metrics?.C ?? 0; a.rSum += r.lex_metrics?.R ?? 0;
    a.sSum += r.lex_metrics?.S ?? 0; a.mSum += r.lex_metrics?.M ?? 0;
  }

  const summary: Record<string, BenchmarkSummary> = {};
  for (const key in acc) {
    const a = acc[key];
    const n = a.total || 1;
    const s: BenchmarkSummary = {
      benchmark: a.benchmark, kind: a.kind,
      total_prompts: a.total,
      scored_prompts: Math.min(a.bareN, a.govN), // both arms need a verdict to compute a paired delta
      judge_methods_used: [...a.judgeMethods].sort(),
      avg_C: +(a.cSum / n).toFixed(4), avg_R: +(a.rSum / n).toFixed(4),
      avg_S: +(a.sSum / n).toFixed(4), avg_M: +(a.mSum / n).toFixed(4),
    };
    if (a.bareN > 0 && a.govN > 0) {
      const bareAvg = a.bareSum / a.bareN;
      const govAvg  = a.govSum  / a.govN;
      s.avg_bare_pct     = +(bareAvg * 100).toFixed(2);
      s.avg_governed_pct = +(govAvg  * 100).toFixed(2);
      // ASR: lower is better -> improvement = bare - governed.
      // truthful / injection_resisted: higher is better -> improvement = governed - bare.
      s.delta_pp = a.kind === 'harm'
        ? +((bareAvg - govAvg) * 100).toFixed(2)
        : +((govAvg - bareAvg) * 100).toFixed(2);
    }
    summary[key] = s;
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];
  if (!inputFile) {
    console.error('Usage: tsx scripts/lexbench/aggregate-report.ts <input_results.jsonl>');
    process.exit(1);
  }
  const summary = await aggregateResults(inputFile);
  console.log(JSON.stringify(summary, null, 2));
}

main();
