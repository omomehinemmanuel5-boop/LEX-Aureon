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
 * call. Cooldown state is per-serverless-instance (module-level Map, not
 * persisted) — it self-heals on cold start and does not need a TTL sweep
 * beyond the per-entry expiry check at lookup time. This does not change
 * correctness (a real recovery within the cooldown window just means one
 * skipped attempt that would have failed anyway); it only removes the
 * repeated cost of asking a provider a question whose answer is already
 * known for the next few minutes.
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
function maxTokensFor(model: string): number {
  if (model === MODELS.FAST) return 2048;
  return MAX_OUTPUT_TOKENS;
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

// ── Rate/quota cooldown cache (2026-07-12) — see file header ──────────────────
// Keyed by "provider:model" so e.g. Gemini lite and Gemini full (separate
// quota buckets on Google's side, confirmed by them failing independently in
// the diagnosing run) don't share a cooldown incorrectly.
const COOLDOWN_MS = 3 * 60 * 1000; // 3 min — short enough to recover promptly if quota resets mid-run, long enough to skip the bulk of a burst of same-cause 429s
const _cooldownUntil = new Map<string, number>();

function cooldownKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function isOnCooldown(provider: string, model: string): boolean {
  const until = _cooldownUntil.get(cooldownKey(provider, model));
  return until !== undefined && Date.now() < until;
}

// Only rate-limit/quota signals (429, 402, 403) mark a cooldown. Other
// failures (timeouts, 5xx, malformed/empty responses) are more likely
// transient or request-specific, not an account-level exhaustion that will
// reproduce identically on the very next call — see file header.
function markCooldownIfRateLimited(provider: string, model: string, status: number | null): void {
  if (status === 429 || status === 402 || status === 403) {
    _cooldownUntil.set(cooldownKey(provider, model), Date.now() + COOLDOWN_MS);
    logProviderFailure(provider, `entering ${COOLDOWN_MS / 1000}s cooldown for model=${model} after HTTP ${status}`);
  }
}

// ── Provider implementations ─────────────────────────────────────────────────

async function tryGroq(messages: LLMMessage[], model: string): Promise<string | null> {
  if (isOnCooldown('groq', model)) return null; // no request sent — known-dead until cooldown expires
  const key = process.env.GROQ_API_KEY;
  if (!key) { logProviderFailure('groq', 'GROQ_API_KEY not set'); return null; }
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages,
        max_tokens: maxTokensFor(model), temperature: 0.7,
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
  if (isOnCooldown('cerebras', model)) return null;
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) { logProviderFailure('cerebras', 'CEREBRAS_API_KEY not set'); return null; }
  try {
    const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages,
        max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.7,
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
  if (isOnCooldown('mistral', MODELS.MISTRAL)) return null;
  const key = process.env.MISTRAL_API_KEY;
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
  if (isOnCooldown('gemini', model)) return null;
  const key = process.env.GEMINI_API_KEY;
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
 * Governed arm generation — Gemini primary (1,000 RPM free tier).
 * Rate-limit-proof for benchmarks. Falls back to Cerebras/Groq if Gemini fails.
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
