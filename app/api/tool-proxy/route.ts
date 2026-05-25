/**
 * Constitutional MCP Proxy — /api/tool-proxy
 *
 * Enterprise integration endpoint. Sits between the enterprise agent
 * and their actual tools. Every tool call passes through the constitutional
 * interceptor before execution.
 *
 * Usage:
 *   POST /api/tool-proxy
 *   {
 *     "tool_name":      "write_file",
 *     "arguments":      { "path": "...", "content": "..." },
 *     "session_id":     "enterprise-session-123",
 *     "task_context":   "Fix the authentication bug in auth.ts",
 *     "target_mcp_url": "https://tools.yourcompany.com/mcp"  // optional
 *   }
 *
 * Response (approved):
 *   {
 *     "approved":    true,
 *     "decision":    "APPROVED_MEDIUM",
 *     "result":      { ... tool result ... },
 *     "receipt_id":  "TCR-A1B2C3D4E5F6G7H8",
 *     "crs":         { "C": 0.41, "R": 0.38, "S": 0.21, "M": 0.21 },
 *     "health_band": "ALERT",
 *     "warning":     null
 *   }
 *
 * Response (denied):
 *   {
 *     "approved":    false,
 *     "decision":    "DENIED_BLOCKED",
 *     "result":      null,
 *     "receipt_id":  "TCR-...",
 *     "reason":      "Hardcoded constitutional invariant violated: sql_destroy:...",
 *     "crs":         { ... }
 *   }
 */

import { NextResponse } from 'next/server';
import { interceptToolCall } from '@/lib/agents/tool_interceptor';
import { runZTrajMigrations } from '@/lib/db';
import type { ToolCallInput } from '@/lib/agents/types';

// Ensure tables exist on first request
let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await runZTrajMigrations();
  _dbReady = true;
}

export async function POST(req: Request) {
  let body: {
    tool_name?:      string;
    arguments?:      Record<string, unknown>;
    session_id?:     string;
    task_context?:   string;
    target_mcp_url?: string;
    turn?:           number;
  };

  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { tool_name, arguments: args, session_id, task_context, target_mcp_url, turn } = body;

  if (!tool_name?.trim())  return NextResponse.json({ error: 'tool_name required' }, { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (!args || typeof args !== 'object') return NextResponse.json({ error: 'arguments object required' }, { status: 400 });

  await ensureDB();

  // Build tool call input
  const toolCall: ToolCallInput = {
    id:           `tc_${Date.now()}`,
    name:         tool_name,
    arguments:    args,
    session_id,
    task_context,
    turn,
  };

  // Run through constitutional interceptor
  const decision = await interceptToolCall(toolCall);

  // If denied — return immediately, no tool execution
  if (!decision.approved) {
    return NextResponse.json({
      approved:    false,
      decision:    decision.decision,
      result:      null,
      receipt_id:  decision.receipt_id,
      reason:      decision.reason,
      crs:         decision.crs,
      sigma_viol:  decision.sigma_viol,
      health_band: decision.health_band,
      warning:     null,
    }, { status: 403 });
  }

  // Approved — execute the tool call against target MCP server (if provided)
  let tool_result: unknown = null;
  let execution_error: string | null = null;

  if (target_mcp_url) {
    try {
      const mcpRes = await fetch(target_mcp_url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method:  'tools/call',
          params:  { name: tool_name, arguments: args },
          id:      toolCall.id,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (mcpRes.ok) {
        const mcpData = await mcpRes.json() as { result?: unknown; error?: unknown };
        tool_result = mcpData.result ?? null;
        if (mcpData.error) execution_error = JSON.stringify(mcpData.error);
      } else {
        execution_error = `Target MCP returned ${mcpRes.status}`;
      }
    } catch (e) {
      execution_error = `Tool execution error: ${String(e)}`;
    }
  }

  return NextResponse.json({
    approved:         true,
    decision:         decision.decision,
    result:           tool_result,
    execution_error,
    receipt_id:       decision.receipt_id,
    reason:           decision.reason,
    crs:              decision.crs,
    sigma_viol:       decision.sigma_viol,
    health_band:      decision.health_band,
    warning:          decision.warning ?? null,
  });
}

// Health check / documentation
export async function GET() {
  return NextResponse.json({
    name:        'Lex Aureon Constitutional MCP Proxy',
    version:     '1.0.0',
    description: 'Runtime constitutional governance layer for enterprise AI agent tool calls.',
    endpoint:    '/api/tool-proxy',
    pipeline:    'Injection scan → Hardcoded invariants → CRS measurement → V_z cumulative tracking → APPROVE/DENY → Receipt',
    guarantees: [
      'Every tool call produces a SHA-256 constitutional receipt stored in Turso',
      'Prompt injection in arguments is detected and blocked before execution',
      'Destructive operations (DROP TABLE, rm -rf, credential access) are hardcoded BLOCKED',
      'Slow-drip attacks blocked via cumulative V_z tracking across the session',
      'Two HIGH-risk actions in the same recovery window triggers session hard lock',
    ],
    pillars: {
      C: 'Continuity — tool call consistent with original agent task',
      R: 'Reciprocity — action matches actual user intent (injection check)',
      S: 'Sovereignty — call within authorized scope and risk bounds',
    },
  });
}
