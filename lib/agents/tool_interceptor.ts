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
 * ═══════════════════════════════════════════════════════════════
 */

import { ToolCallInput, ToolCallDecision, ToolCRSState, ToolSessionState } from './types';
import { measureToolCRS } from './tool_crs';
import { createClient } from '@libsql/client';
import { env } from '../env';
import crypto from 'crypto';

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
const KERNEL_ALERT     = 0.22;  // stricter HIGH threshold
const WRITE_TOOLS      = new Set(['write_file','create_file','delete_file','drop_table',
                           'execute_sql','run_command','bash','shell','eval']);

async function getKernelM(session_id: string): Promise<number> {
  try {
    const db = getDB();
    const res = await db.execute({
      sql: 'SELECT last_m FROM z_traj WHERE session_id = ? LIMIT 1',
      args: [session_id],
    });
    if (!res.rows.length) return 1.0; // no kernel state = treat as stable
    return Number(res.rows[0].last_m ?? 1.0);
  } catch {
    return 1.0; // fail open — don't block tools on DB error
  }
}

function getDB() {
  return createClient({
    url:       env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
}

// ── Session state — persisted in Turso ────────────────────────────────────
async function getSessionState(session_id: string): Promise<ToolSessionState> {
  try {
    const db = getDB();
    const res = await db.execute({
      sql: 'SELECT * FROM tool_sessions WHERE session_id = ? LIMIT 1',
      args: [session_id],
    });
    if (res.rows.length === 0) {
      return {
        session_id,
        sigma_viol: 0,
        n_stable: N_MIN, // start in clean state
        locked: false,
        tool_calls: 0,
        updated_at: new Date().toISOString(),
      };
    }
    const r = res.rows[0];
    return {
      session_id:   String(r.session_id),
      sigma_viol:   Number(r.sigma_viol),
      n_stable:     Number(r.n_stable),
      locked:       Boolean(r.locked),
      tool_calls:   Number(r.tool_calls),
      last_high_at: r.last_high_at ? Number(r.last_high_at) : undefined,
      updated_at:   String(r.updated_at),
    };
  } catch {
    return {
      session_id, sigma_viol: 0, n_stable: N_MIN,
      locked: false, tool_calls: 0, updated_at: new Date().toISOString(),
    };
  }
}

async function updateSessionState(state: ToolSessionState): Promise<void> {
  try {
    const db = getDB();
    await db.execute({
      sql: `INSERT INTO tool_sessions
              (session_id, sigma_viol, n_stable, locked, tool_calls, last_high_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              sigma_viol   = excluded.sigma_viol,
              n_stable     = excluded.n_stable,
              locked       = excluded.locked,
              tool_calls   = excluded.tool_calls,
              last_high_at = excluded.last_high_at,
              updated_at   = excluded.updated_at`,
      args: [
        state.session_id,
        state.sigma_viol,
        state.n_stable,
        state.locked ? 1 : 0,
        state.tool_calls,
        state.last_high_at ?? null,
        new Date().toISOString(),
      ],
    });
  } catch { /* non-fatal — session state is best-effort */ }
}

// ── Constitutional receipt ─────────────────────────────────────────────────
async function writeReceipt(params: {
  receipt_id: string;
  session_id: string;
  tool_name:  string;
  args_hash:  string;
  decision:   string;
  crs:        ToolCRSState;
  reason:     string;
  sigma_viol: number;
}): Promise<void> {
  try {
    const db = getDB();
    await db.execute({
      sql: `INSERT INTO tool_receipts
              (receipt_id, session_id, tool_name, args_hash,
               decision, c_score, r_score, s_score, m_score,
               risk_level, reason, sigma_viol, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        params.receipt_id,
        params.session_id,
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
  } catch { /* non-fatal */ }
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
export async function interceptToolCall(tool: ToolCallInput): Promise<ToolCallDecision> {
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
  const kernelCRS = { C: kernelM, R: kernelM, S: kernelM, M: kernelM, risk_level: 'BLOCKED' as const };

  if (kernelM < KERNEL_CRITICAL) {
    await writeReceipt({ receipt_id, session_id: tool.session_id, tool_name: tool.name,
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
    };
  }

  if (kernelM < KERNEL_STRESSED && WRITE_TOOLS.has(tool.name)) {
    await writeReceipt({ receipt_id, session_id: tool.session_id, tool_name: tool.name,
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
    };
  }

    // Step 1: CRS measurement (includes injection + hardcoded pattern checks)
  const crs = measureToolCRS(tool);

  // Step 2: Immediate BLOCKED — no session state update needed
  if (crs.risk_level === 'BLOCKED') {
    const decision = crs.injection ? 'DENIED_INJECTION' : 'DENIED_BLOCKED';
    const reason = crs.injection
      ? `Prompt injection detected in tool arguments: ${crs.blocked_pattern}`
      : `Hardcoded constitutional invariant violated: ${crs.blocked_pattern}`;

    await writeReceipt({
      receipt_id, session_id: tool.session_id,
      tool_name: tool.name, args_hash, decision,
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
    };
  }

  // Step 3: Load session state (cumulative slow-drip defence)
  const session = await getSessionState(tool.session_id);

  // Step 4: Hard lock check
  if (session.locked) {
    await writeReceipt({
      receipt_id, session_id: tool.session_id,
      tool_name: tool.name, args_hash, decision: 'DENIED_LOCKED',
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
    };
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
    await updateSessionState(newState);

    await writeReceipt({
      receipt_id, session_id: tool.session_id,
      tool_name: tool.name, args_hash, decision: 'DENIED_LOCKED',
      crs, reason: `Slow-drip attack detected: HIGH action during recovery (n_stable=${session.n_stable} < N_MIN=${N_MIN}). Session locked.`,
      sigma_viol: newSigma,
    });

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

  if (crs.risk_level === 'HIGH') {
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

  await updateSessionState(newState);
  await writeReceipt({
    receipt_id, session_id: tool.session_id,
    tool_name: tool.name, args_hash, decision,
    crs, reason: `Approved: risk_level=${crs.risk_level}, M=${crs.M.toFixed(3)}`,
    sigma_viol: newState.sigma_viol,
  });

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
