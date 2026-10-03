import { NextResponse } from 'next/server';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE } from '@/lib/mcp_oauth';

export async function GET() {
  return NextResponse.json({
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_ISSUER],
    scopes_supported: [MCP_SCOPE],
    resource_documentation: 'https://www.lexaureon.com/observatory',
  });
}
