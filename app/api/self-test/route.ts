import { NextResponse } from 'next/server';

const MCP_URL = 'https://www.lexaureon.com/api/mcp';
let reqId = 1;

async function callMcpTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: reqId++,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json() as { result?: unknown; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? 'MCP error');
  return data.result;
}

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const result = await callMcpTool('run_self_test');
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
