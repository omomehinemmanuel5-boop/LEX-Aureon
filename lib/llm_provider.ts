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
 *   1. Groq     llama-3.3-70b-versatile  — primary, best quality
 *   2. Groq     llama-3.1-8b-instant     — same provider; LOWER 6k TPM ceiling
 *                                          than the primary, capped accordingly
 *                                          (see 2026-07-13 fix note below)
 *   3. Cerebras gpt-oss-120b             — independent quota, high daily volume
 *   4. Groq     gpt-oss-120b             — same weights as #3, independent
 *                                          quota bucket on Groq's own
 *                                          infrastructure (see 2026-07-13 fix
 *                                          note below) — resilience, not a
 *                                          capability upgrade over #3
 *   5. Mistral  open-mistral-7b          — different provider, confirmed live
 *   6. Gemini   gemini-3.1-flash-lite    — confirmed live, cost-efficient
 *   7. Gemini   gemini-2.5-flash         — higher capability fallback
 *   8. Static constitutional response    — deterministic, no LLM
 */

import { isOnCooldown, markCooldown } from './provider_cooldown';
import { env } from './env';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResult {
  text: string;
  provider: string;
  model: string;
  fallback_used: boolean;
  attempts: number;
}

const TIMEOUT_MS = 25_000;

// Max response length. Raised 800 → 4096 → 8192 (2026-07): 800 tokens (~600
// words) cut off longer console/chat answers mid-thought; 4096 (~3k words) was
// still not enough for some long-form answers. 8192 (~6k words) covers virtually
// all normal chat/console responses. It is a CAP, not a target — short answers
// stay short, so the cost/latency impact on typical turns is minimal.
const MAX_OUTPUT_TOKENS = 8192;

// fix (2026-07-13) — llama-3.1-8b-instant has a 6,000 TPM ceiling on Groq's
// on_demand tier (confirmed directly against the API's own error response),
// far below every other model in the chain. Groq counts requested max_tokens
// toward that per-minute budget, so sending the global MAX_OUTPUT_TOKENS
// (8192) to this model alone exceeds its entire TPM cap before a single
// input token is counted — confirmed firing on nearly every call to this
// model across two full benchmark runs' worth of Vercel logs (413 "Request
// too large... Limit 6000, Requested 8xxx-9xxx", not intermittent). This
// model sits as the 2nd link in generateWithFallback/generateGoverned's
// chain specifically because the in-code comment assumed it had HIGHER TPM
// headroom than the 70B primary — live evidence says the opposite; as
// configured it was a guaranteed-dead fallback link, wasting one full
// round-trip on every request that reached it instead of ever actually
// catching one. Per-model cap, well under its real ceiling with margin for
// input tokens, restores it as a genuine fallback rather than dead weight.
//
// fix (2026-07-14) — SAME BUG CLASS, SELF-INFLICTED THIS TIME: adding
// reasoning_effort (see GPT_OSS_REASONING_EFFORT below) made openai/gpt-oss-120b
// on Groq hit the identical failure — confirmed directly in Vercel logs from
// the benchmark run that tested this change: "413 Request too large...
// Limit 8000, Requested 9083-9126" on nearly every call. Groq's real TPM
// ceiling for THIS model is 8000, and reasoning tokens count against the
// same max_tokens budget as the final answer — the previous global default
// (8192) was already at the model's ceiling with zero room for reasoning
// tokens or input, guaranteeing overflow the moment reasoning_effort asked
// the model to spend tokens thinking before answering. That benchmark run's
// results are not a valid read on reasoning_effort's real effect: this
// model was a dead fallback link for nearly the entire run, same as FAST
// was before its fix above.
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
  return model === MODELS.CEREBRAS || model === MODELS.GROQ_OSS;
}

export const MODELS = {
  PRIMARY: 'llama-3.3-70b-versatile',
  FAST: 'llama-3.1-8b-instant',
  CEREBRAS: 'gpt-oss-120b', // verified against this account's live GET /v1/models — see file header
  // fix (2026-07-13): same underlying model as CEREBRAS above, but hosted on
  // GROQ's infrastructure instead — an independent quota bucket for the
  // exact model Groq's own deprecation notices confirm they've consolidated
  // Kimi K2, Qwen3-32B, Llama 4 Scout, and DeepSeek-R1-Distill-70B users onto
  // as of mid-2026 (console.groq.com/docs/deprecations), so this is Groq's
  // current recommended model, not a guess. NOT a capability upgrade over
  // CEREBRAS's gpt-oss-120b (same weights) — this is purely resilience: if
  // Cerebras is in cooldown/exhausted, Groq's copy of the same model can
  // still catch the request, and vice versa, rather than falling straight
  // through to a smaller/different model.
  GROQ_OSS: 'openai/gpt-oss-120b',
  MISTRAL: 'open-mistral-7b',
  GEMINI_LITE: 'gemini-3.1-flash-lite',
  GEMINI_FULL: 'gemini-2.5-flash',
  QWEN: 'qwen-2.5-72b-instruct', // Placeholder for future Qwen integration
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

async function tryGroq(messages: LLMMessage[], model: string): Promise<string | null> {
  if (await isOnCooldown('groq', model)) return null; // no request sent — known-dead until cooldown expires
  // NOTE: GROQ_API_KEY is REQUIRED in lib/env.ts (app refuses to start without
  // it), so env.GROQ_API_KEY throws rather than returning undefined if unset —
  // wrong semantics for this fallback chain, which must degrade gracefully to
  // the next provider instead of throwing mid-chain. Reads process.env directly
  // for that reason; see lib/env.ts's REQUIRED set for the enforcement point.
  const key = process.env.GROQ_API_KEY;
  if (!key) { logProviderFailure('groq', 'GROQ_API_KEY not set'); return null; }
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
      return null;
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = d.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) logProviderFailure('groq', `HTTP ${r.status} but no content in response, model=${model}`);
    return text;
  } catch (e) { logProviderFailure('groq', `exception: ${String(e).slice(0, 200)}`); return null; }
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
async function tryCerebras(messages: LLMMessage[], model: string): Promise<string | null> {
  if (await isOnCooldown('cerebras', model)) return null;
  const key = env.CEREBRAS_API_KEY;
  if (!key) { logProviderFailure('cerebras', 'CEREBRAS_API_KEY not set'); return null; }
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
      return null;
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = d.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) logProviderFailure('cerebras', `HTTP ${r.status} but no content in response (reasoning-only?), model=${model}`);
    return text;
  } catch (e) { logProviderFailure('cerebras', `exception: ${String(e).slice(0, 200)}`); return null; }
}

async function tryMistral(messages: LLMMessage[]): Promise<string | null> {
  if (await isOnCooldown('mistral', MODELS.MISTRAL)) return null;
  const key = env.MISTRAL_API_KEY;
  if (!key) { logProviderFailure('mistral', 'MISTRAL_API_KEY not set'); return null; }
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
      return null;
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = d.choices?.[0]?.message?.content?.trim() ?? null;
    if (!text) logProviderFailure('mistral', `HTTP ${r.status} but no content in response`);
    return text;
  } catch (e) { logProviderFailure('mistral', `exception: ${String(e).slice(0, 200)}`); return null; }
}

async function tryGemini(messages: LLMMessage[], model: string): Promise<string | null> {
  if (await isOnCooldown('gemini', model)) return null;
  const key = env.GEMINI_API_KEY;
  if (!key) { logProviderFailure('gemini', 'GEMINI_API_KEY not set'); return null; }
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
      return null;
    }
    const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    if (!text) logProviderFailure('gemini', `HTTP ${r.status} but no content in response, model=${model}`);
    return text;
  } catch (e) { logProviderFailure('gemini', `exception: ${String(e).slice(0, 200)}`); return null; }
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
    { provider: 'groq',     model: MODELS.GROQ_OSS,    fn: () => tryGroq(messages, MODELS.GROQ_OSS) },
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
export async function generateGoverned(
  messages: LLMMessage[],
  staticFallback?: string,
): Promise<LLMResult> {
  const chain: Array<{ provider: string; model: string; fn: () => Promise<string | null> }> = [
    { provider: 'gemini',   model: MODELS.GEMINI_LITE, fn: () => tryGemini(messages, MODELS.GEMINI_LITE) },
    { provider: 'gemini',   model: MODELS.GEMINI_FULL, fn: () => tryGemini(messages, MODELS.GEMINI_FULL) },
    { provider: 'cerebras', model: MODELS.CEREBRAS,    fn: () => tryCerebras(messages, MODELS.CEREBRAS) },
    { provider: 'groq',     model: MODELS.GROQ_OSS,    fn: () => tryGroq(messages, MODELS.GROQ_OSS) },
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
    { provider: 'groq',     model: MODELS.GROQ_OSS,    fn: () => tryGroq(messages, MODELS.GROQ_OSS) },
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
    { provider: 'groq',     model: MODELS.GROQ_OSS,    fn: () => tryGroq(messages, MODELS.GROQ_OSS) },
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
