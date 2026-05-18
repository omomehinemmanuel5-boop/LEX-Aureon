/**
 * Streaming Generator
 * Same constitutional role as GeneratorAgent (Article III) but yields tokens
 * as they arrive from Groq so the UI can render mid-flight.
 *
 * Returns an async iterable of token deltas (strings).
 * Internally accumulates the full output for the post-stream pipeline.
 */

import { env } from '../env';

export interface StreamedGeneration {
  tokens: AsyncIterable<string>;
  done: Promise<{ output: string; model: string; tokens_emitted: number; finish_reason?: string }>;
}

export function streamGeneration(prompt: string, attack_pressure: number = 0): StreamedGeneration {
  let resolveDone: (v: { output: string; model: string; tokens_emitted: number; finish_reason?: string }) => void;
  let rejectDone: (e: unknown) => void;
  const done = new Promise<{ output: string; model: string; tokens_emitted: number; finish_reason?: string }>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  async function* iterate(): AsyncIterable<string> {
    const key = env.GROQ_API_KEY;
    let output = '';
    let tokensEmitted = 0;
    let finishReason: string | undefined;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are an AI assistant. Respond naturally and helpfully to the user.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 500,
          temperature: Math.max(0.1, 0.7 - attack_pressure * 0.4),
          stream: true,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok || !res.body) throw new Error(`Groq ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: { delta?: { content?: string }; finish_reason?: string }[];
            };
            const token = parsed.choices?.[0]?.delta?.content;
            const fr = parsed.choices?.[0]?.finish_reason;
            if (fr) finishReason = fr;
            if (token) {
              output += token;
              tokensEmitted += 1;
              yield token;
            }
          } catch { /* malformed chunk, ignore */ }
        }
      }

      resolveDone({ output, model: 'llama-3.3-70b-versatile', tokens_emitted: tokensEmitted, finish_reason: finishReason });
    } catch (e) {
      rejectDone(e);
      throw e;
    }
  }

  return { tokens: iterate(), done };
}
