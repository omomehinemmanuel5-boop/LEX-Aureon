import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isOperatorSecret } from '@/lib/lex_crs_agent/mcp_access';

export type McpCredentialPath = 'operator_secret' | 'session_token' | 'oauth_bearer' | 'api_key' | 'missing';

export function ipHash(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

export function defaultMcpSessionId(actorId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const actorHash = crypto.createHash('sha256').update(actorId).digest('hex').slice(0, 12);
  return `mcp-${day}-${actorHash}`;
}

export function canonicalMcpSessionId(ownerId: string, clientSessionId: string, operator: boolean): string {
  if (operator) return clientSessionId;
  const ownerSessionPrefix = `${ownerId}:`;
  return clientSessionId.startsWith(ownerSessionPrefix)
    ? clientSessionId
    : `${ownerSessionPrefix}${clientSessionId}`;
}

export function extractApiKey(req: Request): string | null {
  const header = req.headers.get('x-lex-api-key') ?? req.headers.get('x-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

export function extractSessionToken(req: Request): string | null {
  return req.headers.get('x-lex-session-token')?.trim() || null;
}

export function isOperatorRequest(req: Request): boolean {
  return isOperatorSecret(req.headers.get('x-lex-operator-secret'));
}

export function credentialPathFor(req: Request): McpCredentialPath {
  if (isOperatorRequest(req)) return 'operator_secret';
  if (extractSessionToken(req)) return 'session_token';
  const key = extractApiKey(req);
  if (!key) return req.headers.has('x-lex-operator-secret') ? 'operator_secret' : 'missing';
  return key.startsWith('lex_at_') ? 'oauth_bearer' : 'api_key';
}

export function unauthorized(id: number | string | null | undefined) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized: valid API key or OAuth bearer token required' },
    id,
  }, {
    status: 401,
    headers: {
      'WWW-Authenticate': `Bearer resource_metadata="https://www.lexaureon.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Authentication is required for this MCP operation"`,
    },
  });
}

export function oauthToolChallenge(id: number | string | null | undefined) {
  return NextResponse.json({
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: 'Authentication required. Connect Lex Aureon and retry this tool call.' }],
      isError: true,
    },
    _meta: {
      'mcp/www_authenticate': [
        'Bearer resource_metadata="https://www.lexaureon.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Authentication is required for this MCP operation"',
      ],
    },
    id,
  });
}

export function mcpSessionError(id: number | string | null | undefined, reason: string) {
  const expired = reason === 'MCP session expired' || reason === 'API credential expired or revoked';
  const unavailable = reason === 'Session authentication unavailable';
  const text = unavailable
    ? 'Session service temporarily unavailable. Retry this tool call shortly.'
    : expired
      ? 'Session expired. Reconnect Lex Aureon to refresh credentials, then retry this tool call.'
      : 'Session token is invalid. Reconnect Lex Aureon, then retry this tool call.';
  return NextResponse.json({
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text }], isError: true },
    _meta: { 'mcp/www_authenticate': [
      'Bearer resource_metadata="https://www.lexaureon.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Session token is no longer valid"',
    ] },
    id,
  });
}

export function mcpToolResult(id: number | string | null | undefined, value: unknown) {
  const structuredContent = value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    ? value
    : { value };
  return NextResponse.json({
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
      structuredContent,
    },
    id,
  });
}
