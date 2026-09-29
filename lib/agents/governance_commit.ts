import { getClient } from '../db';
import type { ToolCRSState, ToolSessionState } from './types';
import { appendProvenanceEvent, hashProvenanceEvent } from './governance_provenance';
import { TOOL_GOVERNANCE_POLICY_VERSION } from './tool_governance_gateway';

export interface GovernanceReceipt {
  receipt_id: string;
  session_id: string;
  actor_id?: string;
  tool_name: string;
  args_hash: string;
  decision: string;
  crs: ToolCRSState;
  reason: string;
  sigma_viol: number;
}

export class GovernanceCommitConflict extends Error {
  constructor(sessionId: string) {
    super(`Governance state changed concurrently for session ${sessionId}`);
    this.name = 'GovernanceCommitConflict';
  }
}

/**
 * Atomically commits the next session state and its receipt.
 *
 * The production libSQL client transaction is deliberately required here: an
 * approved tool call must never execute when either the state mutation or the
 * audit receipt cannot be durably committed. The execute-only fallback exists
 * solely for small unit-test database doubles that predate this boundary.
 */
export async function commitGovernanceDecision(
  state: ToolSessionState,
  expectedVersion: number,
  receipt: GovernanceReceipt,
): Promise<ToolSessionState> {
  const client = getClient() as ReturnType<typeof getClient> & {
    transaction?: (mode?: 'read' | 'write') => Promise<{
      execute: (stmt: { sql: string; args: unknown[] }) => Promise<{
        rowsAffected?: number;
        rows?: Array<Record<string, unknown>>;
      }>;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
    }>;
  };

  const updateSql = `UPDATE tool_sessions
    SET sigma_viol = ?, n_stable = ?, locked = ?, tool_calls = ?,
        last_high_at = ?, updated_at = ?, state_version = state_version + 1
    WHERE session_id = ? AND state_version = ?`;
  const updateArgs = [
    state.sigma_viol, state.n_stable, state.locked ? 1 : 0, state.tool_calls,
    state.last_high_at ?? null, state.updated_at, state.session_id, expectedVersion,
  ];
  const initializeSql = `INSERT OR IGNORE INTO tool_sessions
    (session_id, sigma_viol, n_stable, locked, tool_calls, state_version, last_high_at, updated_at)
    VALUES (?, 0, 3, 0, 0, 0, NULL, ?)`;
  const initializeArgs = [state.session_id, state.updated_at];
  if (client.transaction) {
    const tx = await client.transaction('write');
    try {
      await tx.execute({ sql: initializeSql, args: initializeArgs });
      const updated = await tx.execute({ sql: updateSql, args: updateArgs });
      if ((updated.rowsAffected ?? 0) !== 1) throw new GovernanceCommitConflict(state.session_id);
      const previous = await tx.execute({
        sql: 'SELECT provenance_hash FROM tool_receipts WHERE provenance_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
        args: [],
      });
      const previousHash = typeof previous.rows?.[0]?.provenance_hash === 'string'
        ? previous.rows[0].provenance_hash
        : undefined;
      const provenanceEvent = appendProvenanceEvent({
        eventId: receipt.receipt_id,
        timestamp: Date.now(),
        actorId: receipt.actor_id ?? 'internal-agent',
        sessionId: receipt.session_id,
        toolName: receipt.tool_name,
        argsHash: receipt.args_hash,
        policyVersion: TOOL_GOVERNANCE_POLICY_VERSION,
        decision: receipt.decision,
      }, previousHash);
      const provenanceHash = hashProvenanceEvent(provenanceEvent);
      const receiptSql = `INSERT INTO tool_receipts
        (receipt_id, session_id, actor_id, tool_name, args_hash, decision,
         c_score, r_score, s_score, m_score, risk_level, reason, sigma_viol,
         policy_version, previous_provenance_hash, provenance_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const receiptArgs = [
        receipt.receipt_id, receipt.session_id, receipt.actor_id ?? 'internal-agent',
        receipt.tool_name, receipt.args_hash,
        receipt.decision, receipt.crs.C, receipt.crs.R, receipt.crs.S, receipt.crs.M,
        receipt.crs.risk_level, receipt.reason, receipt.sigma_viol,
        TOOL_GOVERNANCE_POLICY_VERSION, previousHash ?? null, provenanceHash, new Date().toISOString(),
      ];
      await tx.execute({ sql: receiptSql, args: receiptArgs });
      await tx.commit();
      return { ...state, state_version: expectedVersion + 1 };
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  // Compatibility path for legacy test doubles only. Real clients expose
  // transaction(), so production cannot silently downgrade to this path.
  await client.execute({ sql: initializeSql, args: initializeArgs });
  const updated = await client.execute({ sql: updateSql, args: updateArgs });
  if ((updated.rowsAffected ?? 1) !== 1) throw new GovernanceCommitConflict(state.session_id);
  const previous = await client.execute({
    sql: 'SELECT provenance_hash FROM tool_receipts WHERE provenance_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
    args: [],
  });
  const previousHash = typeof previous.rows?.[0]?.provenance_hash === 'string'
    ? previous.rows[0].provenance_hash
    : undefined;
  const provenanceEvent = appendProvenanceEvent({
    eventId: receipt.receipt_id,
    timestamp: Date.now(),
    actorId: receipt.actor_id ?? 'internal-agent',
    sessionId: receipt.session_id,
    toolName: receipt.tool_name,
    argsHash: receipt.args_hash,
    policyVersion: TOOL_GOVERNANCE_POLICY_VERSION,
    decision: receipt.decision,
  }, previousHash);
  const provenanceHash = hashProvenanceEvent(provenanceEvent);
  await client.execute({
    sql: `INSERT INTO tool_receipts
      (receipt_id, session_id, actor_id, tool_name, args_hash, decision,
       c_score, r_score, s_score, m_score, risk_level, reason, sigma_viol,
       policy_version, previous_provenance_hash, provenance_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      receipt.receipt_id, receipt.session_id, receipt.actor_id ?? 'internal-agent',
      receipt.tool_name, receipt.args_hash,
      receipt.decision, receipt.crs.C, receipt.crs.R, receipt.crs.S, receipt.crs.M,
      receipt.crs.risk_level, receipt.reason, receipt.sigma_viol,
      TOOL_GOVERNANCE_POLICY_VERSION, previousHash ?? null, provenanceHash, new Date().toISOString(),
    ],
  });
  return { ...state, state_version: expectedVersion + 1 };
}

export async function writeGovernanceReceipt(receipt: GovernanceReceipt): Promise<void> {
  const client = getClient();
  const previous = await client.execute({
    sql: 'SELECT provenance_hash FROM tool_receipts WHERE provenance_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
    args: [],
  });
  const previousHash = typeof previous.rows?.[0]?.provenance_hash === 'string'
    ? previous.rows[0].provenance_hash
    : undefined;
  const provenanceEvent = appendProvenanceEvent({
    eventId: receipt.receipt_id,
    timestamp: Date.now(),
    actorId: receipt.actor_id ?? 'internal-agent',
    sessionId: receipt.session_id,
    toolName: receipt.tool_name,
    argsHash: receipt.args_hash,
    policyVersion: TOOL_GOVERNANCE_POLICY_VERSION,
    decision: receipt.decision,
  }, previousHash);
  const provenanceHash = hashProvenanceEvent(provenanceEvent);
  await client.execute({
    sql: `INSERT INTO tool_receipts
      (receipt_id, session_id, actor_id, tool_name, args_hash, decision,
       c_score, r_score, s_score, m_score, risk_level, reason, sigma_viol,
       policy_version, previous_provenance_hash, provenance_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      receipt.receipt_id, receipt.session_id, receipt.actor_id ?? 'internal-agent',
      receipt.tool_name, receipt.args_hash,
      receipt.decision, receipt.crs.C, receipt.crs.R, receipt.crs.S, receipt.crs.M,
      receipt.crs.risk_level, receipt.reason, receipt.sigma_viol,
      TOOL_GOVERNANCE_POLICY_VERSION, previousHash ?? null, provenanceHash, new Date().toISOString(),
    ],
  });
}
