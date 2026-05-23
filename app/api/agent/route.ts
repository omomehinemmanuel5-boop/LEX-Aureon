/**
 * Lex CRS Agent — Direct API endpoint
 * POST /api/agent
 * Body: { task: string, model?: 'groq-70b' | 'groq-8b' | 'gemini-flash', stream?: boolean }
 */

import { NextResponse } from 'next/server';
import { runAgentLoop } from '@/lib/lex_crs_agent/loop';
import type { ModelId } from '@/lib/lex_crs_agent/router';

export const maxDuration = 300; // 5 min for complex tasks

export async function POST(req: Request) {
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
          });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (e) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: String(e) })}\n\n`));
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
    const result = await runAgentLoop(task, selectedModel);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
