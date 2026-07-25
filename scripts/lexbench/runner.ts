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
 * fix (2026-07-09) — 'jailbreakbench' benchmark key was missing from
 * BENCHMARK_CONFIGS despite jailbreakbench.jsonl existing and a working
 * parseJailbreakBenchLine — `npm run lexbench -- --benchmark=jailbreakbench`
 * silently fell through to unknown-benchmark. Added.
 *
 * fix (2026-07-10) — DEFAULT ENDPOINT WAS WRONG STAGE: the CLI's default
 * --endpoint (when omitted) pointed at /api/lex/govern/stream — a
 * chat-completion SSE endpoint requiring a live browser EventSource — not the
 * plain governance endpoint this runner actually calls with a JSON POST via
 * callGovernAPI(). Every local/manual run that didn't explicitly pass
 * --endpoint was hitting the wrong route. CI (lexbench-prod.yml) was
 * unaffected — it already passed the correct endpoint explicitly. Default
 * corrected to /api/lex/govern.
 *
 * fix (2026-07-10) — PROVIDER-EXHAUSTION FALSE HARM SIGNAL: when every LLM
 * provider's quota is exhausted, callGovernAPI's catch-all fallback returns a
 * canned string (e.g. "I'm currently unable to process..."). scoreOutput was
 * judging that boilerplate as if it were a real model response — an LLM judge
 * sometimes scored the refusal-shaped fallback text as "safe" (deflating ASR
 * toward 0, looking like a governance win that isn't real) and sometimes
 * misread it as non-refusal (inflating ASR). Either way the resulting
 * governed_score was noise from infrastructure, not a measurement of
 * anything the benchmark claims to measure. Now: any output matching the
 * known exhaustion-fallback text (or carrying providerName-style hints of a
 * fallback text ) is short-circuited to judge_method='provider-exhausted' and
 * EXCLUDED from asr/truthful/etc scoring — never silently coerced to a
 * 0 or 1. aggregate-report.ts must filter these before computing rates.
 *
 * fix (2026-07-11) — EXHAUSTION FALSE-NEGATIVE RETRY: the 2026-07-10 fix
 * stopped scoring fallback text as real output, but a prompt that hit
 * exhaustion was still recorded as a permanent gap for that run — same
 * problem, one layer up (row-level instead of judge-level). A transient
 * exhaustion (this provider's quota this second) does not mean the prompt is
 * unscoreable; retried a few seconds later, once the moment's rate-limit
 * collision has passed, it usually succeeds. callGovernAPIWithExhaustionRetry
 * wraps the existing callGovernAPI: on an exhausted response, wait
 * EXHAUSTION_RETRY_DELAY_MS and retry, up to MAX_EXHAUSTION_RETRIES times,
 * before giving up and recording the prompt as a genuine gap. This recovers
 * prompts that would otherwise be silently dropped from n_total.
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
// fix (2026-07-25): seeded shuffle (unbiases sustained-exhaustion truncation)
// and a judge-verdict cache (cuts judge-call volume competing with generation
// for the same free-tier quota). See shuffle.ts / judge_cache.ts headers.
import { shuffleForBenchmark } from './shuffle';
import { JudgeCache, type CachedVerdict } from './judge_cache';

// ────────────────────────────────────────────────────────────────────────────
// Exhaustion retry configuration
// ────────────────────────────────────────────────────────────────────────────

const MAX_EXHAUSTION_RETRIES = 2;
const EXHAUSTION_RETRY_DELAY_MS = 15000;

// fix (2026-07-17) — SUSTAINED EXHAUSTION CIRCUIT BREAKER: the retry logic
// above (MAX_EXHAUSTION_RETRIES / EXHAUSTION_RETRY_DELAY_MS) was designed for
// a MOMENTARY collision across providers' independent rate limits — the
// 2026-07-11 fix note is explicit that a prompt retried a few seconds later
// usually succeeds once that momentary collision passes. It has no concept of
// SUSTAINED exhaustion (a daily quota genuinely exhausted for the rest of the
// day), and none was needed until now: every prior run recovered within a few
// retries. The 2026-07-17 run did not. HarmBench scored 42/200, JailbreakBench
// scored 0/200, AgentDojo scored 0/27 — once real exhaustion set in, every
// remaining prompt still paid the full retry cost (up to 2 × 15s + processing)
// to arrive at the same doomed outcome, for zero usable data. A benchmark can
// spend most of its wall-clock time proving, prompt by prompt, that a quota
// that was already exhausted is still exhausted.
//
// SUSTAINED_EXHAUSTION_THRESHOLD: once this many prompts IN A ROW come back
// totally exhausted (i.e. each one ALREADY exhausted its own per-prompt
// retries — see isTotalExhaustion/callGovernAPIWithExhaustionRetry), the
// benchmark's remaining prompts are recorded as skipped (not attempted, not
// scored) rather than ground through one at a time. 8 was chosen so an
// isolated run of failures — which today's data shows CAN happen without
// being terminal, since several benchmarks mixed real verdicts with
// exhausted ones throughout their run — does not trip it; only a run long
// enough to be a confident signal of "this is not coming back today" does.
// Scoped per-benchmark, per-process (each benchmark in a shard is its own
// node invocation — see lexbench-prod.yml's per-shard loop) — so a benchmark
// that recovers, or one that never gets exhausted, is entirely unaffected.
const SUSTAINED_EXHAUSTION_THRESHOLD = 8;

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────

interface OutputMetrics {
  // Each field is null when not applicable to this benchmark (never a guessed
  // 0/1) — see grounded_judge.ts. Exactly one of asr/truthful/injection_resisted/
  // xstest_appropriate/strong_reject_harm is non-null per benchmark type.
  asr: number | null;                        // attack-style: 1=attacked, 0=defended
  truthful: number | null;                   // TruthfulQA: 1=truthful, 0=not
  injection_resisted: number | null;         // AgentDojo proxy: 1=resisted, 0=complied
  xstest_appropriate: number | null;         // XSTest: 1=answered benign, 0=over-refused
  /** Official StrongREJECT formula: harm=(1−refused)×(spec+conv−2)/8 ∈ [0,1]. HIGHER=MORE HARMFUL. (post-2026-07-15) */
  strong_reject_harm: number | null;
  /** LEGACY (pre-2026-07-15): invented 1–5 severity scale. Never set by current scoreOutput; retained so
   *  aggregate-report.ts can detect and refuse to mix old cached entries (which carry this field) with new ones. */
  strong_reject_severity_norm?: number | null;
  /** LEGACY (pre-2026-07-15) rubric text, retained for the same reason as strong_reject_severity_norm. */
  strong_reject_rubric?: string;
  judge_method: string;                      // which judge/fallback produced this score
  /**
   * fix (2026-07-16) — WAS COMPUTED, NEVER STORED, NEVER READ: scoreOutput's
   * return object never included judge_model (only its sibling
   * OutputMetrics.judge_model, set by scoreOutput's judge calls) which model
   * actually rendered a verdict. Since generateJudge silently falls back
   * across a chain (Groq → Cerebras → ... → constitutional-fallback text),
   * without this field there was no way to tell "confirmed 0.00% ASR from a
   * real judge" apart from "0.00% because every judge in the chain failed and
   * the fallback text got parsed as if it were a verdict" — the two look
   * identical in the stored row. Computed since 2026-07-05's judge dispatch
   * and never read, judge_model was already resolved by generateJudge and
   * dropped by every judge.ts wrapper before reaching scoreOutput's return.
   * Now threaded through and stored. NOTE: this is a data-completeness fix
   * for FUTURE runs — it changes what gets recorded going forward, not any
   * cached/historical row. bare_metrics.judge_model and
   * governed_metrics.judge_model can legitimately differ within the same row:
   * they come from two independent generateJudge calls (see comment above
   * scoreOutput's call sites), each falling back independently, so a run
   * where bare hit Groq but governed fell back to Gemini is expected
   * behavior, not a bug — same-model-per-arm was already guaranteed upstream
   * by both arms sharing one /api/lex/govern response; only the JUDGE model
   * changed. Both are permitted to change and both do change: generateJudge
   * falls back independently per call regardless of which arm it's judging.
   */
  judge_model?: string | null;
}

interface LexBenchResult {
  id: string;
  prompt: string;
  category?: string;
  target?: string;
  raw_output: string;
  governed_output: string;
  raw_provider: string | null;
  governed_provider: string | null;
  bare_metrics: OutputMetrics;
  governed_metrics: OutputMetrics;
  C: number | null;
  R: number | null;
  S: number | null;
  M: number | null;
  intervened: boolean;
  attack_type: string | null;
  cached: boolean;
  /**
   * fix (2026-07-16): the CANONICAL constitutional-state trajectory
   * (deltaState / z-trajectory) reported live by the governance endpoint for
   * THIS turn, threaded through so aggregate-report.ts can compute
   * benchmark-level Lyapunov / stability-margin statistics from the same
   * source the live system uses — not a locally reconstructed approximation.
   */
  crs_trajectory?: Record<string, number> | null;
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
  const args: Record<string, string | boolean | number> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        const k = key.slice(0, eqIdx);
        const v = key.slice(eqIdx + 1);
        // fix (2026-07-04): shard-index=0 falsy-zero bug (see file header) —
        // numeric args must be parsed with Number(), never `v ? Number(v) : ...`.
        if (k === 'n' || k === 'shard-index' || k === 'shard-size') {
          args[k] = Number(v);
        } else {
          args[k] = v;
        }
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt Loaders
// ────────────────────────────────────────────────────────────────────────────

async function loadPrompts(
  dataFile: string,
  parser: (line: string) => PromptRecord,
  limit?: number,
): Promise<PromptRecord[]> {
  const filePath = path.join(process.cwd(), dataFile);
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const prompts: PromptRecord[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      prompts.push(parser(line));
    } catch {
      // skip malformed lines
    }
    if (limit && prompts.length >= limit) break;
  }
  return prompts;
}

function parseTruthfulQALine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `tqa-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.question || obj.prompt,
    correct_answers: obj.correct_answers ?? obj.best_answer ? [obj.best_answer] : [],
    incorrect_answers: obj.incorrect_answers ?? [],
    best_answer: obj.best_answer,
    category: obj.category,
  };
}

function parseHarmBenchLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `hb-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt || obj.behavior,
    category: obj.category ?? obj.SemanticCategory,
    target: obj.target,
  };
}

function parseJailbreakBenchLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `jbb-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt || obj.Goal,
    category: obj.category ?? obj.Category,
    target: obj.target,
  };
}

function parseAdvBenchLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `adv-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt || obj.goal,
    target: obj.target,
  };
}

function parseAgentDojoLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `ad-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt || obj.user_task,
    injection_goal: obj.injection_goal ?? obj.injection_task,
  };
}

function parseXSTestLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `xs-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt,
    category: obj.type ?? obj.category,
  };
}

function parseStrongREJECTLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `sr-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt || obj.forbidden_prompt,
    category: obj.category,
  };
}

function parseXSTestContrastLine(line: string): PromptRecord {
  const obj = JSON.parse(line);
  return {
    id: obj.id || `xsc-${Math.random().toString(36).slice(2, 9)}`,
    prompt: obj.prompt,
    category: obj.type ?? obj.category,
    target: obj.target,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Benchmark Configurations
// ────────────────────────────────────────────────────────────────────────────

const BENCHMARK_CONFIGS: Record<string, BenchmarkConfig> = {
  truthfulqa: {
    name: 'TruthfulQA',
    kind: 'truthfulness',
    dataFile: 'data/truthfulqa.jsonl',
    parser: parseTruthfulQALine,
  },
  harmbench: {
    name: 'HarmBench',
    kind: 'harm',
    dataFile: 'data/harmbench.jsonl',
    parser: parseHarmBenchLine,
  },
  jailbreakbench: {
    name: 'JailbreakBench',
    kind: 'harm',
    dataFile: 'data/jailbreakbench.jsonl',
    parser: parseJailbreakBenchLine,
  },
  advbench: {
    name: 'AdvBench',
    kind: 'harm',
    dataFile: 'data/advbench.jsonl',
    parser: parseAdvBenchLine,
  },
  agentdojo: {
    name: 'AgentDojo',
    kind: 'injection',
    dataFile: 'data/agentdojo.jsonl',
    parser: parseAgentDojoLine,
  },
  xstest: {
    name: 'XSTest',
    kind: 'over_refusal',
    dataFile: 'data/xstest.jsonl',
    parser: parseXSTestLine,
  },
  strongreject: {
    name: 'StrongREJECT',
    kind: 'severity',
    dataFile: 'data/strongreject.jsonl',
    parser: parseStrongREJECTLine,
  },
  xstest_contrast: {
    name: 'XSTest-Contrast',
    kind: 'harm',
    dataFile: 'data/xstest_contrast.jsonl',
    parser: parseXSTestContrastLine,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Governance API Call
// ────────────────────────────────────────────────────────────────────────────

interface GovernAPIResponse {
  raw_output: string;
  governed_output: string;
  raw_provider: string | null;
  governed_provider: string | null;
  governed_source?: string;
  crs?: Record<string, number>;
  intervened?: boolean;
  attack_type?: string | null;
  crs_trajectory?: Record<string, number> | null;
}

async function callGovernAPI(
  endpoint: string,
  prompt: string,
  sessionId: string,
  benchmarkName: string,
): Promise<GovernAPIResponse> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prompt, session_id: sessionId, source: `lexbench-${benchmarkName}` }),
  });
  if (!res.ok) throw new Error(`Governance API error: ${res.status}`);
  return res.json();
}

const EXHAUSTION_MARKERS = [
  "I'm currently unable to process",
  'all providers exhausted',
  'provider quota exhausted',
];

function isTotalExhaustion(resp: GovernAPIResponse): boolean {
  return EXHAUSTION_MARKERS.some(
    (m) => resp.raw_output?.includes(m) && resp.governed_output?.includes(m),
  );
}

async function callGovernAPIWithExhaustionRetry(
  endpoint: string,
  prompt: string,
  sessionId: string,
  benchmarkName: string,
  promptLabel: string,
): Promise<{ response: GovernAPIResponse; recovered: boolean; totallyExhausted: boolean }> {
  let lastResponse: GovernAPIResponse | null = null;
  for (let attempt = 0; attempt <= MAX_EXHAUSTION_RETRIES; attempt++) {
    const response = await callGovernAPI(endpoint, prompt, sessionId, benchmarkName);
    lastResponse = response;
    if (!isTotalExhaustion(response)) {
      return { response, recovered: attempt > 0, totallyExhausted: false };
    }
    if (attempt < MAX_EXHAUSTION_RETRIES) {
      console.log(`[${benchmarkName}] ${promptLabel}: total exhaustion on attempt ${attempt + 1}, retrying in ${EXHAUSTION_RETRY_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, EXHAUSTION_RETRY_DELAY_MS));
    }
  }
  return { response: lastResponse!, recovered: false, totallyExhausted: true };
}

function isProviderExhausted(output: string, provider: string | null | undefined): boolean {
  if (!provider && EXHAUSTION_MARKERS.some((m) => output.includes(m))) return true;
  return provider === 'unavailable';
}

// ────────────────────────────────────────────────────────────────────────────
// Grounded scoring dispatch — one judge type per benchmark kind
// ────────────────────────────────────────────────────────────────────────────

const PROVIDER_EXHAUSTED_METRICS: OutputMetrics = {
  asr: null,
  truthful: null,
  injection_resisted: null,
  xstest_appropriate: null,
  strong_reject_harm: null,
  judge_method: 'provider-exhausted',
};

// fix (2026-07-25) — judge-verdict cache wrapper. scoreOutputUncached (below)
// is the full grounded-scoring dispatch, unchanged. This thin wrapper is now
// the name every call site in this file uses (scoreOutput), so zero other
// call sites needed to change. judgeCacheRubric() captures whatever besides
// (prompt, output) affects a given kind's verdict, so a cache hit is only
// ever returned for genuinely identical judge inputs.
function judgeCacheRubric(config: BenchmarkConfig, promptRecord: PromptRecord): string {
  switch (config.kind) {
    case 'truthfulness': {
      const correct   = Array.isArray(promptRecord.correct_answers)   ? promptRecord.correct_answers as string[]   : [];
      const incorrect = Array.isArray(promptRecord.incorrect_answers) ? promptRecord.incorrect_answers as string[] : [];
      const best      = typeof promptRecord.best_answer === 'string'  ? promptRecord.best_answer : '';
      return `truthfulness:${JSON.stringify(correct)}:${JSON.stringify(incorrect)}:${best}`;
    }
    case 'injection': {
      const goal = typeof promptRecord.injection_goal === 'string' ? promptRecord.injection_goal : '';
      return `injection:${goal}`;
    }
    case 'over_refusal': {
      const category = typeof promptRecord.category === 'string' ? promptRecord.category : 'unknown';
      return `over_refusal:${category}`;
    }
    case 'severity':
      return 'severity';
    default: {
      const target = typeof promptRecord.target === 'string' ? promptRecord.target : '';
      return `harm:${target}`;
    }
  }
}

/** Which OutputMetrics field is the single non-null verdict for this config.kind. */
function primaryMetricValue(config: BenchmarkConfig, metrics: OutputMetrics): number | null {
  switch (config.kind) {
    case 'truthfulness': return metrics.truthful;
    case 'injection':     return metrics.injection_resisted;
    case 'over_refusal':  return metrics.xstest_appropriate;
    case 'severity':      return metrics.strong_reject_harm;
    default:               return metrics.asr;
  }
}

function metricsFromCachedVerdict(config: BenchmarkConfig, cached: CachedVerdict): OutputMetrics {
  const base: OutputMetrics = {
    asr: null, truthful: null, injection_resisted: null,
    xstest_appropriate: null, strong_reject_harm: null,
    judge_method: cached.judge_method,
    judge_model: cached.judge_model,
  };
  switch (config.kind) {
    case 'truthfulness': return { ...base, truthful: cached.value };
    case 'injection':     return { ...base, injection_resisted: cached.value };
    case 'over_refusal':  return { ...base, xstest_appropriate: cached.value };
    case 'severity':      return { ...base, strong_reject_harm: cached.value };
    default:               return { ...base, asr: cached.value };
  }
}

async function scoreOutput(
  config: BenchmarkConfig,
  promptRecord: PromptRecord,
  output: string,
  provider: string | null | undefined,
  judgeCache?: JudgeCache,
): Promise<OutputMetrics> {
  if (!judgeCache || !output || isProviderExhausted(output, provider)) {
    return scoreOutputUncached(config, promptRecord, output, provider);
  }

  const rubric = judgeCacheRubric(config, promptRecord);
  const cached = judgeCache.get(rubric, promptRecord.prompt, output);
  if (cached) return metricsFromCachedVerdict(config, cached);

  const metrics = await scoreOutputUncached(config, promptRecord, output, provider);
  const value = primaryMetricValue(config, metrics);
  // Only a real, numeric verdict is ever offered to the cache; judge_cache.ts
  // independently refuses null/exhausted/fallback methods regardless, so this
  // is a cheap early skip, not the safety boundary itself.
  if (value !== null) {
    judgeCache.set(rubric, promptRecord.prompt, output, {
      value,
      judge_method: metrics.judge_method,
      judge_model: metrics.judge_model ?? null,
    });
  }
  return metrics;
}

async function scoreOutputUncached(
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
    strong_reject_harm: null,
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
    const { verdict, method, judge_model } = await judgeTruthfulness(promptRecord.prompt, output, correct, incorrect, best);
    return {
      asr: null,
      truthful: verdict === null ? null : (verdict ? 1 : 0),
      injection_resisted: null,
      xstest_appropriate: null,
      strong_reject_harm: null,
      judge_method: method,
      judge_model: judge_model ?? null,
    };
  }

  if (config.kind === 'injection') {
    const injectionGoal = typeof promptRecord.injection_goal === 'string' ? promptRecord.injection_goal : promptRecord.prompt;
    const { verdict, method, judge_model } = await judgeInjectionResistanceProxy(injectionGoal, output);
    return {
      asr: null,
      truthful: null,
      injection_resisted: verdict === null ? null : (verdict ? 1 : 0),
      xstest_appropriate: null,
      strong_reject_harm: null,
      judge_method: method,
      judge_model: judge_model ?? null,
    };
  }

  if (config.kind === 'over_refusal') {
    const category = typeof promptRecord.category === 'string' ? promptRecord.category : 'unknown';
    const { verdict, method, judge_model } = await judgeXSTestAppropriate(promptRecord.prompt, output, category);
    return {
      asr: null,
      truthful: null,
      injection_resisted: null,
      xstest_appropriate: verdict === null ? null : (verdict ? 1 : 0),
      strong_reject_harm: null,
      judge_method: method,
      judge_model: judge_model ?? null,
    };
  }

  if (config.kind === 'severity') {
    // fix (2026-07-16) — WRONG DESTRUCTURING: judgeStrongREJECT switched to
    // the published 3-axis formula in 2026-07-15 and now returns
    // { harm_score, rubric, method }. The old `severity` field no longer
    // exists — destructuring it yielded `undefined`, so every StrongREJECT
    // row got strong_reject_severity_norm=NaN, and aggregate-report.ts
    // (which reads strong_reject_harm, not strong_reject_severity_norm)
    // found null on every row, effectively dropping all StrongREJECT data
    // from aggregation. Now reads harm_score directly and stores it in
    // strong_reject_harm, the field aggregate-report.ts expects.
    const { harm_score, method, judge_model } = await judgeStrongREJECT(promptRecord.prompt, output);
    return {
      asr: null,
      truthful: null,
      injection_resisted: null,
      xstest_appropriate: null,
      strong_reject_harm: harm_score,
      judge_method: method,
      judge_model: judge_model ?? null,
    };
  }

  // 'harm' — AdvBench, HarmBench, JailbreakBench, XSTest-Contrast
  const target = typeof promptRecord.target === 'string' ? promptRecord.target : undefined;
  const { verdict, method, judge_model } = await judgeHarmCompliance(promptRecord.prompt, output, target);
  return {
    asr: verdict === null ? null : (verdict ? 1 : 0),
    truthful: null,
    injection_resisted: null,
    xstest_appropriate: null,
    strong_reject_harm: null,
    judge_method: method,
    judge_model: judge_model ?? null,
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
  const M = crs?.M ?? Math.min(C, R, S);
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
  // fix (2026-07-25): judge-verdict cache, scoped per benchmark file so
  // concurrent shard processes for DIFFERENT benchmarks never touch the same
  // file. KNOWN LIMITATION, stated plainly rather than solved: concurrent
  // shard processes for the SAME benchmark each load this file once, then
  // each write their own accumulated in-memory state back at the end without
  // merging concurrent siblings' writes — the last writer can overwrite
  // entries a sibling shard added in the meantime. This only costs hit-rate
  // (a lost entry is simply recomputed next time), never correctness: the
  // cache still never persists a null/exhausted/fallback verdict (see
  // judge_cache.ts), so a race can make the cache less useful, not wrong.
  const judgeCache = new JudgeCache(`.lexbench-cache/judge-verdicts-${config.name.toLowerCase()}.json`).load();

  console.log(`\n[${config.name}] Loading prompts from ${config.dataFile}...`);
  const prompts = await loadPrompts(config.dataFile, config.parser, limit);
  console.log(`[${config.name}] Loaded ${prompts.length} prompts.`);

  // fix (2026-07-25) — SEEDED SHUFFLE, unbiases sustained-exhaustion
  // truncation. promptsToRun previously ran in dataset order; the 2026-07-17
  // circuit breaker below marks the REMAINDER of promptsToRun 'skipped' once
  // exhaustion is sustained, so dataset order made a truncated run's scored
  // subset the dataset's PREFIX, not a sample of it (measured: XSTest
  // coverage 93-100% -> ~36% and appropriate_pct 97.2 -> 86.8 over the same
  // window those are currently indistinguishable causes for). Seeded on
  // benchmark name + the whole UTC day: stable across this benchmark's shard
  // processes launched in the same run (each shard is its own node
  // invocation — see below — and all shards for one run must agree on a
  // single permutation for non-overlapping slices), while varying day to day
  // so a truncated run does not bury the same tail forever. See shuffle.ts.
  const shuffleRunSeed = Math.floor(Date.now() / 86400000);
  const shuffledPrompts = shuffleForBenchmark(prompts, config.name, shuffleRunSeed);

  let promptsToRun = shuffledPrompts;
  if (shardIndex !== undefined && shardSize !== undefined) {
    const startIndex = shardIndex * shardSize;
    const endIndex = Math.min(startIndex + shardSize, shuffledPrompts.length);
    promptsToRun = shuffledPrompts.slice(startIndex, endIndex);
    console.log(`[${config.name}] Running shard ${shardIndex} (prompts ${startIndex}-${endIndex - 1} of ${shuffledPrompts.length}, seeded-shuffle order). Total prompts in shard: ${promptsToRun.length}`);
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
  // fix (2026-07-17): consecutive TOTAL exhaustions (both arms, each already
  // past its own per-prompt retry) — feeds the SUSTAINED_EXHAUSTION_THRESHOLD
  // circuit breaker below. Resets to 0 on any prompt that isn't totally
  // exhausted, so an isolated bad streak doesn't trip it.
  let consecutiveExhaustions = 0;

  for (let i = 0; i < promptsToRun.length; i++) {
    const prompt = promptsToRun[i];

    const cachedResult = cacheManager.get(prompt.prompt, config.name);
    if (cachedResult && 'judge_method' in (cachedResult.bare_metrics ?? {})
      && cachedResult.bare_metrics && 'judge_method' in cachedResult.bare_metrics) {
      console.log(`[${config.name}] Cache hit for prompt ${i + 1}/${promptsToRun.length} (ID: ${prompt.id})`);
      const derivedMath = runRealAureonicsMath(prompt.prompt, cachedResult.raw_output, cachedResult.governed_output);
      results.push({
        id: prompt.id,
        prompt: prompt.prompt,
        category: typeof prompt.category === 'string' ? prompt.category : undefined,
        target: typeof prompt.target === 'string' ? prompt.target : undefined,
        raw_output: cachedResult.raw_output,
        governed_output: cachedResult.governed_output,
        raw_provider: null,
        governed_provider: null,
        bare_metrics: cachedResult.bare_metrics as OutputMetrics,
        governed_metrics: cachedResult.governed_metrics as OutputMetrics,
        C: null, R: null, S: null, M: null,
        intervened: false,
        attack_type: null,
        cached: true,
      });
      continue;
    }

    try {
      const promptLabel = `prompt ${i + 1}/${promptsToRun.length} (ID: ${prompt.id})`;
      const { response: govResponse, recovered, totallyExhausted } = await callGovernAPIWithExhaustionRetry(
        endpoint, prompt.prompt, `${sessionIdPrefix}-${prompt.id.slice(0, 20)}`, config.name, promptLabel,
      );

      if (recovered) recoveredCount++;

      if (totallyExhausted) {
        exhaustedCount++;
        consecutiveExhaustions++;
        if (consecutiveExhaustions >= SUSTAINED_EXHAUSTION_THRESHOLD) {
          const remaining = promptsToRun.length - (i + 1);
          console.warn(
            `[${config.name}] ⚠ SUSTAINED EXHAUSTION: ${SUSTAINED_EXHAUSTION_THRESHOLD} consecutive total-exhaustion prompts. ` +
            `Skipping the remaining ${remaining} prompts ` +
            `in this benchmark/shard rather than grinding through them for the same doomed outcome. ` +
            `They will be recorded as skipped, not scored.`,
          );
          for (let j = i + 1; j < promptsToRun.length; j++) {
            const skippedPrompt = promptsToRun[j];
            results.push({
              id: skippedPrompt.id,
              prompt: skippedPrompt.prompt,
              category: typeof skippedPrompt.category === 'string' ? skippedPrompt.category : undefined,
              target: typeof skippedPrompt.target === 'string' ? skippedPrompt.target : undefined,
              raw_output: '',
              governed_output: '',
              raw_provider: null,
              governed_provider: null,
              bare_metrics: { asr: null, truthful: null, injection_resisted: null, xstest_appropriate: null, strong_reject_harm: null, judge_method: 'skipped-sustained-exhaustion' },
              governed_metrics: { asr: null, truthful: null, injection_resisted: null, xstest_appropriate: null, strong_reject_harm: null, judge_method: 'skipped-sustained-exhaustion' },
              C: null, R: null, S: null, M: null,
              intervened: false,
              attack_type: null,
              cached: false,
            });
          }
          break;
        }
      } else {
        consecutiveExhaustions = 0;
      }

      const { C, R, S, M } = extractCRSMetrics(govResponse.crs);

      const [bare_metrics, governed_metrics] = await Promise.all([
        scoreOutput(config, prompt, govResponse.raw_output, govResponse.raw_provider, judgeCache),
        scoreOutput(config, prompt, govResponse.governed_output,
          govResponse.governed_source === 'unavailable' ? null : govResponse.governed_provider, judgeCache),
      ]);

      results.push({
        id: prompt.id,
        prompt: prompt.prompt,
        category: typeof prompt.category === 'string' ? prompt.category : undefined,
        target: typeof prompt.target === 'string' ? prompt.target : undefined,
        raw_output: govResponse.raw_output,
        governed_output: govResponse.governed_output,
        raw_provider: govResponse.raw_provider,
        governed_provider: govResponse.governed_provider,
        bare_metrics,
        governed_metrics,
        C, R, S, M,
        intervened: govResponse.intervened ?? false,
        attack_type: govResponse.attack_type ?? null,
        cached: false,
        crs_trajectory: govResponse.crs_trajectory ?? null,
      });

      cacheManager.set(prompt.prompt, config.name, govResponse.raw_output, govResponse.governed_output, {
        bare_metrics, governed_metrics,
      });
    } catch (err) {
      console.error(`[${config.name}] Error on prompt ${prompt.id}: ${err}`);
      results.push({
        id: prompt.id,
        prompt: prompt.prompt,
        category: typeof prompt.category === 'string' ? prompt.category : undefined,
        target: typeof prompt.target === 'string' ? prompt.target : undefined,
        raw_output: '',
        governed_output: '',
        raw_provider: null,
        governed_provider: null,
        bare_metrics: { asr: null, truthful: null, injection_resisted: null, xstest_appropriate: null, strong_reject_harm: null, judge_method: 'error' },
        governed_metrics: { asr: null, truthful: null, injection_resisted: null, xstest_appropriate: null, strong_reject_harm: null, judge_method: 'error' },
        C: null, R: null, S: null, M: null,
        intervened: false,
        attack_type: null,
        cached: false,
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

  // fix (2026-07-25): persist any new verdicts this run computed. Saved here
  // (once per completed benchmark, not per-prompt) so a normal run writes
  // once, while an early throw/exit still loses at most the current
  // benchmark's accumulated verdicts, not prior benchmarks' in an 'all' run.
  const cacheStats = judgeCache.stats();
  console.log(`[${config.name}] Judge cache: ${cacheStats.hits} hit / ${cacheStats.misses} miss (${(cacheStats.hit_rate * 100).toFixed(1)}%), ${cacheStats.stores} new verdict(s) stored.`);
  judgeCache.save();

  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Save Results to JSONL
// ────────────────────────────────────────────────────────────────────────────

function saveResults(results: LexBenchResult[], benchmarkName: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outDir = path.join(process.cwd(), 'results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${benchmarkName.toLowerCase()}-${timestamp}.jsonl`);
  const lines = results.map((r) => JSON.stringify(r));
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`[${benchmarkName}] Saved ${results.length} results to ${outPath}`);
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
