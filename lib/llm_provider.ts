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
 * (~1M tokens/day) rather than just burst RPM — the dimension that actually
 * mattered on 2026-07-10, where the failure was sustained exhaustion across
 * a heavy-traffic day, not a burst limit. Placed at different positions in
 * each chain below (not just appended at the end everywhere) so it provides
 * real redundancy against whichever of the three existing providers is
 * currently the bottleneck, rather than only being reached after all three
 * have already failed.
 *
 * Fallback chain (in order, generateWithFallback — the general default):
 *   1. Groq     llama-3.3-70b-versatile  — primary, best quality
 *   2. Groq     llama-3.1-8b-instant     — same provider, higher TPM limit
 *   3. Cerebras llama-3.3-70b            — independent quota, high daily volume
 *   4. Mistral  open-mistral-7b          — different provider, confirmed live
 *   5. Gemini   gemini-3.1-flash-lite    — confirmed live, cost-efficient
 *   6. Gemini   gemini-2.5-flash         — higher capability fallback
 *   7. Static constitutional response    — deterministic, no LLM
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
//
// Ceiling note: the primary generator (Gemini) has ample free-tier throughput
// (hundreds of thousands of tokens/minute) so 8192 is comfortable there. The
// binding constraint is the Groq FALLBACK path, whose free tier caps at roughly
// 6,000-12,000 combined input+output tokens PER MINUTE (not per request) for
// llama-3.3-70b-versatile — a single large completion won't error, but it can
// consume most of that minute's quota and cause the next Groq-fallback request
// to 429 until the window rolls over. 8192 was chosen as a ceiling that stays
// well under the model's own 32k output limit while not being so large that a
// single fallback response reliably exhausts Groq's per-minute budget on its own.
const MAX_OUTPUT_TOKENS = 8192;

export const MODELS = {
  PRIMARY: 'llama-3.3-70b-versatile',
  FAST: 'llama-3.1-8b-instant',
  CEREBRAS: 'llama-3.3-70b',
  MISTRAL: 'open-mistral-7b',
  GEMINI_LITE: 'gemini-3.1-flash-lite',
  GEMINI_FULL: 'gemini-2.5-flash',
  QWEN: 'qwen-2.5-72b-instruct', // Placeholder for future Qwen integration
};

// ── Provider implementations ─────────────────────────────────────────────────

async function tryGroq(messages: LLMMessage[], model: string): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages,
        max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.7,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 429) return null; // rate limit — try next provider
    if (!r.ok) return null;
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content?.trim() ?? null;
  } catch { return null; }
}

// fix (2026-07-10): Cerebras's API is OpenAI-compatible with the identical
// request/response shape as Groq's — same auth pattern (Bearer), same
// chat/completions body, same choices[0].message.content response path.
// Kept as its own function (rather than parameterizing tryGroq with a base
// URL) so each provider's own quirks/rate-limit handling can diverge later
// without entangling the two.
async function tryCerebras(messages: LLMMessage[], model: string): Promise<string | null> {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) return null;
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
    if (r.status === 429) return null; // rate limit — try next provider
    if (!r.ok) return null;
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content?.trim() ?? null;
  } catch { return null; }
}

async function tryMistral(messages: LLMMessage[]): Promise<string | null> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;
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
    if (!r.ok) return null;
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content?.trim() ?? null;
  } catch { return null; }
}

async function tryGemini(messages: LLMMessage[], model: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
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
    if (!r.ok) return null;
    const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch { return null; }
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
 * fix (2026-07-10): added Cerebras's llama-3.3-70b as a same-quality,
 * independent-quota fallback before dropping to smaller/different models —
 * a judge call failing over to a materially weaker model is exactly the
 * mechanism that caused the 2026-07-08 keyword-fallback contamination in
 * the first place, so keeping fallback quality high for as long as possible
 * matters more here than in the general-purpose chains.
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
