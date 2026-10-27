import { describe, expect, it } from 'vitest';
import {
  canonicalMcpSessionId,
  credentialPathFor,
  mcpToolResult,
  oauthToolChallenge,
  unauthorized,
} from '@/lib/mcp_http';
import {
  MCP_HANDSHAKE_PROTOCOL_VERSIONS,
  negotiateMcpHandshakeVersion,
} from '@/lib/mcp_protocol';

describe('MCP transport conformance contract', () => {
  it('negotiates every supported legacy handshake version and counters unsupported versions', () => {
    for (const version of MCP_HANDSHAKE_PROTOCOL_VERSIONS) {
      expect(negotiateMcpHandshakeVersion(version)).toBe(version);
    }
    expect(negotiateMcpHandshakeVersion('2026-07-28')).toBe('2025-11-25');
    expect(negotiateMcpHandshakeVersion(undefined)).toBe('2025-11-25');
  });

  it('classifies credentials without accepting client-controlled session ownership', () => {
    expect(credentialPathFor(new Request('https://lex.test/mcp'))).toBe('missing');
    expect(credentialPathFor(new Request('https://lex.test/mcp', { headers: { 'x-lex-api-key': 'lex_sk_test' } }))).toBe('api_key');
    expect(credentialPathFor(new Request('https://lex.test/mcp', { headers: { authorization: 'Bearer lex_at_test' } }))).toBe('oauth_bearer');
    expect(canonicalMcpSessionId('owner-123', 'session-1', false)).toBe('owner-123:session-1');
    expect(canonicalMcpSessionId('owner-123', 'owner-123:session-1', false)).toBe('owner-123:session-1');
    expect(canonicalMcpSessionId('operator', 'arbitrary-session', true)).toBe('arbitrary-session');
  });

  it('returns MCP-native authentication challenges', async () => {
    const http = unauthorized('req-1');
    expect(http.status).toBe(401);
    expect(http.headers.get('www-authenticate')).toContain('oauth-protected-resource');

    const tool = oauthToolChallenge('req-2');
    const body = await tool.json();
    expect(body.result.isError).toBe(true);
    expect(body._meta['mcp/www_authenticate'][0]).toContain('oauth-protected-resource');
  });

  it('marks structured governance denials as tool errors and preserves valid structured content', async () => {
    const denied = mcpToolResult('req-3', { decision: 'DENIED_BLOCKED', approved: false, reason: 'blocked' });
    const deniedBody = await denied.json();
    expect(deniedBody.result.isError).toBe(true);
    expect(deniedBody.result.structuredContent.decision).toBe('DENIED_BLOCKED');

    const allowed = mcpToolResult('req-4', { decision: 'APPROVED', approved: true });
    const allowedBody = await allowed.json();
    expect(allowedBody.result.isError).toBeUndefined();
    expect(allowedBody.result.structuredContent.approved).toBe(true);

    const primitive = mcpToolResult('req-5', 'ok');
    const primitiveBody = await primitive.json();
    expect(primitiveBody.result.structuredContent).toEqual({ value: 'ok' });
  });
});
