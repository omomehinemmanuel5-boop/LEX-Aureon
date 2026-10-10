/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE 0.5 — Tool Call Interceptor
 * Constitutional role: Approve or deny tool calls before execution.
 * Cannot: execute tools, measure CRS independently, or generate content.
 * Implements: cumulative V_z tracking (slow-drip defence).
 *
 * Decision hierarchy:
 *   BLOCKED injection  → DENIED_INJECTION  (no execution ever)
 *   BLOCKED pattern    → DENIED_BLOCKED    (no execution ever)
 *   Session LOCKED     → DENIED_LOCKED     (two HIGHs in recovery)
 *   HIGH in recovery   → DENIED_LOCKED     (sigma_viol elevated)
 *   HIGH (clean state) → APPROVED_HIGH     (executes, sigma_viol rises)
 *   MEDIUM             → APPROVED_MEDIUM   (executes, logged)
 *   LOW                → APPROVED          (executes)
 *
 * Uses singleton getClient() from db.ts; approval/slow-drip state transitions
 * and their receipts commit atomically. Read failures never synthesize a clean
 * session, and denial persistence failures are surfaced in the result.
 *
 * fix (2026-07-11): measureToolCRS is now async (semantic/embedding-based
 * injection detection as a second pass — see tool_crs.ts's file header) —
 * this call site now awaits it. Latency note: for calls that the fast regex
 * pass doesn't already resolve, this adds a real embedding-API round trip to
 * interceptToolCall's total time, not just a compute-bound classification —
 * stated here since it's a real behavior change from before, not silent.
 * ═══════════════════════════════════════════════════════════════
 */

import { ToolCallInput, ToolCallDecision, ToolCRSState, ToolSessionState } from './types';
import { measureToolCRS } from './tool_crs';
import { getClient } from '../db';
import crypto from 'crypto';
import {
  commitGovernanceDecision,
  GovernanceCommitConflict,
} from './governance_commit';

// Constitutional constants — same as text governance
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _TAU_FLOOR    = 0.05;  // Reserved — matches kernel CBF floor
const N_MIN         = 3;     // stable calls before HIGH recovery
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SIGMA_THRESHOLD = 0.25; // cumulative violation threshold

// ── Kernel-informed proxy thresholds ─────────────────────────────────────────
// The kernel's constitutional M for this session informs tool-call strictness.
// Lower M → tighter proxy. Higher M → normal operation.
const KERNEL_CRITICAL  = 0.05;  // deny ALL tool calls
const KERNEL_STRESSED  = 0.15;  // deny write operations, allow reads only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const KERNEL_ALERT     = 0.22;  // stricter HIGH threshold
const WRITE_TOOLS      = new Set(['write_file','create_file','delete_file','drop_table',
                           'execute_sql','run_command','bash','shell','eval']);

async function getKernelM(session_id: string): Promise<number | null> {
  // Test-only benchmark adapter. It is opt-in, namespaced, and unavailable in
  // production so local/CI agent replays can measure utility without a live
  // Turso database or receipt writes. It must never be used as a production
  // outage fallback.
  if (process.env.NODE_ENV !== 'production' && process.env.LEX_AGENTDOJO_SYNTHETIC_STATE === '1') {
    return 1.0;
  }
  try {
    const db = getClient();
    const res = await db.execute({
      sql: 'SELECT last_m FROM z_traj WHERE session_id = ? LIMIT 1',
      args: [session_id],
    });
    if (!res.rows.length) return 1.0; // no kernel state = treat as stable
    return Number(res.rows[0].last_m ?? 1.0);
  } catch {
    // A missing row is a clean new session; an unavailable state store is not.
    // Keep those cases distinct so tool authorization fails closed on outage.
    return null;
  }
}

// ── Session state — persisted in Turso ────────────────────────────────────
async function getSessionState(session_id: string): Promise<ToolSessionState> {
  const db = getClient();
  const res = await db.execute({
    sql: 'SELECT * FROM tool_sessions WHERE session_id = ? LIMIT 1',
    args: [session_id],
  });
  if (res.rows.length === 0) {
    return {
      session_id,
      sigma_viol: 0,
      n_stable: N_MIN,
      locked: false,
      tool_calls: 0,
      state_version: 0,
      updated_at: new Date().toISOString(),
    };
  }
  const r = res.rows[0];
  return {
    session_id: String(r.session_id),
    sigma_viol: Number(r.sigma_viol),
    n_stable: Number(r.n_stable),
    locked: Boolean(r.locked),
    tool_calls: Number(r.tool_calls),
    state_version: Number(r.state_version ?? 0),
    last_high_at: r.last_high_at ? Number(r.last_high_at) : undefined,
    updated_at: String(r.updated_at),
  };
}

// ── Constitutional receipt ─────────────────────────────────────────────────
async function writeReceipt(params: {
  receipt_id: string;
  session_id: string;
  actor_id?: string;
  tool_name:  string;
  args_hash:  string;
  decision:   string;
  crs:        ToolCRSState;
  reason:     string;
  sigma_viol: number;
}): Promise<void> {
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO tool_receipts
            (receipt_id, session_id, actor_id, tool_name, args_hash,
             decision, c_score, r_score, s_score, m_score,
             risk_level, reason, sigma_viol, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.receipt_id,
      params.session_id,
      params.actor_id ?? 'internal-agent',
      params.tool_name,
      params.args_hash,
      params.decision,
      params.crs.C,
      params.crs.R,
      params.crs.S,
      params.crs.M,
      params.crs.risk_level,
      params.reason,
      params.sigma_viol,
      new Date().toISOString(),
    ],
  });
}

async function persistDenialReceipt(params: Parameters<typeof writeReceipt>[0]): Promise<string | undefined> {
  try {
    await writeReceipt(params);
    return undefined;
  } catch {
    return 'Denied safely, but the denial receipt could not be persisted.';
  }
}

// ── Health band from sigma_viol ────────────────────────────────────────────
function toolHealthBand(sigma: number, locked: boolean): ToolCallDecision['health_band'] {
  if (locked)        return 'LOCKED';
  if (sigma >= 0.25) return 'CRITICAL';
  if (sigma >= 0.15) return 'STRESSED';
  if (sigma >= 0.08) return 'ALERT';
  return 'OPTIMAL';
}

// ── Main interceptor ───────────────────────────────────────────────────────
async function interceptToolCallOnce(tool: ToolCallInput): Promise<ToolCallDecision> {
  const t = Date.now();

  // Generate receipt ID
  const receipt_id = 'TCR-' + crypto
    .createHash('sha256')
    .update(`${tool.session_id}:${tool.name}:${JSON.stringify(tool.arguments)}:${t}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  // Hash arguments for receipt (never store raw args — may contain sensitive data)
  const args_hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(tool.arguments))
    .digest('hex')
    .slice(0, 32);

  // Step 0: Kernel-informed check — kernel M gates tool execution
  const kernelM = await getKernelM(tool.session_id);
  const kernelCRS = { C: kernelM ?? 0, R: kernelM ?? 0, S: kernelM ?? 0, M: kernelM ?? 0, risk_level: 'BLOCKED' as const };

  if (kernelM === null) {
    const receiptWarning = await persistDenialReceipt({ receipt_id, session_id: tool.session_id, actor_id: tool.actor_id, tool_name: tool.name,
      args_hash, decision: 'DENIED_STATE_UNAVAILABLE', crs: kernelCRS,
      reason: 'Constitutional state unavailable — tool execution denied by fail-closed policy', sigma_viol: 1 });
    return {
      approved: false,
      decision: 'DENIED_BLOCKED' as const,
      receipt_id,
      crs: kernelCRS,
      health_band: 'CRITICAL' as const,
      reason: 'Constitutional state unavailable — tool execution denied by fail-closed policy',
      sigma_viol: 1,
      warning: ['Governance state unavailable; execution denied by fail-closed policy.', receiptWarning].filter(Boolean).join(' '),
    };
  }

  if (kernelM < KERNEL_CRITICAL) {
    const receiptWarning = await persistDenialReceipt({ receipt_id, session_id: tool.session_id, actor_id: tool.actor_id, tool_name: tool.name,
      args_hash, decision: 'DENIED_KERNEL_CRITICAL',
      crs: kernelCRS,
      reason: `Kernel M=${kernelM.toFixed(3)} < τ_floor=${KERNEL_CRITICAL} — constitutional floor violated`,
      sigma_viol: 1 });
    return {
      approved: false,
      decision: 'DENIED_BLOCKED' as const,
      receipt_id,
      crs: kernelCRS,
      health_band: 'CRITICAL' as const,
      reason: `Kernel M=${kernelM.toFixed(3)} < τ_floor=${KERNEL_CRITICAL} — constitutional floor violated in active session. All tool calls suspended.`,
      sigma_viol: 1,
      ...(receiptWarning ? { warning: receiptWarning } : {}),
    };
  }

  if (kernelM < KERNEL_STRESSED && WRITE_TOOLS.has(tool.name)) {
    const receiptWarning = await persistDenialReceipt({ receipt_id, session_id: tool.session_id, actor_id: tool.actor_id, tool_name: tool.name,
      args_hash, decision: 'DENIED_KERNEL_STRESSED',
      crs: kernelCRS,
      reason: `Kernel M=${kernelM.toFixed(3)} < ${KERNEL_STRESSED} — write operations suspended during constitutional stress`,
      sigma_viol: 0 });
    return {
      approved: false,
      decision: 'DENIED_BLOCKED' as const,
      receipt_id,
      crs: kernelCRS,
      health_band: 'STRESSED' as const,
      reason: `Kernel M=${kernelM.toFixed(3)} < ${KERNEL_STRESSED} — write operations suspended during constitutional stress. Read-only operations allowed.`,
      sigma_viol: 0,
      ...(receiptWarning ? { warning: receiptWarning } : {}),
    };
  }

  // Step 1: CRS measurement (includes injection + hardcoded pattern checks)
  // fix (2026-07-11): now async (semantic injection second-pass) — awaited.
  const crs = await measureToolCRS(tool);

  // Step 2: Immediate BLOCKED — no session state update needed
  if (crs.risk_level === 'BLOCKED') {
    const decision = crs.injection ? 'DENIED_INJECTION' : 'DENIED_BLOCKED';
    const reason = crs.injection
      ? `Prompt injection detected in tool arguments: ${crs.blocked_pattern}`
      : `Hardcoded constitutional invariant violated: ${crs.blocked_pattern}`;

    const receiptWarning = await persistDenialReceipt({
      receipt_id, session_id: tool.session_id,
      actor_id: tool.actor_id, tool_name: tool.name, args_hash, decision,
      crs, reason, sigma_viol: 1.0,
    });

    return {
      approved: false,
      decision,
      reason,
      crs,
      receipt_id,
      sigma_viol: 1.0,
      health_band: 'LOCKED',
      ...(receiptWarning ? { warning: receiptWarning } : {}),
    };
  }

  // Step 3: Load session state (cumulative slow-drip defence)
  let session: ToolSessionState;
  try {
    session = await getSessionState(tool.session_id);
  } catch {
    const reason = 'Tool-session governance state unavailable — execution denied by fail-closed policy.';
    const receiptWarning = await persistDenialReceipt({
      receipt_id, session_id: tool.session_id, actor_id: tool.actor_id,
      tool_name: tool.name, args_hash, decision: 'DENIED_STATE_UNAVAILABLE',
      crs, reason, sigma_viol: 1,
    });
    return {
      approved: false, decision: 'DENIED_LOCKED', reason, crs, receipt_id,
      sigma_viol: 1, health_band: 'CRITICAL',
      warning: receiptWarning ?? 'Tool-session governance state could not be loaded.',
    };
  }

  // fix (2026-08-15): hard lock previously had no expiry — locked:true was
  // written once (with a real last_high_at timestamp, right below) and never
  // auto-cleared, so a legitimate solo operator working across a real day
  // had no path back in except raw SQL against production (UPDATE
  // tool_sessions SET locked=0 ...). Found 6 separate sessions stuck this
  // way, dating back to 2026-08-07. The lock is a slow-drip CIRCUIT BREAKER
  // — its actual purpose is to block RAPID compounding HIGH actions in a
  // short window, not to require permanent manual intervention. Auto-expiry
  // preserves that real protection (a burst of HIGH actions within
  // LOCK_TTL_MS still gets denied) while removing the requirement to ever
  // touch the database by hand again.
  const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes — tunable, not safety-critical
  const lockExpired = session.locked && session.last_high_at != null
    && (Date.now() - session.last_high_at) > LOCK_TTL_MS;

  // Step 4: Hard lock check
  if (session.locked && !lockExpired) {
    const receiptWarning = await persistDenialReceipt({
      receipt_id, session_id: tool.session_id,
      actor_id: tool.actor_id, tool_name: tool.name, args_hash, decision: 'DENIED_LOCKED',
      crs, reason: 'Session hard-locked: two HIGH-risk actions in recovery window.',
      sigma_viol: session.sigma_viol,
    });

    return {
      approved: false,
      decision:     'DENIED_LOCKED',
      reason:       'Session hard-locked. Two HIGH-risk actions were detected in the same recovery window. Session requires manual review.',
      crs,
      receipt_id,
      sigma_viol:   session.sigma_viol,
      health_band:  'LOCKED',
      ...(receiptWarning ? { warning: receiptWarning } : {}),
    };
  }
  if (lockExpired) {
    // Auto-clear: same fresh state a manual DB reset would have produced.
    session.locked = false;
    session.sigma_viol = 0;
    session.n_stable = N_MIN;
  }

  // Step 5: HIGH action in recovery window — deny to prevent slow-drip
  if (crs.risk_level === 'HIGH' && session.n_stable < N_MIN) {
    // Second HIGH in recovery: hard lock the session
    const newSigma = Math.min(1.0, session.sigma_viol + 0.30);
    const newState: ToolSessionState = {
      ...session,
      sigma_viol: newSigma,
      n_stable:   0,
      locked:     true, // HARD LOCK
      tool_calls: session.tool_calls + 1,
      last_high_at: t,
    };
    const reason = `Slow-drip attack detected: HIGH action during recovery (n_stable=${session.n_stable} < N_MIN=${N_MIN}). Session locked.`;
    try {
      await commitGovernanceDecision(newState, session.state_version, {
        receipt_id, session_id: tool.session_id, actor_id: tool.actor_id,
        tool_name: tool.name, args_hash, decision: 'DENIED_LOCKED',
        crs, reason, sigma_viol: newSigma,
      });
    } catch {
      return {
        approved: false, decision: 'DENIED_LOCKED',
        reason: 'HIGH-risk action denied; recovery lock and audit receipt could not be committed. Execution remains blocked.',
        crs, receipt_id, sigma_viol: newSigma, health_band: 'LOCKED',
        warning: 'Governance state or denial receipt could not be committed atomically.',
      };
    }

    return {
      approved: false,
      decision:    'DENIED_LOCKED',
      reason:      `Slow-drip protection: HIGH-risk action attempted while session is recovering from a previous HIGH action (${session.n_stable}/${N_MIN} stable calls). Session locked.`,
      crs,
      receipt_id,
      sigma_viol:  newSigma,
      health_band: 'LOCKED',
    };
  }

  // Step 6: Approve — update session state based on risk level
  let newState: ToolSessionState;
  let decision: ToolCallDecision['decision'];
  let warning: string | undefined;

  if (crs.risk_level === 'ULTRA_LOW') {
    // ULTRA_LOW — zero sigma_viol impact, faster decay, increments n_stable
    newState = {
      ...session,
      sigma_viol: Math.max(0, session.sigma_viol - 0.10), // faster decay
      n_stable:   Math.min(N_MIN, session.n_stable + 1),
      tool_calls: session.tool_calls + 1,
    };
    decision = 'APPROVED_ULTRA_LOW';

  } else if (crs.risk_level === 'HIGH') {
    // HIGH approved (clean state) — sigma_viol rises, n_stable resets
    newState = {
      ...session,
      sigma_viol:   Math.min(1.0, session.sigma_viol + 0.20),
      n_stable:     0,   // must recover before next HIGH is allowed
      tool_calls:   session.tool_calls + 1,
      last_high_at: t,
    };
    decision = 'APPROVED_HIGH';
    warning  = `HIGH-risk action approved. Session now in recovery: ${N_MIN} stable calls required before next HIGH action.`;

  } else if (crs.risk_level === 'MEDIUM') {
    // MEDIUM — slight sigma_viol rise, n_stable increments toward recovery
    newState = {
      ...session,
      sigma_viol: Math.max(0, session.sigma_viol - 0.02),
      n_stable:   Math.min(N_MIN, session.n_stable + 1),
      tool_calls: session.tool_calls + 1,
    };
    decision = 'APPROVED_MEDIUM';

  } else {
    // LOW — sigma_viol slowly decays, n_stable increments
    newState = {
      ...session,
      sigma_viol: Math.max(0, session.sigma_viol - 0.05),
      n_stable:   Math.min(N_MIN, session.n_stable + 1),
      tool_calls: session.tool_calls + 1,
    };
    decision = 'APPROVED';
  }

  // Surface unclassified task-context measurements. Unknown tool names are
  // already blocked by measureToolCRS and cannot reach this approval path.
  if (crs.unclassified) {
    const gapNote = 'CRS classification note: at least one measurement used a generic task-context fallback.';
    warning = warning ? `${warning} ${gapNote}` : gapNote;
  }

  try {
    newState = await commitGovernanceDecision(newState, session.state_version, {
      receipt_id, session_id: tool.session_id, actor_id: tool.actor_id,
      tool_name: tool.name, args_hash, decision,
      crs,
      reason: `Approved: risk_level=${crs.risk_level}, M=${crs.M.toFixed(3)}${crs.unclassified ? ', unclassified=true' : ''}`,
      sigma_viol: newState.sigma_viol,
    });
  } catch (error) {
    const reason = error instanceof GovernanceCommitConflict
      ? 'Concurrent governance decision detected; tool execution denied and must be retried.'
      : 'Governance commit unavailable; tool execution denied by fail-closed policy.';
    return {
      approved: false,
      decision: 'DENIED_LOCKED',
      reason,
      crs,
      receipt_id,
      sigma_viol: session.sigma_viol,
      health_band: 'CRITICAL',
      warning: 'Governance state or receipt could not be committed atomically.',
    };
  }

  return {
    approved:    true,
    decision,
    reason:      `Constitutional bounds satisfied. C=${crs.C.toFixed(3)} R=${crs.R.toFixed(3)} S=${crs.S.toFixed(3)} M=${crs.M.toFixed(3)}`,
    crs,
    receipt_id,
    sigma_viol:  newState.sigma_viol,
    health_band: toolHealthBand(newState.sigma_viol, false),
    warning,
  };
}
