import { describe, expect, it } from 'vitest';
import {
  MCP_HANDSHAKE_PROTOCOL_VERSIONS,
  negotiateMcpHandshakeVersion,
} from '@/lib/mcp_protocol';

describe('MCP handshake protocol negotiation', () => {
  it('accepts every supported legacy handshake revision', () => {
    for (const version of MCP_HANDSHAKE_PROTOCOL_VERSIONS) {
      expect(negotiateMcpHandshakeVersion(version)).toBe(version);
    }
  });

  it('counter-offers the newest handshake revision for modern clients', () => {
    expect(negotiateMcpHandshakeVersion('2026-07-28')).toBe('2025-11-25');
  });

  it('counter-offers the newest handshake revision for unknown versions', () => {
    expect(negotiateMcpHandshakeVersion('future-version')).toBe('2025-11-25');
    expect(negotiateMcpHandshakeVersion(undefined)).toBe('2025-11-25');
  });
});
