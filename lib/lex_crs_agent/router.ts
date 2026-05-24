/**
 * Lex CRS Agent — Multi-Model Router
 *
 * Models:
 *   claude        — claude-sonnet-4-20250514     (primary, best reasoning + coding)
 *   groq-70b      — Groq llama-3.3-70b-versatile (free, fast)
 *   groq-8b       — Groq llama-3.1-8b-instant    (free, lightweight)
 *   gemini-flash  — Gemini 2.0 Flash             (free, 1M context)
 */

import { env } from '../env';
import { TOOL_DEFINITIONS } from './tools';

export type ModelId = 'claude' | 'groq-70b' | 'groq-8b' | 'gemini-flash';
const GEMINI_MODEL = 'gemini-2.0-flash';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

export interface Message {
  role:        'system' | 'user' | 'assistant' | 'tool';
  content:     string;
  name?:       string;
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

// ── Model selector ─────────────────────────────────────────────────────────
export function selectModel(): ModelId {
  if (env.ANTHROPIC_API_KEY) return 'claude';
  if (env.GROQ_API_KEY)      return 'groq-70b';
  if (env.GEMINI_API_KEY)    return 'gemini-flash';
  throw new Error('No LLM API key configured. Add ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY to Vercel.');
}

// ── Claude ─────────────────────────────────────────────────────────────────
async function callClaude(messages: Message[]): Promise<LLMResponse> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set.');

  const system  = messages.find(m => m.role === 'system')?.content ?? '';
  const history = messages.filter(m => m.role !== 'system');

  // Convert to Anthropic message format
  const formatted = history.map(m => {
    if (m.role === 'tool') {
      return {
        role:    'user' as const,
        content: [{
          type:        'tool_result',
          tool_use_id: m.name ?? 'tool',
          content:     m.content,
        }],
      };
    }
    if (m.tool_calls?.length) {
      return {
        role:    'assistant' as const,
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.tool_calls.map(tc => ({
            type:  'tool_use',
            id:    tc.id,
            name:  tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        ],
      };
    }
    return { role: m.role as 'user' | 'assistant', content: m.content };
  });

  const tools = TOOL_DEFINITIONS.map(t => ({
    name:         t.name,
    description:  t.description,
    input_schema: t.parameters,
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 4096,
      system,
      messages:   formatted,
      tools,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);

  const d = await res.json() as {
    content: Array<{
      type:  string;
      text?: string;
      id?:   string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    stop_reason: string;
  };

  const textBlock = d.content.find(b => b.type === 'text');
  const toolBlocks = d.content.filter(b => b.type === 'tool_use');

  const tool_calls: ToolCall[] = toolBlocks.map(b => ({
    id:       b.id ?? `claude-${Date.now()}`,
    type:     'function' as const,
    function: {
      name:      b.name ?? '',
      arguments: JSON.stringify(b.input ?? {}),
    },
  }));

  return {
    content:    textBlock?.text ?? null,
    tool_calls,
    model:      'claude',
  };
}

// ── Groq ───────────────────────────────────────────────────────────────────
async function callGroq(messages: Message[], model: 'groq-70b' | 'groq-8b'): Promise<LLMResponse> {
  const groqModel = model === 'groq-70b' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';

  const formatted = messages.map(m => {
    if (m.role === 'tool')    return { role: 'tool',      content: m.content, tool_call_id: m.name ?? 'tool' };
    if (m.tool_calls?.length) return { role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls };
    return { role: m.role, content: m.content };
  });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: groqModel, messages: formatted,
      tools: TOOL_DEFINITIONS.map(t => ({ type: 'function', function: t })),
      tool_choice: 'auto', max_tokens: 4096, temperature: 0.1,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('Groq rate limit — wait a minute or switch to Claude/Gemini.');
    throw new Error(`Groq ${res.status}: ${await res.text()}`);
  }
  const d = await res.json() as { choices: Array<{ message: { content?: string; tool_calls?: ToolCall[] } }> };
  const msg = d.choices[0].message;
  return { content: msg.content ?? null, tool_calls: msg.tool_calls ?? [], model };
}

// ── Gemini ─────────────────────────────────────────────────────────────────
async function callGemini(messages: Message[]): Promise<LLMResponse> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set. Get a free key from aistudio.google.com');

  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content ?? '' }],
  }));

  const system = messages.find(m => m.role === 'system')?.content;
  const body: Record<string, unknown> = {
    contents,
    tools: [{ function_declarations: TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const d = await res.json() as { candidates: Array<{ content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> } }> };
  const parts  = d.candidates[0].content.parts;
  const fnCall = parts.find(p => p.functionCall)?.functionCall;

  return {
    content:    parts.find(p => p.text)?.text ?? null,
    tool_calls: fnCall ? [{ id: `gemini-${Date.now()}`, type: 'function', function: { name: fnCall.name, arguments: JSON.stringify(fnCall.args) } }] : [],
    model:      'gemini-flash',
  };
}

// ── Main router ────────────────────────────────────────────────────────────
export async function callLLM(messages: Message[], forceModel?: ModelId): Promise<LLMResponse> {
  const model = forceModel ?? selectModel();
  if (model === 'claude')        return callClaude(messages);
  if (model === 'gemini-flash')  return callGemini(messages);
  return callGroq(messages, model);
}
