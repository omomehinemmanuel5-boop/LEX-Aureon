/**
 * Lex CRS Agent — Multi-Model Router
 * Routes tasks to the right free LLM based on context size and task type.
 *
 * Model selection:
 *   Groq llama-3.3-70b  — primary reasoning, function calling, fast
 *   Groq llama-3.1-8b   — small fast tasks (used as explicit override only)
 *   Gemini 2.0 Flash    — large context (entire codebase), 1M token window, free
 */

import { env } from '../env';
import { TOOL_DEFINITIONS } from './tools';

export type ModelId = 'groq-70b' | 'groq-8b' | 'gemini-flash';

// Gemini model — use 2.0-flash (free, 1M context, function calling)
// Fallback: gemini-1.5-flash-latest
const GEMINI_MODEL = 'gemini-2.0-flash';

export interface Message {
  role:    'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?:   string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id:       string;
  type:     'function';
  function: { name: string; arguments: string };
}

export interface LLMResponse {
  content:    string | null;
  tool_calls: ToolCall[];
  model:      ModelId;
}

// ── Model selector ────────────────────────────────────────────────────────────
export function selectModel(messages: Message[]): ModelId {
  const totalTokenEstimate = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) / 4;
  if (totalTokenEstimate > 30_000) return 'gemini-flash'; // large context → Gemini 1M window
  return 'groq-70b';                                       // default: best reasoning
}

// ── Groq call ─────────────────────────────────────────────────────────────────
async function callGroq(messages: Message[], model: 'groq-70b' | 'groq-8b'): Promise<LLMResponse> {
  const groqModel = model === 'groq-70b' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';

  const formatted = messages.map(m => {
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.name ?? 'tool' };
    if (m.tool_calls?.length) return { role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls };
    return { role: m.role, content: m.content };
  });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       groqModel,
      messages:    formatted,
      tools:       TOOL_DEFINITIONS.map(t => ({ type: 'function', function: t })),
      tool_choice: 'auto',
      max_tokens:  4096,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    // On rate limit, fall through to Gemini if available
    if (res.status === 429 && env.GEMINI_API_KEY) {
      return callGemini(messages);
    }
    throw new Error(`Groq ${res.status}: ${errText}`);
  }
  const d = await res.json() as {
    choices: Array<{ message: { content?: string; tool_calls?: ToolCall[] } }>
  };
  const msg = d.choices[0].message;
  return { content: msg.content ?? null, tool_calls: msg.tool_calls ?? [], model };
}

// ── Gemini call ───────────────────────────────────────────────────────────────
async function callGemini(messages: Message[]): Promise<LLMResponse> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set — add it in Vercel environment variables');

  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content ?? '' }],
    }));

  const systemInstruction = messages.find(m => m.role === 'system')?.content;

  const body: Record<string, unknown> = {
    contents,
    tools: [{
      function_declarations: TOOL_DEFINITIONS.map(t => ({
        name:        t.name,
        description: t.description,
        parameters:  t.parameters,
      })),
    }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
  };
  if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const d = await res.json() as {
    candidates: Array<{
      content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> }
    }>
  };

  const parts  = d.candidates[0].content.parts;
  const text   = parts.find(p => p.text)?.text ?? null;
  const fnCall = parts.find(p => p.functionCall)?.functionCall;

  const tool_calls: ToolCall[] = fnCall ? [{
    id:       `gemini-${Date.now()}`,
    type:     'function',
    function: { name: fnCall.name, arguments: JSON.stringify(fnCall.args) },
  }] : [];

  return { content: text, tool_calls, model: 'gemini-flash' };
}

// ── Main router ───────────────────────────────────────────────────────────────
export async function callLLM(messages: Message[], forceModel?: ModelId): Promise<LLMResponse> {
  const model = forceModel ?? selectModel(messages);
  if (model === 'gemini-flash') return callGemini(messages);
  return callGroq(messages, model);
}
