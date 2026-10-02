import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api_keys';
import { isOperatorSecret } from '@/lib/lex_crs_agent/mcp_access';
import {
  discoverToolManifests,
  listDiscoveredToolCapabilities,
  type ToolManifest,
} from '@/lib/agents/tool_capability_discovery';

const MAX_BODY_BYTES = 512 * 1024;

function extractApiKey(req: Request): string | null {
  const header = req.headers.get('x-lex-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

function unauthorized() {
  return NextResponse.json(
    { error: 'Unauthorized: valid API key or operator secret required' },
    { status: 401 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Capability discovery adapter.
 *
 * A client/host first calls its native tools/list (MCP) or equivalent SDK
 * manifest, then sends that declaration here. Lex resolves every tool into
 * its stable capability ontology and persists the result under the caller's
 * environment identity. Discovery never grants permission by itself.
 */
export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Discovery manifest is too large' }, { status: 413 });
  }

  const operator = isOperatorSecret(req.headers.get('x-lex-operator-secret'));
  let environmentId = 'operator';

  if (!operator) {
    const apiKey = extractApiKey(req);
    if (!apiKey) return unauthorized();
    const keyCheck = await validateApiKey(apiKey);
    if (!keyCheck.valid || !keyCheck.key?.id) return unauthorized();
    environmentId = String(keyCheck.key.id);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isRecord(body) || !Array.isArray(body.tools)) {
    return NextResponse.json({ error: 'Expected { tools: [...] }' }, { status: 400 });
  }
  if (body.tools.length === 0 || body.tools.length > 500) {
    return NextResponse.json({ error: 'tools must contain between 1 and 500 entries' }, { status: 400 });
  }

  const manifests: ToolManifest[] = [];
  for (const item of body.tools) {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) {
      return NextResponse.json({ error: 'Every tool must contain a non-empty name' }, { status: 400 });
    }
    const annotations = isRecord(item.annotations) ? item.annotations : undefined;
    const inputSchema = isRecord(item.inputSchema) ? item.inputSchema : undefined;
    manifests.push({
      name: item.name.trim().slice(0, 256),
      description: typeof item.description === 'string' ? item.description.slice(0, 4096) : undefined,
      inputSchema,
      annotations: annotations ? {
        readOnlyHint: typeof annotations.readOnlyHint === 'boolean' ? annotations.readOnlyHint : undefined,
        destructiveHint: typeof annotations.destructiveHint === 'boolean' ? annotations.destructiveHint : undefined,
        openWorldHint: typeof annotations.openWorldHint === 'boolean' ? annotations.openWorldHint : undefined,
        idempotentHint: typeof annotations.idempotentHint === 'boolean' ? annotations.idempotentHint : undefined,
      } : undefined,
    });
  }

  try {
    const resolved = await discoverToolManifests(environmentId, manifests);
    return NextResponse.json({
      environment_id: environmentId,
      discovered: resolved.map(tool => ({
        name: tool.name,
        capability: tool.capability,
        confidence: tool.confidence,
        requires_approval: tool.approvalRequired,
        reversible: tool.reversible,
        evidence: tool.evidence,
        manifest_hash: tool.manifestHash,
        discovered_at: tool.discoveredAt,
        snapshot_hash: tool.snapshotHash,
        revision: tool.revision,
        expires_at: tool.expiresAt,
        active: tool.active,
      })),
      snapshot: { hash: resolved[0]?.snapshotHash ?? null, revision: resolved[0]?.revision ?? null, expires_at: resolved[0]?.expiresAt ?? null },
      policy: 'Discovery records capability metadata; removed or expired capabilities are revoked; execution still requires normal Lex authorization, CRS, trajectory, and approval gates.',
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Capability discovery failed',
    }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const operator = isOperatorSecret(req.headers.get('x-lex-operator-secret'));
  let environmentId = 'operator';

  if (!operator) {
    const apiKey = extractApiKey(req);
    if (!apiKey) return unauthorized();
    const keyCheck = await validateApiKey(apiKey);
    if (!keyCheck.valid || !keyCheck.key?.id) return unauthorized();
    environmentId = String(keyCheck.key.id);
  }

  try {
    const tools = await listDiscoveredToolCapabilities(environmentId);
    return NextResponse.json({
      environment_id: environmentId,
      tools: tools.map(tool => ({
        name: tool.name,
        capability: tool.capability,
        confidence: tool.confidence,
        requires_approval: tool.approvalRequired,
        reversible: tool.reversible,
        evidence: tool.evidence,
        manifest_hash: tool.manifestHash,
        discovered_at: tool.discoveredAt,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Capability discovery store unavailable' }, { status: 503 });
  }
}
