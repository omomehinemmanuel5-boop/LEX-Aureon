/**
 * LexBench v1 Stability Engine — Unified Benchmark Runner
 *
 * Consolidates TruthfulQA, HarmBench, JailbreakBench, AdvBench, AgentDojo,
 * XSTest, and StrongREJECT into a single framework with standardized output format.
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
 *   - XSTest: checks appropriateness on benign prompts (no over-refusal).
 *   - StrongREJECT: 5-level severity rating of refusal quality (1=comply, 5=robust).
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
 * fix (2026-07-10) — PROVIDER-EXHAUSTION TURNS WERE SCORED AS REAL DATA: on
 * 2026-07-08, app/api/lex/govern/route.ts started surfacing governed_source
 * ('governed'|'raw_fallback'|'unavailable'), raw_provider, and
 * governed_provider specifically so this runner could exclude turns where
 * all 5 LLM providers (Groq, Mistral, Gemini) were exhausted and the output
 * is SovereignKernel's static fallback string, not real model content — but
 * this file never got updated to actually read those fields. A full run on
 * 2026-07-10 had 52-86% of prompts hit that exact fallback (verified
 * directly against raw shard output), and because scoreOutput() only skips
 * scoring on a truly EMPTY string (not the non-empty fallback text), those
 * turns got real (degenerate) judge verdicts instead of being excluded —
 * producing implausible published numbers (AdvBench/HarmBench/
 * JailbreakBench collapsed to exactly 0%/0%, AgentDojo to exactly 100%/100%)
 * that had to be retired after the fact (see
 * scripts/migrations/2026-07-10-retire-provider-exhaustion-run.ts and
 * lib/benchmark_results.ts's RETIRED_METRICS). Now: each arm (bare/governed)
 * is checked independently before scoring — if its provider field is
 * missing/'unavailable', OR its text matches the known static fallback
 * string exactly (defense-in-depth, in case the provider fields are ever
 * absent on an older deployment), that arm is scored as excluded
 * ('provider-exhausted', all nulls) rather than judged. This mirrors exactly
 * how scoreOutput() already treats a truly empty string — nulls are excluded
 * from the paired average by scripts/lexbench/aggregate-report.ts, so an
 * exhausted turn now honestly shrinks the sample instead of poisoning it.
 *
 * fix (2026-07-11) — RETRY ON TOTAL EXHAUSTION: the 2026-07-10 fix correctly
 * EXCLUDES a turn where all 5 providers fail on both arms simultaneously —
 * but it never retried it, it just moved on and accepted the gap. The
 * 2026-07-10 full run landed at 93-100% coverage across all 7 benchmarks
 * (516/520, 193/200, 187/200, 27/27, 813/817, 313/313, 250/250) — honest,
 * clean, and genuinely usable, but not the FULL set. Root cause of the
 * remaining gap: rare moments where a burst of concurrent shard traffic hits
 * Gemini/Groq/Cerebras/Mistral's rate limits at the exact same instant,
 * failing all five in that one moment — not a sustained outage (the same
 * prompt tried a few seconds later, once that momentary collision has
 * passed, usually succeeds on at least one provider). Added
 * callGovernAPIWithExhaustionRetry(): when BOTH arms of a single prompt come
 * back totally exhausted (no real content on either side), wait
 * EXHAUSTION_RETRY_DELAY_MS and retry the WHOLE prompt, up to
 * MAX_EXHAUSTION_RETRIES times, before finally accepting the gap. Only
 * triggers on TOTAL exhaustion (both arms) — if one arm has real content and
 * the other doesn't, that's accepted as-is (retrying would discard a
 * perfectly good real result on the arm that DID succeed, and use more
 * quota for a partial gap that's already the honest, correct outcome per
 * the 2026-07-10 fix).
 *
 * Usage:
 *   npm run lexbench -- --benchmark truthfulqa --n 50
 *   npm run lexbench -- --benchmark harmbench --n 100 --endpoint http://localhost:3000
 *   npm run lexbench -- --benchmark all --n 50
 *   npm run lexbench -- --benchmark xstest --n 20
 *   npm run lexbench -- --benchmark strong_reject --n 30
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
import { judgeXSTestAppropriate } from './xstest_judge';
import { judgeStrongREJECT } from './strong_reject_judge';

// ────────────────────────────────────────────────────────────────────────────
// Provider-exhaustion detection (fix 2026-07-10 — see file header)
// ────────────────────────────────────────────────────────────────────────────

// Exact match to SovereignKernel.callLLM's static fallback (lib/sovereign_kernel.ts)
// — the literal text returned when all 5 providers in the fallback chain are
// exhausted on a single request. Kept as a defense-in-depth check alongside
// the governed_source/*_provider fields, in case those are ever missing.
const PROVIDER_EXHAUSTION_FALLBACK_TEXT = 'Constitutional framework C + R + S = 1 is operative.';

function isProviderExhausted(text: string, provider: string | null | undefined): boolean {
  if (!provider) return true;
  if (text.trim() === PROVIDER_EXHAUSTION_FALLBACK_TEXT) return true;
  return false;
}

// fix (2026-07-11): total-exhaustion retry — see file header. 2 retries (3
// attempts total) with a 15s pause. 15s was chosen because the observed
// failure mode is a MOMENTARY collision across providers' independent rate
// limits, not a sustained outage — long enough for a rate-limit window to
// roll over on at least one provider, short enough not to meaningfully
// extend a shard's runtime for what should be a rare event (2026-07-10's
// run needed this for well under 10% of prompts on every benchmark).
const MAX_EXHAUSTION_RETRIES = 2;
const EXHAUSTION_RETRY_DELAY_MS = 15_000;

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────

interface OutputMetrics {
  // Each field is null when not applicable to this benchmark (never a guessed
  // 0/1) — see grounded_judge.ts. Exactly one of asr/truthful/injection_resisted/
  // xstest_appropriate/strong_reject_severity is non-null per benchmark type.
  asr: number | null;                        // attack-style: 1=attacked, 0=defended
  truthful: number | null;                   // TruthfulQA: 1=truthful, 0=not
  injection_resisted: number | null;         // AgentDojo proxy: 1=resisted, 0=complied
  xstest_appropriate: number | null;         // XSTest: 1=answered benign, 0=over-refused
  strong_reject_severity_norm: number | null; // StrongREJECT: (severity-1)/4, higher=better
  judge_method: string;                      // which judge/fallback produced this score
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
  exhaustion_retries?: number; // fix (2026-07-11): how many retries this prompt needed, for visibility in output
}

interface PromptRecord {
  id: string;
  prompt: string;
  [key: string]: unknown;
}

interface BenchmarkConfig {
  name: string;
  kind: 'harm' | 'truthfulness' | 'injection' | 'over_refusal' | 'severity';
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
  xstest: {
    name: 'XSTest',
    kind: 'over_refusal',
    dataFile: 'data/xstest.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `xs-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.text || '',
        category: obj.category || 'unknown',
        ...obj,
      };
    },
  },
  strong_reject: {
    name: 'StrongREJECT',
    kind: 'severity',
    dataFile: 'data/strong_reject.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `sr-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.behavior || obj.harmful_behavior || '',
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

interface GovernAPIResult {
  raw_output: string;
  governed_output: string;
  crs?: Record<string, number>;
  intervention?: boolean;
  governed_source?: string | null;
  raw_provider?: string | null;
  governed_provider?: string | null;
  error?: string;
}

async function callGovernAPI(
  endpoint: string,
  prompt: string,
  sessionId: string,
): Promise<GovernAPIResult> {
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
        governed_source: data.governed_source ?? null,
        raw_provider: data.raw_provider ?? null,
        governed_provider: data.governed_provider ?? null,
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

/** True only when NEITHER arm produced real content — a total loss for this
 * prompt, worth retrying. A partial exhaustion (one arm real, one arm not)
 * is left alone: that's the honest, correct outcome from the 2026-07-10 fix,
 * and retrying would discard the real content that DID come back. */
function isTotalExhaustion(resp: GovernAPIResult): boolean {
  if (resp.error) return false; // a hard HTTP/network error, not a provider-exhaustion pattern — already retried inside callGovernAPI
  const rawExhausted = isProviderExhausted(resp.raw_output, resp.raw_provider);
  const govExhausted = isProviderExhausted(
    resp.governed_output,
    resp.governed_source === 'unavailable' ? null : resp.governed_provider,
  );
  return rawExhausted && govExhausted;
}

/**
 * fix (2026-07-11): wraps callGovernAPI with a retry specifically for total
 * exhaustion (see isTotalExhaustion above and the file header for why this
 * is scoped to total, not partial, exhaustion). Returns both the final
 * response and how many retries it took, so the caller can log/record it.
 */
async function callGovernAPIWithExhaustionRetry(
  endpoint: string,
  prompt: string,
  sessionId: string,
  benchmarkName: string,
  promptLabel: string,
): Promise<{ result: GovernAPIResult; retries: number }> {
  let result = await callGovernAPI(endpoint, prompt, sessionId);
  let retries = 0;

  while (isTotalExhaustion(result) && retries < MAX_EXHAUSTION_RETRIES) {
    retries++;
    console.warn(`[${benchmarkName}] ${promptLabel}: total provider exhaustion (both arms) — retry ${retries}/${MAX_EXHAUSTION_RETRIES} in ${EXHAUSTION_RETRY_DELAY_MS}ms...`);
    await new Promise((r) => setTimeout(r, EXHAUSTION_RETRY_DELAY_MS));
    result = await callGovernAPI(endpoint, prompt, sessionId);
  }

  if (retries > 0) {
    if (isTotalExhaustion(result)) {
      console.warn(`[${benchmarkName}] ${promptLabel}: still totally exhausted after ${retries} retries — accepting the gap (matches 2026-07-10's honest-exclusion behavior).`);
    } else {
      console.log(`[${benchmarkName}] ${promptLabel}: recovered after ${retries} retry(ies).`);
    }
  }

  return { result, retries };
}

// ────────────────────────────────────────────────────────────────────────────
// Grounded scoring dispatch — one judge type per benchmark kind
// ────────────────────────────────────────────────────────────────────────────

const PROVIDER_EXHAUSTED_METRICS: OutputMetrics = {
  asr: null,
  truthful: null,
  injection_resisted: null,
  xstest_appropriate: null,
  strong_reject_severity_norm: null,
  judge_method: 'provider-exhausted',
};

async function scoreOutput(
  config: BenchmarkConfig,
  promptRecord: PromptRecord,
  output: string,
  provider: string | null | undefined,
): Promise<OutputMetrics> {
  const empty: OutputMetrics = {
    asr: null,
    truthful: null,
    injection_resisted: null,
    xstest_appropriate: null,
    strong_reject_severity_norm: null,
    judge_method: 'empty-output',
  };
  if (!output) return empty;

  // fix (2026-07-10): never judge provider-exhaustion fallback text as if it
  // were a real model response — see file header for the full incident.
  if (isProviderExhausted(output, provider)) return PROVIDER_EXHAUSTED_METRICS;

  if (config.kind === 'truthfulness') {
    const correct   = Array.isArray(promptRecord.correct_answers)   ? promptRecord.correct_answers as string[]   : [];
    const incorrect = Array.isArray(promptRecord.incorrect_answers) ? promptRecord.incorrect_answers as string[] : [];
    const best      = typeof promptRecord.best_answer === 'string'  ? promptRecord.best_answer : undefined;
    const { verdict, method } = await judgeTruthfulness(promptRecord.prompt, output, correct, incorrect, best);
    return {
      asr: null,
      truthful: verdict === null ? null : (verdict ? 1 : 0),
      injection_resisted: null,
      xstest_appropriate: null,
      strong_reject_severity_norm: null,
      judge_method: method,
    };
  }

  if (config.kind === 'injection') {
    const injectionGoal = typeof promptRecord.injection_goal === 'string' ? promptRecord.injection_goal : promptRecord.prompt;
    const { verdict, method } = await judgeInjectionResistanceProxy(injectionGoal, output);
    return {
      asr: null,
      truthful: null,
      injection_resisted: verdict === null ? null : (verdict ? 1 : 0),
      xstest_appropriate: null,
      strong_reject_severity_norm: null,
      judge_method: method,
    };
  }

  if (config.kind === 'over_refusal') {
    const category = typeof promptRecord.category === 'string' ? promptRecord.category : 'unknown';
    const { verdict, method } = await judgeXSTestAppropriate(promptRecord.prompt, output, category);
    return {
      asr: null,
      truthful: null,
      injection_resisted: null,
      xstest_appropriate: verdict === null ? null : (verdict ? 1 : 0),
      strong_reject_severity_norm: null,
      judge_method: method,
    };
  }

  if (config.kind === 'severity') {
    const { severity, method } = await judgeStrongREJECT(promptRecord.prompt, output);
    return {
      asr: null,
      truthful: null,
      injection_resisted: null,
      xstest_appropriate: null,
      strong_reject_severity_norm: severity === null ? null : (severity - 1) / 4,
      judge_method: method,
    };
  }

  // 'harm' — AdvBench, HarmBench, JailbreakBench
  const target = typeof promptRecord.target === 'string' ? promptRecord.target : undefined;
  const { verdict, method } = await judgeHarmCompliance(promptRecord.prompt, output, target);
  return {
    asr: verdict === null ? null : (verdict ? 1 : 0),
    truthful: null,
    injection_resisted: null,
    xstest_appropriate: null,
    strong_reject_severity_norm: null,
    judge_method: method,
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
  // fix (2026-07-16): per-prompt session — one session per prompt, not per shard.
  // A shared shard session lets the governor "warm up" on early prompts and
  // arrive primed at later ones, inflating measured governance effectiveness
  // via z-trajectory bleed. Per-prompt sessions give independent measurements,
  // matching the design used by the standalone jailbreakbench/harmbench runners.
  const sessionIdPrefix = `lexbench-${config.name.toLowerCase()}-${shardTag}-${Date.now()}`;
  let exhaustedCount = 0;
  let recoveredCount = 0; // fix (2026-07-11): prompts that needed a retry but got real data on retry

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
      const promptLabel = `prompt ${i + 1}/${promptsToRun.length} (ID: ${prompt.id})`;
      console.log(`[${config.name}] Processing ${promptLabel}...`);

      // fix (2026-07-11): retry the whole call on total exhaustion (see
      // callGovernAPIWithExhaustionRetry / file header).
      const { result: govResponse, retries } = await callGovernAPIWithExhaustionRetry(
        endpoint, prompt.prompt, `${sessionIdPrefix}-${prompt.id.slice(0, 20)}`, config.name, promptLabel,
      );
      const duration = Date.now() - startTime;
      if (retries > 0 && !isTotalExhaustion(govResponse)) recoveredCount++;

      // fix (2026-07-10): score each arm against ITS OWN provider field — the
      // bare and governed arms can independently succeed/fail.
      const rawExhausted = isProviderExhausted(govResponse.raw_output, govResponse.raw_provider);
      const govExhausted = isProviderExhausted(
        govResponse.governed_output,
        govResponse.governed_source === 'unavailable' ? null : govResponse.governed_provider,
      );
      if (rawExhausted || govExhausted) exhaustedCount++;

      const [bareMetrics, governedMetrics] = await Promise.all([
        scoreOutput(config, prompt, govResponse.raw_output, govResponse.raw_provider),
        scoreOutput(config, prompt, govResponse.governed_output,
          govResponse.governed_source === 'unavailable' ? null : govResponse.governed_provider),
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
        ...(retries > 0 ? { exhaustion_retries: retries } : {}),
      };

      if (govResponse.error) {
        // Do not cache errors: a transient 5xx/network failure should not become
        // a permanent zero-output benchmark row on future runs.
        result.error = govResponse.error;
      } else if (!rawExhausted && !govExhausted) {
        // fix (2026-07-10): don't cache provider-exhaustion fallback content
        // either — a transient quota exhaustion should not become a
        // permanent "provider-exhausted" cache entry future runs replay.
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
        bare_metrics: {
          asr: null,
          truthful: null,
          injection_resisted: null,
          xstest_appropriate: null,
          strong_reject_severity_norm: null,
          judge_method: 'error',
        },
        governed_metrics: {
          asr: null,
          truthful: null,
          injection_resisted: null,
          xstest_appropriate: null,
          strong_reject_severity_norm: null,
          judge_method: 'error',
        },
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
  if (recoveredCount > 0) {
    console.log(`[${config.name}] ✓ ${recoveredCount}/${promptsToRun.length} prompts recovered via exhaustion retry (would have been gaps before the 2026-07-11 fix).`);
  }
  if (exhaustedCount > 0) {
    console.warn(`[${config.name}] ⚠ ${exhaustedCount}/${promptsToRun.length} prompts hit provider exhaustion on at least one arm — excluded from scoring, not counted as real verdicts.`);
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
  const limit      = args.n              !== undefined ? (args.n              as number) : undefined;
  const shardIndex = args["shard-index"] !== undefined ? (args["shard-index"] as number) : undefined;
  const shardSize  = args["shard-size"]  !== undefined ? (args["shard-size"]  as number) : undefined;

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║           LexBench v1 Stability Engine                             ║
║           Unified Benchmark Runner — grounded scoring               ║
║           Now includes: XSTest, StrongREJECT                        ║
╚════════════════════════════════════════════════════════════════════╝

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
