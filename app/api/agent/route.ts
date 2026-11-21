/**
 * Lex CRS Agent — Direct API endpoint
 * POST /api/agent
 * Headers: x-lex-api-key (required)
 * Body: { task: string, model?: 'groq-70b' | 'groq-8b' | 'gemini-flash', stream?: boolean }
 *
 * Authentication happens before the body is read, so an unauthenticated request
 * never reaches a model call or a tool call. Identity comes only from the key:
 * the actor and session are derived server-side. Any session_id or actor field
 * in the body is ignored.
 */

import { publicError } from '@/lib/safe_error';
import { NextResponse } from 'next/server';
import { runAgentLoop } from '@/lib/lex_crs_agent/loop';
import type { ModelId } from '@/lib/lex_crs_agent/router';
import { extractApiKey, canonicalMcpSessionId, defaultMcpSessionId } from '@/lib/mcp_http';
import { validateApiKey, consumeApiKeyById } from '@/lib/api_keys';
import { checkRateLimit } from '@/lib/rate_limit';

// Per-key limit on agent runs. Each run also consumes one unit of the key's quota.
const AGENT_RUNS_PER_WINDOW = 10;
const AGENT_WINDOW_SECONDS = 60;

export const maxDuration = 300; // 5 min for complex tasks

export async function POST(req: Request) {
  // 1. Authenticate first. Fail closed: a lookup error is treated as unauthenticated.
  const rawKey = extractApiKey(req);
  if (!rawKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 401 });
  }
  let validation;
  try {
    validation = await validateApiKey(rawKey);
  } catch {
    return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  }
  if (!validation.valid || !validation.key) {
    return NextResponse.json({ error: 'API key is invalid' }, { status: 401 });
  }

  // 2. Derive identity from the authenticated key only.
  const ownerId = validation.key.id;
  const actorId = `api_key:${ownerId}`;
  const context = {
    actorId,
    ownerId,
    runId: crypto.randomUUID(),
    sessionId: canonicalMcpSessionId(ownerId, defaultMcpSessionId(actorId), false),
    signal: req.signal,
  };

  // 2. Rate limit per key. Fail closed if the limiter's storage is unavailable.
  let rate;
  try {
    rate = await checkRateLimit(`agent.run:${ownerId}`, AGENT_RUNS_PER_WINDOW, AGENT_WINDOW_SECONDS);
  } catch {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (rate.storageError) {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Agent run rate limit reached' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } },
    );
  }

  // 3. Consume one run from the key's quota before any model call.
  let consumption;
  try {
    consumption = await consumeApiKeyById(ownerId);
  } catch {
    return NextResponse.json({ error: 'Quota unavailable' }, { status: 503 });
  }
  if (!consumption.valid) {
    return NextResponse.json({ error: 'Run quota exhausted for this key' }, { status: 429 });
  }

  // 4. Parse the body. Any identity field in it is ignored by design.
  let body: { task?: string; model?: string; stream?: boolean; profile?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { task, model, stream = false, profile = 'standard' } = body as { task?: string; model?: string; stream?: boolean; profile?: string };
  if (!task?.trim()) return NextResponse.json({ error: 'task required' }, { status: 400 });

  const validModels: ModelId[] = ['groq-70b', 'groq-8b', 'gemini-flash'];
  const selectedModel = validModels.includes(model as ModelId) ? (model as ModelId) : undefined;

  // Streaming mode — sends each step as an SSE event
  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          await runAgentLoop(task, selectedModel, (step) => {
            const data = `data: ${JSON.stringify(step)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }, context);
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (e) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: publicError('agent.stream', e) })}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(readable, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      },
    });
  }

  // Non-streaming — wait for full result
  try {
    const result = await runAgentLoop(task, selectedModel, undefined, context);
    const governance = result.governance ?? [];
    if (profile === 'compact') {
      // Compact profile: status, governance per tool call, and next action. The full
      // governance record stays in receipts, correlated by run_id.
      const status = result.stop_reason === 'answer' ? 'completed' : result.stop_reason === 'cancelled' ? 'cancelled' : 'incomplete';
      const denied = governance.filter(g => !g.approved);
      return NextResponse.json({
        run_id: context.runId,
        status,
        answer: result.answer,
        turns: result.turns,
        governance: governance.map(g => ({ tool: g.tool, approved: g.approved, decision: g.decision, receipt_id: g.receipt_id })),
        next_action: status !== 'completed'
          ? 'Run incomplete. Retry with a shorter task or check the run in receipts.'
          : denied.length > 0
            ? 'Some tool calls were denied. Check the denial reason in the receipt before retrying.'
            : 'None.',
      });
    }
    return NextResponse.json({ ...result, run_id: context.runId });
  } catch (e) {
    return NextResponse.json({ error: publicError('agent.route', e) }, { status: 500 });
  }
}
