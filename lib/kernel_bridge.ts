/**
 * Kernel Bridge — connects SovereignKernel to Turso
 * Writes kernel receipts into existing audit infrastructure.
 * No new tables. Uses: praxis_receipts, z_traj, governor_log.
 *
 * fix: sigma_viol / governor_effort / slow_drip corrected values.
 *   sigma_viol      = max(0, τ − M_before)
 *   governor_effort = result.projection_magnitude
 *   slow_drip       = OR(semantic classifier, sigma_viol accumulator)
 *
 * wire: z_traj written via updateZTraj() — proven Banach update rule
 *   (Theorem 3a/3b, ρ=0.85, γ=0.10, clamp+normalize). Closed Open Problem 3.
 *
 * wire: loadKernelZ() reads z_c/z_r/z_s from z_traj and passes them
 *   as sessionZ to SovereignKernel.runCycle(). lyapunov_V and delta_V in
 *   every receipt now certify V_z(x, z_session) — the actual §11 adaptive
 *   barrier — rather than the uniform fallback V_z(x, Z_RECOVERY).
 *   For new sessions with no z_traj row, falls back to Z_RECOVERY (correct:
 *   no attack history → uniform weights → reduces to plain V(x)).
 *
 * fix: slow_drip receipt = OR(semantic, sigma_viol > SIGMA_THRESHOLD).
 *   Previously the semantic classifier never classified 'slow_drip' so
 *   the column was permanently 0. Accumulator now surfaces to receipts.
 */

import { getClient } from './db';
import { KernelCycleResult, KernelState } from './sovereign_kernel';
import { TAU, Z_RECOVERY } from './aureonics_core';
import { updateZTraj, getZTraj, SIGMA_THRESHOLD } from './kv';
import { logger, errorFields } from './logger';

/** Load proven session z-weights from z_traj, or return Z_RECOVERY fallback. */
export async function loadKernelZ(sessionId: string): Promise<[number, number, number]> {
  try {
    const z = await getZTraj(sessionId);
    if (
      z &&
      typeof z.z_c === 'number' && typeof z.z_r === 'number' && typeof z.z_s === 'number' &&
      // Guard: if all three are still the default (0.333), treat as no history yet.
      // A truly adapted z will differ from uniform due to Banach update.
      !(Math.abs(z.z_c - 1/3) < 1e-6 && Math.abs(z.z_r - 1/3) < 1e-6 && Math.abs(z.z_s - 1/3) < 1e-6)
    ) {
      return [z.z_c, z.z_r, z.z_s];
    }
  } catch { /* z_traj not yet created for this session */ }
  return Z_RECOVERY;
}

export async function writeKernelReceipt(
  sessionId: string,
  turn: number,
  result: KernelCycleResult,
): Promise<string> {
  const db = getClient();
  const receiptId = `KRN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const r = result.receipt;

  const mBefore = Math.min(result.receipt.raw_state.C, result.receipt.raw_state.R, result.receipt.raw_state.S);
  const sigmaViol = Math.max(0, TAU - mBefore);
  const governorEffort = result.projection_magnitude;

  // ── Derive law events for z-weight update ────────────────────────────────
  const lawEvents: string[] = [];
  if (result.semantic_signal.attack_type && result.semantic_signal.attack_type !== 'none') {
    lawEvents.push(result.semantic_signal.attack_type);
  }
  if (result.receipt.active_law && !lawEvents.includes(result.receipt.active_law)) {
    lawEvents.push(result.receipt.active_law);
  }

  try {
    // ── Update z_traj via proven update rule (Theorem 3a/3b) ─────────────────
    // Run BEFORE writing the receipt so sigma_viol is fresh for slow_drip check.
    const currentCRS = { c: result.state.C, r: result.state.R, s: result.state.S };
    const prevCRS    = { c: r.raw_state.C, r: r.raw_state.R, s: r.raw_state.S };

    await updateZTraj(
      sessionId,
      currentCRS,
      prevCRS,
      result.attack_pressure,
      lawEvents,
    );

    // ── Slow-drip detection: OR(semantic classifier, sigma_viol accumulator) ─
    const semanticSlowDrip = result.semantic_signal.attack_type === 'slow_drip' ? 1 : 0;
    let accumulatorSlowDrip = 0;
    try {
      const zTraj = await getZTraj(sessionId);
      if (zTraj && zTraj.sigma_viol > SIGMA_THRESHOLD) {
        accumulatorSlowDrip = 1;
        if (!lawEvents.includes('slow_drip')) lawEvents.push('slow_drip');
      }
    } catch { /* non-fatal */ }

    const slowDrip = Math.max(semanticSlowDrip, accumulatorSlowDrip);

    // ── Write to praxis_receipts ──────────────────────────────────────────────
    await db.execute({
      sql: `INSERT OR IGNORE INTO praxis_receipts
              (receipt_id, session_id, turn, pre_eval_label,
               m_before, m_after, governor_mode, intervention,
               slow_drip, governor_effort, sigma_viol, crs_method, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        receiptId, sessionId, turn, 'CLEAR',
        mBefore,
        result.M,
        `kernel-${result.health_band.toLowerCase()}`,
        result.receipt.safety_projection_triggered ? 1 : 0,
        slowDrip,
        governorEffort,
        sigmaViol,
        `SovereignKernel-v2|θ=${result.theta.toFixed(3)}|T=${result.temperature.toFixed(2)}`,
        new Date().toISOString(),
      ],
    });

    // ── Log to governor_log ───────────────────────────────────────────────────
    const driftDir = result.delta_V < -0.001 ? 'converging'
      : result.delta_V > 0.001 ? 'diverging' : 'stable';

    await db.execute({
      sql: `INSERT INTO governor_log
              (session_id, turn, m_before, m_after, drift_dir,
               sigma_viol, intervention, law_fired, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId, turn,
        mBefore,
        result.M,
        driftDir,
        sigmaViol,
        result.receipt.safety_projection_triggered ? 'cbf_projection'
          : slowDrip ? 'slow_drip_accumulator' : 'none',
        result.receipt.active_law || (result.semantic_signal.attack_type !== 'none'
          ? `semantic:${result.semantic_signal.attack_type}` : null),
        new Date().toISOString(),
      ],
    });

  } catch (e) {
    logger.error('kernel_bridge.write', 'receipt write failed', errorFields(e));
  }

  return receiptId;
}

export async function loadKernelState(sessionId: string): Promise<KernelState | null> {
  try {
    const db = getClient();
    const res = await db.execute({
      sql: 'SELECT last_c, last_r, last_s FROM z_traj WHERE session_id = ? LIMIT 1',
      args: [sessionId],
    });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      C: Number(row.last_c),
      R: Number(row.last_r),
      S: Number(row.last_s),
    };
  } catch {
    return null;
  }
}
