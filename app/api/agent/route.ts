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
import { validateApiKey } from '@/lib/api_keys';

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
    sessionId: canonicalMcpSessionId(ownerId, defaultMcpSessionId(actorId), false),
  };

  // 3. Parse the body. Any identity field in it is ignored by design.
  let body: { task?: string; model?: string; stream?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { task, model, stream = false } = body;
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
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: publicError('agent.route', e) }, { status: 500 });
  }
}
