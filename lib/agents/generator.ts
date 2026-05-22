/**
 * Agent 1: Generator
 * Constitutional role: Produce raw output only.
 * Cannot: approve, verify, or govern its own output.
 * Article III — Separation of Powers
 */

import { AgentContext, AgentResult } from './types';
import { env } from '../env';

export async function GeneratorAgent(ctx: AgentContext): Promise<AgentResult> {
  const t = Date.now();
  try {
    const key = env.GROQ_API_KEY;

    // system_prompt is passed explicitly from route.ts for the anchored arm.
    // The bare arm passes no system_prompt → falls back to generic assistant.
    // This separation preserves the raw/anchored transparency contract.
    const systemContent = ctx.system_prompt
      ?? 'You are an AI assistant. Respond naturally and helpfully to the user.';

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: systemContent,
          },
          { role: 'user', content: ctx.prompt },
        ],
        max_tokens: 500,
        // Lower temperature under constitutional pressure — more deterministic responses
        temperature: Math.max(0.1, 0.7 - (ctx.attack_pressure ?? 0) * 0.4),
      }),
    });

    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const d = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { completion_tokens?: number } };
    const output = d.choices?.[0]?.message?.content || '[No output]';
    const tokens = d.usage?.completion_tokens ?? 0;

    return {
      success: true,
      output,
      duration_ms: Date.now() - t,
      meta: { model: 'llama-3.3-70b-versatile', tokens, finish_reason: d.choices?.[0]?.finish_reason },
    };
  } catch (e) {
    return { success: false, error: String(e), duration_ms: Date.now() - t };
  }
}
