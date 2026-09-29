/**
 * Lex privileged credential broker.
 *
 * Privileged provider credentials never cross the MCP/tool boundary. A tool
 * receives only an action-bound approval token and asks this broker for the
 * server-side credential after the executor has consumed that approval.
 */
import { env } from '../env';
import { verifyGovernanceApprovalToken } from './tool_governance_gateway';

export interface ApprovedCredentialRequest {
  token: unknown;
  toolName: string;
  args: Record<string, unknown>;
}

function decodeApprovalClaims(token: string): { actorId: string; sessionId: string; approvalId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      actorId?: unknown; sessionId?: unknown; jti?: unknown;
    };
    if (
      typeof claims.actorId !== 'string' ||
      typeof claims.sessionId !== 'string' ||
      typeof claims.jti !== 'string'
    ) return null;
    return { actorId: claims.actorId, sessionId: claims.sessionId, approvalId: claims.jti };
  } catch {
    return null;
  }
}

/**
 * Returns the server-side GitHub credential only when the supplied approval
 * token is valid for the exact action and has already been atomically consumed
 * by the constitutional executor.
 */
export async function getGitHubCredentialForApprovedAction(
  input: ApprovedCredentialRequest,
): Promise<string> {
  const token = typeof input.token === 'string' ? input.token : null;
  if (!token) throw new Error('Privileged credential access denied: no Lex approval token.');

  const claims = decodeApprovalClaims(token);
  if (!claims) throw new Error('Privileged credential access denied: invalid Lex approval token.');

  const verified = verifyGovernanceApprovalToken({
    token,
    actorId: claims.actorId,
    sessionId: claims.sessionId,
    toolName: input.toolName,
    args: input.args,
  });
  if (!verified.valid || verified.approvalId !== claims.approvalId) {
    throw new Error(`Privileged credential access denied: ${verified.reason}`);
  }

  const db = (await import('../db')).getClient();
  const consumed = await db.execute({
    sql: 'SELECT approval_id FROM governance_approval_consumptions WHERE approval_id = ? AND actor_id = ? AND session_id = ? AND tool_name = ? LIMIT 1',
    args: [claims.approvalId, claims.actorId, claims.sessionId, input.toolName],
  });
  if (!consumed.rows.length) {
    throw new Error('Privileged credential access denied: approval was not consumed by the Lex executor.');
  }

  if (!env.GITHUB_TOKEN) {
    throw new Error('Privileged credential access denied: GitHub credential is not configured.');
  }
  return env.GITHUB_TOKEN;
}
