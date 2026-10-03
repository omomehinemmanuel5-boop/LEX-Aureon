import { NextResponse } from 'next/server';
import { MCP_ISSUER, MCP_SCOPE } from '@/lib/mcp_oauth';

export async function GET() {
  return NextResponse.json({
    issuer: MCP_ISSUER,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${MCP_ISSUER}/oauth/authorize`,
    token_endpoint: `${MCP_ISSUER}/oauth/token`,
    registration_endpoint: `${MCP_ISSUER}/oauth/register`,
    client_id_metadata_document_supported: false,
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [MCP_SCOPE],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
  });
}
