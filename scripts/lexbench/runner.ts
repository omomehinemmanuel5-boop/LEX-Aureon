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
 * feat (2026-07-16) — PER-ROW MEASUREMENT PROVENANCE: every LexBenchResult now
 * carries a provenance block recording what actually produced its numbers —
 * generation providers for both arms, embedding provider, and (via
 * OutputMetrics.judge_model, set by scoreOutput's judge calls) which model
 * graded each arm. Nothing here is new information: raw_provider and
 * governed_provider were already computed to detect exhaustion and then
 * discarded, embed_provider was already returned by the /api/lex/govern route
 * and never read, judge_model was already resolved by generateJudge and
 * dropped by every judge. The reason to persist them is direct: HarmBench's
 * BARE arm moved 12.8%→24.2% between 2026-07-14 and 07-16 with no change to
 * the bare code path, and with only judge_method (which rubric ran) recorded,
 * there is no way from the row itself to tell whether the judge chain fell
 * back to a different model or the govern route's generation provider
 * changed. Both are permitted to change and both do change: generateJudge
 * cascades across a 7-entry provider/model chain (lib/llm_provider.ts), and
 * Gemini's 1,000/day embedding quota is exceeded by a single production suite
 * (~1,764 novel output embeddings) so the embedding space that computes C/R/S
 * flips to mistral-embed partway through. Reported at the row level;
 * aggregate-report.ts summarises the distribution per benchmark; both live
 * inside notes so no benchmark_results schema change is required.
 *
 * fix (2026-07-17) — SUSTAINED EXHAUSTION CIRCUIT BREAKER: the 2026-07-11
 * retry logic assumes a MOMENTARY collision — a rate-limit window rolling
 * over within ~15-45s. It had no concept of a SUSTAINED outage (e.g. a daily
 * quota genuinely exhausted for the rest of the day), and none was needed
 * until this run: HarmBench scored 42/200, JailbreakBench 0/200, AgentDojo
 * 0/27 — once real exhaustion set in, every remaining prompt still paid the
 * full retry cost to arrive at the same doomed outcome, for zero usable
 * data. See SUSTAINED_EXHAUSTION_THRESHOLD below for the mechanism: once N
 * prompts in a row come back CONFIRMED exhausted (each already past its own
 * per-prompt retries), the rest of that benchmark's shard is recorded as
 * skipped rather than ground through one at a time. Skipped rows carry
 * provenance.source:'skipped' (not 'live') — a never-attempted prompt is a
 * different fact from an attempted-and-exhausted one, and conflating them
 * would misrepresent what happened.
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
  judge_method: string;                      // which judge/fallback produced this score
  /** feat (2026-07-16): the judge MODEL that produced this score, not just the
   * method. judge_method already told us WHICH RUBRIC ran; it never told us
   * which model ran it, and generateJudge falls back across a 7-entry chain
   * (lib/llm_provider.ts). Bare-arm ASR moved 12.8%→24.2% across 2026-07-14→16
   * with an unchanged bare code path — with only judge_method recorded, judge
   * drift and generator drift are indistinguishable. null when no judge call
   * was made (empty/exhausted output) or on a pre-2026-07-16 cached row. */
  judge_model?: string | null;
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
  /** feat (2026-07-16) — PER-ROW MEASUREMENT PROVENANCE. Every field here was
   * already being computed and then thrown away: raw_provider/governed_provider
   * were read only to detect exhaustion (see isProviderExhausted call sites) and
   * never persisted; embed_provider was returned by the API and never read;
   * judge_model was resolved by generateJudge and dropped by every judge.
   * Recording them is what makes a published row interpretable NEXT to another
   * run rather than only within itself. `source` distinguishes a live govern
   * call from a cache replay — a replayed row has no provider identity at all,
   * which is itself a fact the aggregate should surface rather than impute.
   *
   * 'skipped' (2026-07-17): a prompt the sustained-exhaustion circuit breaker
   * (SUSTAINED_EXHAUSTION_THRESHOLD) chose not to attempt at all, after enough
   * consecutive confirmed exhaustions to conclude further attempts were
   * doomed. Distinct from 'live' (a real attempt happened) and 'cache' (a
   * prior real attempt was replayed) — tagging a never-attempted row as
   * 'live' would itself be a provenance inaccuracy of exactly the kind this
   * whole feature exists to prevent. */
  provenance?: {
    source: 'live' | 'cache' | 'skipped';
    raw_provider: string | null;
    governed_provider: string | null;
    governed_source: string | null;
    embed_provider: string | null;
  };
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
  // XSTest contrast set — the 200 genuinely unsafe prompts that XSTest pairs
  // with its 250 safe prompts as a control. Scored with the harm-compliance
  // judge (same as AdvBench/HarmBench/JailbreakBench) to measure false-negative
  // rate: does governance correctly refuse requests that are actually harmful?
  // This is the complementary metric to xstest's over-refusal (false-positive)
  // measurement. Dataset produced by transform-xstest.ts alongside xstest.jsonl.
  xstest_contrast: {
    name: 'XSTest-Contrast',
    kind: 'harm',
    dataFile: 'data/xstest-contrast.jsonl',
    parser: (line: string) => {
      const obj = JSON.parse(line);
      return {
        id: obj.id || `xsc-${Math.random().toString(36).slice(2, 9)}`,
        prompt: obj.prompt || obj.text || '',
        category: obj.category || 'unknown',
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
  /** feat (2026-07-16): which embedding provider served THIS turn's C/R/S
   * measurement. The govern route already returns it (route.ts embed_provider);
   * the runner was discarding it. It matters because Gemini's embed quota is
   * 1,000/day and a production suite issues ~1,764 novel output embeddings, so
   * a full run crosses into mistral-embed partway through — a different, lower-
   * fidelity embedding space (truncated 1024→256, no Matryoshka objective; see
   * lib/lex_memory.ts). Per-request pinning keeps each prompt's bare-vs-governed
   * pair inside ONE space, so the paired delta stays valid — but cross-prompt
   * aggregates silently mix spaces, and until now nothing recorded where the
   * boundary fell. */
  embed_provider?: string | null;
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
        embed_provider: data.embed_provider ?? null,
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
  strong_reject_harm: null,
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
  // fix (2026-07-17): consecutive TOTAL exhaustions (both arms, each already
  // past its own per-prompt retry) — feeds the SUSTAINED_EXHAUSTION_THRESHOLD
  // circuit breaker below. Resets to 0 on any prompt that isn't totally
  // exhausted, so an isolated bad streak doesn't trip it.
  let consecutiveExhaustions = 0;

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
        // A cache replay made no govern call: there is no provider identity to
        // report. Recorded as such rather than imputed from the current run.
        provenance: {
          source: 'cache',
          raw_provider: null,
          governed_provider: null,
          governed_source: null,
          embed_provider: null,
        },
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
        provenance: {
          source: 'live',
          raw_provider: govResponse.raw_provider ?? null,
          governed_provider: govResponse.governed_provider ?? null,
          governed_source: govResponse.governed_source ?? null,
          embed_provider: govResponse.embed_provider ?? null,
        },
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

      // fix (2026-07-17): sustained-exhaustion circuit breaker - see
      // SUSTAINED_EXHAUSTION_THRESHOLD's definition above for the full
      // reasoning. isTotalExhaustion(govResponse) reflects the FINAL state
      // after callGovernAPIWithExhaustionRetry already tried up to
      // MAX_EXHAUSTION_RETRIES times, so this counts prompts that were
      // confirmed exhausted, not just slow.
      if (isTotalExhaustion(govResponse)) {
        consecutiveExhaustions++;
      } else {
        consecutiveExhaustions = 0;
      }

      if (consecutiveExhaustions >= SUSTAINED_EXHAUSTION_THRESHOLD) {
        const remaining = promptsToRun.length - (i + 1);
        console.warn(
          `[${config.name}] CIRCUIT BREAKER: ${consecutiveExhaustions} consecutive TOTAL provider ` +
          `exhaustions (each already past its own retries) - this looks like a SUSTAINED outage ` +
          `(daily quota), not a momentary collision. Skipping the remaining ${remaining} prompt(s) ` +
          `in this benchmark/shard rather than grinding through them for the same doomed outcome. ` +
          `Re-run once provider quota resets.`,
        );
        const skipTimestamp = new Date().toISOString();
        for (let j = i + 1; j < promptsToRun.length; j++) {
          const skippedPrompt = promptsToRun[j];
          const skippedMetrics: OutputMetrics = {
            asr: null, truthful: null, injection_resisted: null,
            xstest_appropriate: null, strong_reject_harm: null,
            judge_method: 'skipped-sustained-exhaustion',
          };
          results.push({
            benchmark: config.name,
            prompt_id: String(skippedPrompt.id),
            prompt: skippedPrompt.prompt,
            raw_output: '',
            governed_output: '',
            bare_metrics: skippedMetrics,
            governed_metrics: skippedMetrics,
            lex_metrics: { C: 0, R: 0, S: 0, M: 0 },
            intervention: false,
            timestamp: skipTimestamp,
            duration_ms: 0,
            provenance: {
              source: 'skipped',
              raw_provider: null, governed_provider: null,
              governed_source: null, embed_provider: null,
            },
          });
        }
        exhaustedCount += remaining;
        break;
      }
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
          strong_reject_harm: null,
          judge_method: 'error',
        },
        governed_metrics: {
          asr: null,
          truthful: null,
          injection_resisted: null,
          xstest_appropriate: null,
          strong_reject_harm: null,
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
