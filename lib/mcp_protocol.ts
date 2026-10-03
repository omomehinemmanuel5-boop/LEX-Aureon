/**
 * MCP legacy-era protocol negotiation.
 *
 * Lex currently implements the JSON-RPC handshake-era transport, not the
 * 2026-07-28 stateless/server-discover era. Keep the supported set explicit:
 * advertising a protocol revision is a compatibility claim.
 */
export const MCP_HANDSHAKE_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
] as const;

export type McpHandshakeProtocolVersion =
  (typeof MCP_HANDSHAKE_PROTOCOL_VERSIONS)[number];

const LATEST_MCP_HANDSHAKE_PROTOCOL_VERSION =
  MCP_HANDSHAKE_PROTOCOL_VERSIONS[MCP_HANDSHAKE_PROTOCOL_VERSIONS.length - 1];

/**
 * Select the protocol revision for an initialize response.
 *
 * MCP handshake negotiation is a counter-offer: if the client requests a
 * revision Lex supports, use it; otherwise offer Lex's newest handshake
 * revision. Modern 2026 revisions are deliberately not claimed here because
 * this route does not implement server/discover or the modern _meta envelope.
 */
export function negotiateMcpHandshakeVersion(
  requested: unknown,
): McpHandshakeProtocolVersion {
  if (
    typeof requested === 'string' &&
    (MCP_HANDSHAKE_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested as McpHandshakeProtocolVersion;
  }

  return LATEST_MCP_HANDSHAKE_PROTOCOL_VERSION;
}
