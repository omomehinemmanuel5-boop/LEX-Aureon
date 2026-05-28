/**
 * lib/llm_provider.ts
 *
 * Unified LLM provider with automatic fallback chain.
 * Every agent calls generateWithFallback() — provider switching is transparent.
 *
 * Fallback chain (in order):
 *   1. Groq  llama-3.3-70b-versatile  — primary, best quality
 *   2. Groq  llama-3.1-8b-instant     — same provider, higher TPM limit
 *   3. Mistral open-mistral-7b         — different provider, confirmed live
 *   4. Gemini gemini-3.1-flash-lite    — confirmed live, cost-efficient
 *   5. Gemini gemini-2.5-flash         — higher capability fallback
 *   6. Static constitutional response  — deterministic, no LLM
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
        max_tokens: 800, temperature: 0.7,
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
        max_tokens: 800, temperature: 0.7,
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
      generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
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
    { provider: 'groq',    model: 'llama-3.3-70b-versatile', fn: () => tryGroq(messages, 'llama-3.3-70b-versatile') },
    { provider: 'groq',    model: 'llama-3.1-8b-instant',    fn: () => tryGroq(messages, 'llama-3.1-8b-instant') },
    { provider: 'mistral', model: 'open-mistral-7b',          fn: () => tryMistral(messages) },
    { provider: 'gemini',  model: 'gemini-3.1-flash-lite',    fn: () => tryGemini(messages, 'gemini-3.1-flash-lite') },
    { provider: 'gemini',  model: 'gemini-2.5-flash',         fn: () => tryGemini(messages, 'gemini-2.5-flash') },
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
