/**
 * Authenticated constitutional tool proxy.
 *
 * This route is a separate trust boundary from /api/mcp: it accepts arbitrary
 * enterprise tool names and can optionally forward to another MCP server.
 * Requests therefore require an API key or the dedicated operator secret,
 * pass IP admission controls, and may only egress to configured public HTTPS
 * hosts. Remote timeout outcomes are reported as indeterminate, never as a
 * denial or a safe-to-retry failure.
 */

import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import crypto from 'node:crypto';
import { validateApiKey, validateAndConsumeKey } from '@/lib/api_keys';
import { getClientIp, checkRateLimit } from '@/lib/rate_limit';
import { runZTrajMigrations } from '@/lib/db';
import { interceptToolCall } from '@/lib/agents/tool_interceptor';
import type { ToolCallInput } from '@/lib/agents/types';
import { isOperatorSecret } from '@/lib/lex_crs_agent/mcp_access';
import { env } from '@/lib/env';

const MAX_PROXY_BODY_BYTES = 64 * 1024;
const PROXY_ANONYMOUS_REQUESTS_PER_MINUTE = 30;
const PROXY_API_KEY_REQUESTS_PER_MINUTE = 120;
const PROXY_AUTHENTICATED_IP_REQUESTS_PER_MINUTE = 90;
const PROXY_OPERATOR_REQUESTS_PER_MINUTE = 180;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_MCP_RESPONSE_BYTES = 1024 * 1024;
const pinnedDestinations = new WeakMap<URL, { address: string; family: 4 | 6 }>();

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractHeaderApiKey(req: Request): string | null {
  // Keep x-api-key as a compatibility alias for older client configurations.
  const header = req.headers.get('x-lex-api-key') ?? req.headers.get('x-api-key');
  if (header?.trim()) return header.trim();
  const authorization = req.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim() || null;
  }
  // Deliberately do not accept query-parameter credentials on this route:
  // they are more likely to leak into access logs and copied URLs.
  return null;
}

async function readBoundedBody(req: Request): Promise<{ text?: string; tooLarge: boolean }> {
  if (!req.body) return { text: '', tooLarge: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROXY_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(body), tooLarge: false };
}

function ipv4IsPublic(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // shared address space
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0) || (b === 2 && c === 0) || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 255) return false;
  return true;
}

function ipIsPublic(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return ipv4IsPublic(address);
  if (kind !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return ipv4IsPublic(mapped);
    return false;
  }
  // Only globally-routable unicast (2000::/3) is accepted. Exclude known
  // transition/documentation ranges even though they fall inside that block.
  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (firstHextet < 0x2000 || firstHextet > 0x3fff) return false;
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0:')
    || normalized.startsWith('2001:2:') || normalized.startsWith('2001:10:')
    || normalized.startsWith('2001:20:') || normalized.startsWith('2002:')
    || normalized.startsWith('3fff:')) return false;
  return true;
}

function configuredAllowedHosts(): Set<string> {
  return new Set((env.TOOL_PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean));
}

/** Validate exact configured host, HTTPS-only, and DNS answers before egress. */
async function validateOutboundTarget(raw: string): Promise<URL | null> {
  let target: URL;
  try { target = new URL(raw); } catch { return null; }
  if (target.protocol !== 'https:' || target.username || target.password) return null;
  if (target.port && target.port !== '443') return null;
  const host = target.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIP(host) || !configuredAllowedHosts().has(host)) return null;
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error('Outbound DNS resolution timed out')), 5_000);
      }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !ipIsPublic(address))) return null;
    const selected = addresses[0];
    const family = isIP(selected.address);
    if (family !== 4 && family !== 6) return null;
    pinnedDestinations.set(target, { address: selected.address, family });
  } catch {
    return null;
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  target.hostname = host;
  return target;
}

function postToMcp(target: URL, payload: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const pinned = pinnedDestinations.get(target);
  if (!pinned) return Promise.reject(new Error('Validated outbound address is missing'));
  return new Promise((resolve, reject) => {
    let responseSize = 0;
    const chunks: Buffer[] = [];
    const req = httpsRequest({
      protocol: 'https:',
      hostname: target.hostname,
      port: 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      servername: target.hostname,
      headers: { 'Content-Type': 'application/json', Host: target.host },
      // Pin TLS's network connection to the exact IP that passed the public
      // address check; retain the original hostname for SNI/certificate checks.
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, response => {
      response.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseSize += data.byteLength;
        if (responseSize > MAX_MCP_RESPONSE_BYTES) {
          response.destroy(new Error('MCP response exceeded the size limit'));
          return;
        }
        chunks.push(data);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 502,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => {
      const timeout = new Error('Remote MCP request timed out');
      timeout.name = 'TimeoutError';
      req.destroy(timeout);
    });
    req.end(JSON.stringify(payload));
  });
}

function rateLimitResponse(retryAfter: number, storageError: boolean) {
  return NextResponse.json({
    error: storageError
      ? 'Tool proxy admission temporarily unavailable'
      : `Too many requests; retry after ${retryAfter} seconds`,
  }, {
    status: storageError ? 503 : 429,
    headers: {
      'Retry-After': String(retryAfter),
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BODY_BYTES) {
    return jsonError(413, 'Request body too large');
  }

  const ip = getClientIp(req);
  const ipKey = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const operator = isOperatorSecret(req.headers.get('x-lex-operator-secret'));
  const apiKey = operator ? null : extractHeaderApiKey(req);
  const admission = await checkRateLimit(
    `tool-proxy:admission:${ipKey}`,
    operator || apiKey ? PROXY_API_KEY_REQUESTS_PER_MINUTE : PROXY_ANONYMOUS_REQUESTS_PER_MINUTE,
    60,
  );
  if (!admission.allowed) return rateLimitResponse(admission.retryAfter, Boolean(admission.storageError));

  let checkedKey: Awaited<ReturnType<typeof validateApiKey>>['key'] | null = null;
  if (!operator && apiKey) {
    try {
      const checked = await validateApiKey(apiKey);
      if (!checked.valid || !checked.key) return jsonError(401, 'Valid API key or operator secret required');
      checkedKey = checked.key;
    } catch {
      return jsonError(503, 'Tool proxy authentication temporarily unavailable');
    }
  }

  if (checkedKey || operator) {
    const quota = await checkRateLimit(
      operator ? `tool-proxy:operator:${ipKey}` : `tool-proxy:key:${String(checkedKey!.id)}`,
      operator ? PROXY_OPERATOR_REQUESTS_PER_MINUTE : PROXY_API_KEY_REQUESTS_PER_MINUTE,
      60,
    );
    if (!quota.allowed) return rateLimitResponse(quota.retryAfter, Boolean(quota.storageError));
    const ipSafety = await checkRateLimit(
      `tool-proxy:authenticated-ip:${ipKey}`,
      PROXY_AUTHENTICATED_IP_REQUESTS_PER_MINUTE,
      60,
    );
    if (!ipSafety.allowed) return rateLimitResponse(ipSafety.retryAfter, Boolean(ipSafety.storageError));
  }

  const bounded = await readBoundedBody(req);
  if (bounded.tooLarge) return jsonError(413, 'Request body too large');
  let body: unknown;
  try { body = JSON.parse(bounded.text ?? ''); } catch { return jsonError(400, 'Invalid JSON'); }
  if (!isRecord(body)) return jsonError(400, 'Request body must be a JSON object');

  const toolName = body.tool_name;
  const args = body.arguments;
  const clientSessionId = body.session_id;
  const taskContext = body.task_context;
  const targetRaw = body.target_mcp_url;
  const turn = body.turn;
  if (typeof toolName !== 'string' || !toolName.trim() || toolName.length > MAX_TOOL_NAME_LENGTH) {
    return jsonError(400, 'tool_name must be a non-empty string of at most 128 characters');
  }
  if (!isRecord(args)) return jsonError(400, 'arguments object required');
  if (typeof clientSessionId !== 'string' || !clientSessionId.trim() || clientSessionId.length > MAX_SESSION_ID_LENGTH) {
    return jsonError(400, 'session_id must be a non-empty string of at most 128 characters');
  }
  if (taskContext !== undefined && (typeof taskContext !== 'string' || taskContext.length > 8000)) {
    return jsonError(400, 'task_context must be a string of at most 8000 characters');
  }
  if (turn !== undefined && (!Number.isInteger(turn) || Number(turn) < 0 || Number(turn) > 1_000_000)) {
    return jsonError(400, 'turn must be a non-negative integer');
  }
  if (targetRaw !== undefined && (typeof targetRaw !== 'string' || targetRaw.length > 2048)) {
    return jsonError(400, 'target_mcp_url must be a URL string of at most 2048 characters');
  }

  let actorId = 'operator';
  let sessionId = clientSessionId;
  if (!operator) {
    if (!apiKey) return jsonError(401, 'Valid API key or operator secret required');
  }

  // Authenticate the caller before DNS resolution, but validate the target
  // before quota consumption so malformed destinations are not billed.
  let target: URL | null = null;
  if (typeof targetRaw === 'string') {
    target = await validateOutboundTarget(targetRaw);
    if (!target) return jsonError(403, 'Outbound target is not an allowlisted public HTTPS host');
  }

  if (!operator && apiKey) {
    try {
      const consumed = await validateAndConsumeKey(apiKey);
      if (!consumed.valid || !consumed.key) return jsonError(401, 'Valid API key or operator secret required');
      actorId = `api_key:${String(consumed.key.id)}`;
      sessionId = `${actorId}:${clientSessionId}`;
    } catch {
      return jsonError(503, 'Tool proxy authentication temporarily unavailable');
    }
  }

  try {
    await runZTrajMigrations();
  } catch {
    return jsonError(503, 'Governance storage temporarily unavailable');
  }

  const toolCall: ToolCallInput = {
    id: crypto.randomUUID(),
    name: toolName.trim(),
    arguments: args,
    session_id: sessionId,
    task_context: taskContext as string | undefined,
    turn: turn as number | undefined,
    actor_id: actorId,
  };

  const decision = await interceptToolCall(toolCall);
  if (!decision.approved) {
    return NextResponse.json({
      approved: false,
      decision: decision.decision,
      execution_status: 'not_started',
      result: null,
      receipt_id: decision.receipt_id,
      reason: decision.reason,
      crs: decision.crs,
      sigma_viol: decision.sigma_viol,
      health_band: decision.health_band,
      warning: decision.warning ?? null,
    }, { status: 403 });
  }

  if (!target) {
    return NextResponse.json({
      approved: true,
      execution_status: 'not_requested',
      result: null,
      receipt_id: decision.receipt_id,
      reason: decision.reason,
      crs: decision.crs,
      sigma_viol: decision.sigma_viol,
      health_band: decision.health_band,
      warning: decision.warning ?? null,
    });
  }

  try {
    const mcpRes = await postToMcp(target, {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName.trim(), arguments: args },
        id: toolCall.id,
    });
    if (mcpRes.status >= 300 && mcpRes.status < 400) {
      return NextResponse.json({
        approved: true,
        execution_status: 'unknown',
        result: null,
        execution_error: 'The remote server returned a redirect after request dispatch; it may already have applied the action. Verify before retrying.',
        receipt_id: decision.receipt_id,
        reason: decision.reason,
        crs: decision.crs,
        warning: decision.warning ?? null,
      }, { status: 502 });
    }
    if (mcpRes.status < 200 || mcpRes.status >= 300) {
      return NextResponse.json({
        approved: true,
        execution_status: 'unknown',
        result: null,
        execution_error: `Target MCP returned HTTP ${mcpRes.status} after dispatch; it may already have applied the action. Verify before retrying.`,
        receipt_id: decision.receipt_id,
        reason: decision.reason,
        crs: decision.crs,
        warning: decision.warning ?? null,
      }, { status: 502 });
    }
    let mcpData: { result?: unknown; error?: unknown };
    try { mcpData = JSON.parse(mcpRes.text) as { result?: unknown; error?: unknown }; }
    catch { throw new Error('Remote MCP returned invalid JSON after request dispatch'); }
    if (mcpData.error) {
      return NextResponse.json({
        approved: true,
        execution_status: 'unknown',
        result: null,
        execution_error: 'Target MCP returned a JSON-RPC error after dispatch; remote side effects are not known. Verify before retrying.',
        receipt_id: decision.receipt_id,
        reason: decision.reason,
        crs: decision.crs,
        warning: decision.warning ?? null,
      }, { status: 502 });
    }
    return NextResponse.json({
      approved: true,
      execution_status: 'completed',
      result: mcpData.result ?? null,
      receipt_id: decision.receipt_id,
      reason: decision.reason,
      crs: decision.crs,
      sigma_viol: decision.sigma_viol,
      health_band: decision.health_band,
      warning: decision.warning ?? null,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json({
      approved: true,
      execution_status: 'unknown',
      result: null,
      execution_error: timedOut
        ? 'Remote outcome is unknown after timeout; the target may still have completed the action. Verify before retrying.'
        : 'Remote outcome is unknown after a transport failure; verify before retrying.',
      receipt_id: decision.receipt_id,
      reason: decision.reason,
      crs: decision.crs,
      warning: decision.warning ?? null,
    }, { status: 504 });
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'Lex Aureon Constitutional MCP Proxy',
    version: '2.0.0',
    description: 'Authenticated tool-governance proxy. Remote forwarding requires an exact public HTTPS host in TOOL_PROXY_ALLOWED_HOSTS.',
    endpoint: '/api/tool-proxy',
    pipeline: 'IP admission → API key/operator authentication → destination policy → constitutional decision → optional governed forwarding',
    guarantees: [
      'POST requires a valid API key or the dedicated operator secret.',
      'Requests are size-bounded and rate-limited; admission storage failures fail closed.',
      'Forwarding is HTTPS-only, exact-host allowlisted, public-address checked, and redirects are not followed.',
      'Remote timeout/transport failures are reported as indeterminate; clients must verify before retrying.',
      'Receipts contain the authenticated actor identifier and never contain raw API keys or raw arguments.',
    ],
  });
}
