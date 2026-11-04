/**
 * lib/llm_provider.ts
 *
 * Unified LLM provider with automatic fallback chain.
 * Every agent calls generateWithFallback() — provider switching is transparent.
 *
 * fix (2026-07-10) — ADDED CEREBRAS AS A 4TH PROVIDER: on 2026-07-10, a full
 * LexBench run hit total exhaustion across ALL THREE existing providers
 * (Groq, Gemini, Mistral) simultaneously on the majority of prompts,
 * verified directly against raw output (see lib/benchmark_results.ts's
 * *_RETIRED_PROVIDER_EXHAUSTION_2026-07-10 entries and
 * scripts/migrations/2026-07-10-retire-provider-exhaustion-run.ts). Adding
 * another Groq-hosted model would not have helped — it shares the same
 * account-level TPM ceiling. Cerebras is genuinely independent
 * infrastructure (their own Wafer-Scale Engine hardware, separate account,
 * separate quota), OpenAI-compatible (same request/response shape as
 * tryGroq below), and offers a free tier sized for sustained volume
 * (~1M tokens/day) rather than just burst RPM.
 *
 * MODEL NAME CORRECTION (2026-07-10, same day): the model initially wired in
 * here ("llama-3.3-70b") does not exist on this Cerebras account — verified
 * directly against GET /v1/models, which returned exactly three models:
 * gemma-4-31b, zai-glm-4.7, gpt-oss-120b. Switched to gpt-oss-120b (largest
 * available). It is a REASONING model — chain-of-thought lands in a
 * `reasoning` field, `content` only populates once reasoning finishes and
 * token budget remains. MAX_OUTPUT_TOKENS=8192 gives ample headroom for this
 * (verified directly).
 *
 * fix (2026-07-10, same day, second pass) — NO PER-PROVIDER FAILURE
 * VISIBILITY: a quick-test run after adding Cerebras still showed 80-90%
 * provider exhaustion on most benchmarks — Cerebras alone did not resolve
 * it. But every tryX() function below caught its own errors internally and
 * returned null with ZERO logging, so there was no way to tell whether
 * Cerebras itself was failing (and why), or wasn't being reached at all, or
 * whether Groq/Gemini/Mistral had simply not recovered. duration_ms on the
 * resulting benchmark rows was ~1.3-1.8s per prompt — far too fast to be
 * TIMEOUT_MS (25s) exhausting, meaning providers were failing FAST (like an
 * immediate 401/429), not hanging. Added console.warn on every non-2xx
 * response and every caught exception, tagged '[llm_provider]' with the
 * provider name and either the HTTP status or the error, so the NEXT test
 * run's Vercel logs actually show which provider failed and why, instead of
 * requiring another guess. This is deliberately kept as permanent
 * diagnostic logging, not removed after this investigation — a fallback
 * chain silently swallowing every failure reason is a maintainability gap
 * on its own, independent of today's specific incident.
 *
 * fix (2026-07-12) — RATE/QUOTA COOLDOWN CACHE: diagnosed a slow LexBench run
 * directly against Vercel runtime logs — Gemini (both tiers) returning 429
 * quota-exceeded and Groq 70b returning 429 (94,663/100,000 daily tokens
 * used) on essentially EVERY prompt in the run. The chain had no memory
 * between calls: a provider that had just failed with a 429 on prompt N was
 * re-tried from scratch on prompt N+1, N+2, ... — every single governed AND
 * raw call paying the full round-trip cost (network + provider processing
 * time before the 429 response, not instant) of re-discovering the same
 * already-known-dead provider, before falling through to whatever was left.
 * Added an in-memory cooldown: when a provider fails with a 429 (rate limit)
 * or 402/403 (quota/billing), it's marked dead for COOLDOWN_MS and every
 * chain simply skips it — no request sent — until the cooldown expires. Non
 * rate/quota failures (timeouts, 5xx, malformed responses) do NOT trigger a
 * cooldown, since those are more likely transient/request-specific rather
 * than an account-level exhaustion that will repeat identically on the next
 * call.
 *
 * fix (2026-07-19) — COOLDOWN WAS PER-INSTANCE, NOT PER-DEPLOYMENT: the
 * 2026-07-12 cooldown above was a plain in-memory Map, scoped to ONE Vercel
 * serverless instance. Diagnosed directly from a real benchmark run's
 * provenance data: a sharded run triggers MANY concurrent instances, each
 * with its OWN fresh, empty cooldown state — so instance A discovering
 * Gemini is 429'ing never became visible to instance B, which re-discovered
 * the identical exhaustion from scratch on its own next call, paying the
 * full round-trip cost again. Under a benchmark run's actual concurrency
 * pattern (the exact scenario this mechanism was built for), it was
 * structurally incapable of working. Cooldown state now lives in
 * lib/provider_cooldown.ts, backed by a shared Turso table with a bounded
 * local sync interval — see that file's header for the full design and
 * why it doesn't just move the problem to hammering Turso instead. This
 * part of the 2026-07-19 work is UNAFFECTED by the revert below — it's
 * still live and still correct.
 *
 * fix (2026-07-19, second pass) / REVERTED 2026-07-20 — GENERATEGOVERNED
 * ROTATION ACROSS BASE MODELS WAS A REAL SAFETY REGRESSION, NOT JUST A
 * QUOTA OPTIMIZATION: this function was changed to rotate which of
 * {Gemini-lite, Cerebras, (briefly) Groq-primary} led the chain, to spread
 * load off Gemini. That was a mistake, caught directly by comparing a real
 * post-change benchmark run against the documented historical baseline:
 * JailbreakBench governed ASR had been consistently 4-8.5% across every
 * real run in the preceding week (07-14 through 07-16); the first run after
 * this rotation landed measured 13.04% governed ASR — 2-3x every historical
 * value, with bare-arm ASR also elevated. The mechanism: callLLMRaw (the
 * "bare" baseline arm) calls this SAME function (see
 * lib/sovereign_kernel.ts) — so rotating the underlying model rotated which
 * base model produced BOTH the bare baseline AND the governed response,
 * for every turn. Every historical baseline number was produced by Gemini
 * specifically, every time; Cerebras's gpt-oss-120b and Groq's models are
 * plausibly less resistant to this dataset's specific jailbreak techniques
 * than Gemini is, independent of the constitutional system prompt wrapped
 * around them. This is not proven with a fully controlled per-provider
 * comparison — it's strong circumstantial evidence from a real regression
 * that appeared exactly when the rotation was introduced — but the stakes
 * (a safety metric, not a convenience metric) mean the burden of proof
 * belongs to the change, not the status quo. REVERTED: generateGoverned is
 * now deterministic Gemini-lite-first again, exactly matching the
 * configuration that produced every historical baseline number. The
 * quota-distribution goal is still served by lib/lex_memory.ts's embedding
 * provider rotation (Gemini/Jina) and lib/provider_cooldown.ts's shared
 * cross-instance cooldown — neither of those touches which model generates
 * content, so neither carries this risk. Generation-side load distribution,
 * if revisited, needs a controlled per-provider ASR comparison FIRST, not
 * shipped and checked afterward.
 *
 * Fallback chain (in order, generateWithFallback — the general default):
 *   1. Groq     openai/gpt-oss-120b — primary production model
 *   2. Groq     openai/gpt-oss-20b  — smaller, faster fallback
 *   3. Cerebras gpt-oss-120b        — independent quota, same 120B weights
 *   4. Mistral  open-mistral-7b     — different provider
 *   5. Gemini   gemini-3.1-flash-lite — cost-efficient fallback
 *   6. Gemini   gemini-2.5-flash    — higher-capability fallback
 *   7. Static constitutional response — deterministic, no LLM
 */

import { isOnCooldown, markCooldown } from './provider_cooldown';
import { env } from './env';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProviderFailure {
  category: 'timeout' | 'network_error' | 'http_5xx' | 'rate_limited' | 'quota_or_auth' | 'http_error' | 'provider_error' | 'empty_response' | 'missing_credentials' | 'cooldown' | 'unknown_model' | 'fallback_used';
  retryable: boolean;
  status?: number;
}

export interface LLMResult {
  text: string;
  provider: string;
  model: string;
  fallback_used: boolean;
  attempts: number;
  failure?: LLMProviderFailure;
}

const TIMEOUT_MS = 25_000;
// Benchmark-only retries: one initial call plus at most two same-model retries.
// Request timeouts, transport failures, and selected transient 5xx responses
// are retryable; quota/auth, client, empty-response, and model parse failures are not.
const PINNED_MAX_ATTEMPTS = 3;
const PINNED_RETRY_DELAYS_MS = [500, 1_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

type FailureReporter = (failure: LLMProviderFailure) => void;

export async function retryPinnedCall<T>(
  call: (reportFailure: FailureReporter) => Promise<T | null>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ result: T | null; attempts: number; failure?: LLMProviderFailure }> {
  let attempts = 0;
  let lastFailure: LLMProviderFailure | undefined;
  while (attempts < PINNED_MAX_ATTEMPTS) {
    let attemptFailure: LLMProviderFailure | undefined;
    attempts++;
    const result = await call(failure => { attemptFailure = failure; });
    if (result !== null && result !== '') return { result, attempts };
    lastFailure = attemptFailure ?? { category: 'provider_error', retryable: false };
    if (!lastFailure.retryable || attempts >= PINNED_MAX_ATTEMPTS) break;
    await wait(PINNED_RETRY_DELAYS_MS[attempts - 1]);
  }
  return { result: null, attempts, failure: lastFailure ?? { category: 'provider_error', retryable: false } };
}

function httpFailure(status: number): LLMProviderFailure {
  if ([500, 502, 503, 504].includes(status)) return { category: 'http_5xx', retryable: true, status };
  if (status === 429) return { category: 'rate_limited', retryable: false, status };
  if (status === 402 || status === 403) return { category: 'quota_or_auth', retryable: false, status };
  return { category: 'http_error', retryable: false, status };
}

function exceptionFailure(error: unknown): LLMProviderFailure {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = name === 'TimeoutError' || /timed?\s*out|timeout/i.test(message);
  const networkFailure = error instanceof TypeError || /fetch failed|network|socket|ECONNRESET|EAI_AGAIN|ENOTFOUND/i.test(message);
  return {
    category: timedOut ? 'timeout' : networkFailure ? 'network_error' : 'provider_error',
    retryable: timedOut || networkFailure,
  };
}

// Max response length. Raised 800 → 4096 → 8192 (2026-07): 800 tokens (~600
// words) cut off longer console/chat answers mid-thought; 4096 (~3k words) was
// still not enough for some long-form answers. 8192 (~6k words) covers virtually
// all normal chat/console responses. It is a CAP, not a target — short answers
// stay short, so the cost/latency impact on typical turns is minimal.
const MAX_OUTPUT_TOKENS = 8192;

// Keep reasoning-model completion budgets below Groq's TPM ceiling: requested
// output tokens count toward the limit before input tokens are considered.
// GPT-OSS uses reasoning tokens as well as visible output, so a conservative
// 4,000-token cap avoids the guaranteed 413 failures seen with the old 8,192 cap.
function maxTokensFor(model: string): number {
  if (model === MODELS.FAST) return 2048;
  if (isReasoningModel(model)) return 4000;
  return MAX_OUTPUT_TOKENS;
}

// fix (2026-07-14) — REASONING LAYER FOR GPT-OSS-120B: confirmed live against
// current Groq and Cerebras documentation that `reasoning_effort` (low /
// medium / high) is a real, currently-supported parameter for gpt-oss-120b
// on both providers — the model does chain-of-thought internally by default,
// this parameter controls how much of it. Not set anywhere previously, so
// the model was running at whatever its provider-side default is.
//
// Set to 'medium', not 'high', deliberately: a live smoke test earlier this
// session measured one governed call at 22.5s against this file's 25s
// TIMEOUT_MS. Higher reasoning effort means more latency before the model
// commits to an answer — pushing straight to 'high' risks tipping more
// calls over that ceiling, which would mean MORE fallback-chain failures,
// not fewer. 'medium' is the deliberately conservative starting point.
//
// To raise to 'high' later: change this one constant, redeploy. No other
// code changes, no migration — same as any other config value.
const GPT_OSS_REASONING_EFFORT: 'low' | 'medium' | 'high' = 'medium';

function isReasoningModel(model: string): boolean {
  return model === MODELS.CEREBRAS || model === MODELS.PRIMARY || model === MODELS.FAST;
}

export const MODELS = {
  // Groq deprecated both Llama model IDs on 2026-08-16. Use documented
  // production replacements instead of guaranteed HTTP 404 fallback calls.
  PRIMARY: 'openai/gpt-oss-120b',
  FAST: 'openai/gpt-oss-20b',
  CEREBRAS: 'gpt-oss-120b', // verified against this account's live GET /v1/models — see file header
  MISTRAL: 'open-mistral-7b',
  GEMINI_LITE: 'gemini-3.1-flash-lite',
  GEMINI_FULL: 'gemini-2.5-flash',
};

// fix (2026-07-10): tag every provider failure with a reason so Vercel logs
// (filterable on '[llm_provider]') show exactly which provider failed, with
// what HTTP status or error, instead of every failure being silently
// swallowed as an opaque null.
function logProviderFailure(provider: string, reason: string): void {
  console.warn(`[llm_provider] ${provider} failed: ${reason}`);
}

// ── Rate/quota cooldown (2026-07-12, made cross-instance 2026-07-19) ──────────
// See lib/provider_cooldown.ts for the shared implementation and why it
// replaced the plain in-memory Map that used to live here.
const COOLDOWN_MS = 3 * 60 * 1000; // 3 min — short enough to recover promptly if quota resets mid-run, long enough to skip the bulk of a burst of same-cause 429s

// Only rate-limit/quota signals (429, 402, 403) mark a cooldown. Other
// failures (timeouts, 5xx, malformed/empty responses) are more likely
// transient or request-specific, not an account-level exhaustion that will
// reproduce identically on the very next call — see file header.
function markCooldownIfRateLimited(provider: string, model: string, status: number | null): void {
  if (status === 429 || status === 402 || status === 403) {
    markCooldown(provider, model, COOLDOWN_MS, `HTTP ${status}`);
    logProviderFailure(provider, `entering ${COOLDOWN_MS / 1000}s cross-instance cooldown for model=${model} after HTTP ${status}`);
  }
}

// ── Provider implementations ─────────────────────────────────────────────────

async function tryGroq(messages: LLMMessage[], model: string, onFailure?: FailureReporter): Promise<string | null> {
  if (await isOnCooldown('groq', model)) {
    onFailure?.({ category: 'cooldown', retryable: false });
    return null; // no request sent — known-dead until cooldown expires
  }
  // NOTE: GROQ_API_KEY is REQUIRED in lib/env.ts (app refuses to start without
  // it), so env.GROQ_API_KEY throws rather than returning undefined if unset —
  // wrong semantics for this fallback chain, which must degrade gracefully to
  // the next provider instead of throwing mid-chain. Reads process.env directly
  // for that reason; see lib/env.ts's REQUIRED set for the enforcement point.
  const key = process.env.GROQ_API_KEY;
  if (!key) { logProviderFailure('groq', 'GROQ_API_KEY not set'); onFailure?.({ category: 'missing_credentials', retryable: false }); return null; }
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages,
        max_tokens: maxTokensFor(model), temperature: 0.7,
        reasoning_effort: isReasoningModel(model) ? GPT_OSS_REASONING_EFFORT : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logProviderFailure('groq', `HTTP ${r.status} model=${model} ${body.slice(0, 200)}`);
      markCooldownIfRateLimited('groq', model, r.status);
      onFailure?.(httpFailure(r.status));
      return null;
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = d.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) {
      logProviderFailure('groq', `HTTP ${r.status} but no content in response, model=${model}`);
      onFailure?.({ category: 'empty_response', retryable: false, status: r.status });
    }
    return text || null;
  } catch (e) {
    logProviderFailure('groq', `exception: ${String(e).slice(0, 200)}`);
    onFailure?.(exceptionFailure(e));
    return null;
  }
}

// fix (2026-07-10): Cerebras's API is OpenAI-compatible with the identical
// request/response shape as Groq's — same auth pattern (Bearer), same
// chat/completions body, same choices[0].message.content response path (the
// current model, gpt-oss-120b, ALSO returns a separate `reasoning` field —
// see file header — but `content` is populated correctly once the model has
// enough token budget, so this extraction logic needs no special-casing for
// that). Kept as its own function (rather than parameterizing tryGroq with a
// base URL) so each provider's own quirks/rate-limit handling can diverge
// later without entangling the two.
async function tryCerebras(messages: LLMMessage[], model: string, onFailure?: FailureReporter): Promise<string | null> {
  if (await isOnCooldown('cerebras', model)) { onFailure?.({ category: 'cooldown', retryable: false }); return null; }
  const key = env.CEREBRAS_API_KEY;
  if (!key) { logProviderFailure('cerebras', 'CEREBRAS_API_KEY not set'); onFailure?.({ category: 'missing_credentials', retryable: false }); return null; }
  try {
    const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages,
        max_tokens: maxTokensFor(model), temperature: 0.7,
        reasoning_effort: isReasoningModel(model) ? GPT_OSS_REASONING_EFFORT : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logProviderFailure('cerebras', `HTTP ${r.status} model=${model} ${body.slice(0, 200)}`);
      markCooldownIfRateLimited('cerebras', model, r.status);
      onFailure?.(httpFailure(r.status));
      return null;
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = d.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) {
      logProviderFailure('cerebras', `HTTP ${r.status} but no content in response (reasoning-only?), model=${model}`);
      onFailure?.({ category: 'empty_response', retryable: false, status: r.status });
    }
    return text || null;
  } catch (e) {
    logProviderFailure('cerebras', `exception: ${String(e).slice(0, 200)}`);
    onFailure?.(exceptionFailure(e));
    return null;
  }
}

async function tryMistral(messages: LLMMessage[], onFailure?: FailureReporter): Promise<string | null> {
  if (await isOnCooldown('mistral', MODELS.MISTRAL)) { onFailure?.({ category: 'cooldown', retryable: false }); return null; }
  const key = env.MISTRAL_API_KEY;
  if (!key) { logProviderFailure('mistral', 'MISTRAL_API_KEY not set'); onFailure?.({ category: 'missing_credentials', retryable: false }); return null; }
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'open-mistral-7b', messages,
        max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.7,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logProviderFailure('mistral', `HTTP ${r.status} ${body.slice(0, 200)}`);
      markCooldownIfRateLimited('mistral', MODELS.MISTRAL, r.status);
      onFailure?.(httpFailure(r.status));
      return null;
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = d.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) {
      logProviderFailure('mistral', `HTTP ${r.status} but no content in response`);
      onFailure?.({ category: 'empty_response', retryable: false, status: r.status });
    }
    return text || null;
  } catch (e) {
    logProviderFailure('mistral', `exception: ${String(e).slice(0, 200)}`);
    onFailure?.(exceptionFailure(e));
    return null;
  }
}

async function tryGemini(messages: LLMMessage[], model: string, onFailure?: FailureReporter): Promise<string | null> {
  if (await isOnCooldown('gemini', model)) { onFailure?.({ category: 'cooldown', retryable: false }); return null; }
  const key = env.GEMINI_API_KEY;
  if (!key) { logProviderFailure('gemini', 'GEMINI_API_KEY not set'); onFailure?.({ category: 'missing_credentials', retryable: false }); return null; }
  try {
    // Convert to Gemini format
    const system = messages.find(m => m.role === 'system')?.content;
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.7 },
    };
    if (system) body.system_instruction = { parts: [{ text: system }] };

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (!r.ok) {
      const respBody = await r.text().catch(() => '');
      logProviderFailure('gemini', `HTTP ${r.status} model=${model} ${respBody.slice(0, 200)}`);
      markCooldownIfRateLimited('gemini', model, r.status);
      onFailure?.(httpFailure(r.status));
      return null;
    }
    const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    if (!text) {
      logProviderFailure('gemini', `HTTP ${r.status} but no content in response, model=${model}`);
      onFailure?.({ category: 'empty_response', retryable: false, status: r.status });
    }
    return text || null;
  } catch (e) {
    logProviderFailure('gemini', `exception: ${String(e).slice(0, 200)}`);
    onFailure?.(exceptionFailure(e));
    return null;
  }
}

// ── Main fallback chain ───────────────────────────────────────────────────────

export async function generateWithFallback(
  messages: LLMMessage[],
  staticFallback?: string,
): Promise<LLMResult> {

  const chain: Array<{ provider: string; model: string; fn: () => Promise<string | null> }> = [
    { provider: 'groq',     model: MODELS.PRIMARY,     fn: () => tryGroq(messages, MODELS.PRIMARY) },
    { provider: 'groq',     model: MODELS.FAST,        fn: () => tryGroq(messages, MODELS.FAST) },
    { provider: 'cerebras', model: MODELS.CEREBRAS,    fn: () => tryCerebras(messages, MODELS.CEREBRAS) },
    { provider: 'mistral',  model: MODELS.MISTRAL,     fn: () => tryMistral(messages) },
    { provider: 'gemini',   model: MODELS.GEMINI_LITE, fn: () => tryGemini(messages, MODELS.GEMINI_LITE) },
    { provider: 'gemini',   model: MODELS.GEMINI_FULL, fn: () => tryGemini(messages, MODELS.GEMINI_FULL) },
  ];

  for (let i = 0; i < chain.length; i++) {
    const { provider, model, fn } = chain[i];
    const result = await fn();
    if (result) {
      return {
        text:          result,
        provider,
        model,
        fallback_used: i > 0,
        attempts:      i + 1,
      };
    }
  }

  // Static fallback — always succeeds
  return {
    text:          staticFallback ?? 'Constitutional framework C + R + S = 1 is operative. How can I help you?',
    provider:      'static',
    model:         'constitutional-fallback',
    fallback_used: true,
    attempts:      chain.length + 1,
  };
}

// ── Convenience: single message ───────────────────────────────────────────────

export async function generateSingle(
  systemPrompt: string,
  userPrompt: string,
  staticFallback?: string,
): Promise<LLMResult> {
  return generateWithFallback(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    staticFallback,
  );
}

// ── Purpose-specific generators — each uses optimal provider for its role ──

/**
 * Governed arm generation — Gemini-lite primary, deterministic (REVERTED
 * 2026-07-20 — see file header). Serves BOTH the raw and governed arms of
 * every turn (see lib/sovereign_kernel.ts's callLLMRaw), which is exactly
 * why this needs to be deterministic: rotating the underlying model here
 * rotates which model produces BOTH the bare baseline and the governed
 * response, and a real benchmark run showed that moved a safety metric
 * (JailbreakBench ASR) 2-3x worse than every historical value the moment
 * rotation was introduced. Quota distribution for generation specifically
 * is not attempted here anymore — see lib/lex_memory.ts (embedding
 * rotation) and lib/provider_cooldown.ts (shared cooldown) for the parts
 * of the 2026-07-19 distribution work that are safe and still active.
 *
 * Role: produce the constitutionally governed response every turn.
 */
/**
 * Benchmark-only single-model generation. This deliberately does not fall
 * through to another provider: controlled comparisons must either use the
 * requested model or record the task as excluded. Production callers should
 * continue using generateGoverned().
 */
export async function generateGovernedPinned(
  messages: LLMMessage[],
  model: string,
  staticFallback?: string,
): Promise<LLMResult> {
  const choices: Record<string, { provider: string; fn: (onFailure?: FailureReporter) => Promise<string | null> }> = {
    [MODELS.GEMINI_LITE]: { provider: 'gemini', fn: onFailure => tryGemini(messages, MODELS.GEMINI_LITE, onFailure) },
    [MODELS.GEMINI_FULL]: { provider: 'gemini', fn: onFailure => tryGemini(messages, MODELS.GEMINI_FULL, onFailure) },
    [MODELS.CEREBRAS]: { provider: 'cerebras', fn: onFailure => tryCerebras(messages, MODELS.CEREBRAS, onFailure) },
    [MODELS.PRIMARY]: { provider: 'groq', fn: onFailure => tryGroq(messages, MODELS.PRIMARY, onFailure) },
    [MODELS.FAST]: { provider: 'groq', fn: onFailure => tryGroq(messages, MODELS.FAST, onFailure) },
    [MODELS.MISTRAL]: { provider: 'mistral', fn: onFailure => tryMistral(messages, onFailure) },
  };
  const choice = choices[model];
  if (!choice) {
    return { text: staticFallback ?? '', provider: 'unknown', model, fallback_used: true, attempts: 0, failure: { category: 'unknown_model', retryable: false } };
  }
  const { result, attempts, failure } = await retryPinnedCall<string>(choice.fn);
  if (result !== null) return { text: result, provider: choice.provider, model, fallback_used: false, attempts };
  return {
    text: staticFallback ?? '', provider: choice.provider, model, fallback_used: true, attempts,
    failure: failure ?? { category: 'provider_error', retryable: false },
  };
}

export async function generateGoverned(
  messages: LLMMessage[],
  staticFallback?: string,
): Promise<LLMResult> {
  const chain: Array<{ provider: string; model: string; fn: () => Promise<string | null> }> = [
    { provider: 'gemini',   model: MODELS.GEMINI_LITE, fn: () => tryGemini(messages, MODELS.GEMINI_LITE) },
    { provider: 'gemini',   model: MODELS.GEMINI_FULL, fn: () => tryGemini(messages, MODELS.GEMINI_FULL) },
    { provider: 'cerebras', model: MODELS.CEREBRAS,    fn: () => tryCerebras(messages, MODELS.CEREBRAS) },
    { provider: 'groq',     model: MODELS.PRIMARY,     fn: () => tryGroq(messages, MODELS.PRIMARY) },
    { provider: 'groq',     model: MODELS.FAST,        fn: () => tryGroq(messages, MODELS.FAST) },
    { provider: 'mistral',  model: MODELS.MISTRAL,     fn: () => tryMistral(messages) },
  ];
  for (let i = 0; i < chain.length; i++) {
    const { provider, model, fn } = chain[i];
    const result = await fn();
    if (result) return { text: result, provider, model, fallback_used: i > 0, attempts: i + 1 };
  }
  return { text: staticFallback ?? 'Constitutional framework C + R + S = 1 is operative.', provider: 'static', model: 'constitutional-fallback', fallback_used: true, attempts: chain.length + 1 };
}

/**
 * Intervention rewrite — Mistral primary (different provider to Groq).
 * Avoids concentrating all load on one provider during adversarial prompt handling.
 *
 * Role: rewrite governed output using Vaulturex law as the generative engine.
 */
export async function generateRewrite(
  messages: LLMMessage[],
  staticFallback?: string,
): Promise<LLMResult> {
  const chain: Array<{ provider: string; model: string; fn: () => Promise<string | null> }> = [
    { provider: 'mistral',  model: MODELS.MISTRAL,     fn: () => tryMistral(messages) },
    { provider: 'cerebras', model: MODELS.CEREBRAS,    fn: () => tryCerebras(messages, MODELS.CEREBRAS) },
    { provider: 'gemini',   model: MODELS.GEMINI_LITE, fn: () => tryGemini(messages, MODELS.GEMINI_LITE) },
    { provider: 'groq',     model: MODELS.FAST,        fn: () => tryGroq(messages, MODELS.FAST) },
    { provider: 'groq',     model: MODELS.PRIMARY,     fn: () => tryGroq(messages, MODELS.PRIMARY) },
  ];
  for (let i = 0; i < chain.length; i++) {
    const { provider, model, fn } = chain[i];
    const result = await fn();
    if (result) return { text: result, provider, model, fallback_used: i > 0, attempts: i + 1 };
  }
  return { text: staticFallback ?? 'Constitutional rewrite applied.', provider: 'static', model: 'constitutional-fallback', fallback_used: true, attempts: chain.length + 1 };
}

/**
 * Constitutional judge — Groq 70B primary.
 *
 * fix (2026-07-08): was llama-3.1-8b-instant primary. The 8B model produced
 * unparseable verdicts often enough that lexbench judges' fallback paths
 * (originally naive keyword-refusal heuristics) were getting exercised at
 * meaningful rates, contaminating scored results — see AdvBench id=74
 * retirement in lib/benchmark_results.ts. 70B is the closest publicly
 * available match to JailbreakBench's own paper judge (Llama-3-70B) and
 * produces far fewer unparseable/malformed verdicts. 8B stays in the chain
 * as a same-provider fallback (higher TPM headroom) if 70B's stricter rate
 * limit is hit, not because it's an adequate primary judge on its own.
 *
 * fix (2026-07-10): added Cerebras's gpt-oss-120b as a same-class-size,
 * independent-quota fallback before dropping to smaller/different models.
 *
 * Never rotated — verdict-provider consistency across a scored benchmark
 * run has real value, and (2026-07-20) generateGoverned no longer competes
 * with it for Groq's quota either — see that function's docstring.
 *
 * Role: score model outputs against benchmark rubrics (harm-compliance,
 * truthfulness, injection-resistance, over-refusal, refusal-severity) and,
 * separately, validate that intervention output resists a harmful request.
 */
export async function generateJudge(
  messages: LLMMessage[],
): Promise<LLMResult> {
  const chain: Array<{ provider: string; model: string; fn: () => Promise<string | null> }> = [
    { provider: 'groq',     model: MODELS.PRIMARY,     fn: () => tryGroq(messages, MODELS.PRIMARY) },
    { provider: 'cerebras', model: MODELS.CEREBRAS,    fn: () => tryCerebras(messages, MODELS.CEREBRAS) },
    { provider: 'groq',     model: MODELS.FAST,        fn: () => tryGroq(messages, MODELS.FAST) },
    { provider: 'gemini',   model: MODELS.GEMINI_LITE, fn: () => tryGemini(messages, MODELS.GEMINI_LITE) },
    { provider: 'mistral',  model: MODELS.MISTRAL,     fn: () => tryMistral(messages) },
  ];
  for (let i = 0; i < chain.length; i++) {
    const { provider, model, fn } = chain[i];
    const result = await fn();
    if (result) return { text: result, provider, model, fallback_used: i > 0, attempts: i + 1 };
  }
  return { text: 'RESIST', provider: 'static', model: 'constitutional-fallback', fallback_used: true, attempts: chain.length + 1 };
}
