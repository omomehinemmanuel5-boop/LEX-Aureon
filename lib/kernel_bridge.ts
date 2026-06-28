/**
 * Kernel Bridge — connects SovereignKernel to Turso
 * Writes kernel receipts into existing audit infrastructure.
 * No new tables. Uses: praxis_receipts, z_traj, governor_log.
 *
 * fix: uses singleton getClient() from db.ts — was calling createClient()
 * on every writeKernelReceipt/loadKernelState call (same leak fixed in lex_memory.ts).
 *
 * fix: sigma_viol / governor_effort / slow_drip were being written with the
 * wrong source values — sigma_viol and governor_effort were both silently
 * set to copies of attack_pressure / effective_theta, and slow_drip was set
 * from epsilon_injected (an unrelated entropy-floor mechanism). None of
 * these three columns are read back anywhere to make a live governance
 * decision — loadKernelState() only reads last_c/r/s — so this was a
 * data-quality issue in the audit log, not a runtime safety bug. Fixed
 * going forward only; rows written before this revision keep the old
 * (incorrect) values. If you're doing historical analysis on
 * sigma_viol/governor_effort/slow_drip, treat the previous commit as the
 * cutover point — values before vs after are not comparable.
 *
 *   sigma_viol      = max(0, τ − M_before)         — real floor-violation magnitude
 *   governor_effort = result.projection_magnitude  — actual correction distance moved
 *   slow_drip       = 1 if semantic_signal.attack_type === 'slow_drip' else 0
 *
 * wire: z_traj now written via updateZTraj() from lib/kv.ts, which implements
 * the proven z-weight update rule (Theorem 3a/3b, Banach fixed-point):
 *   A(t) = γ · Σ_law sev(law)·dir(law)
 *   z_{t+1} = normalize(clamp(ρ·z_t + (1−ρ)·x_t − A(t), τ/2, 1−τ))
 * z_c/z_r/z_s coordinate weights are now stored and reflect historical
 * attack pressure per pillar, closing Open Problem 3.
 *
 * fix: console.error → structured logger (matches app/api/health/route.ts
 * pattern). Only error message + truncated stack are logged.
 */

import { getClient } from './db';
import { KernelCycleResult, KernelState } from './sovereign_kernel';
import { TAU } from './aureonics_core';
import { updateZTraj } from './kv';
import { logger, errorFields } from './logger';

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
  const slowDrip = result.semantic_signal.attack_type === 'slow_drip' ? 1 : 0;

  // ── Derive law events for z-weight update ────────────────────────────────
  // Collect any law/attack events fired this cycle so the proven z-update
  // rule can correctly compute A(t) = γ · Σ sev(law)·dir(law).
  const lawEvents: string[] = [];
  if (result.semantic_signal.attack_type && result.semantic_signal.attack_type !== 'none') {
    lawEvents.push(result.semantic_signal.attack_type);
  }
  if (result.receipt.active_law && !lawEvents.includes(result.receipt.active_law)) {
    lawEvents.push(result.receipt.active_law);
  }
  if (slowDrip && !lawEvents.includes('slow_drip')) {
    lawEvents.push('slow_drip');
  }

  try {
    // ── Write to praxis_receipts (same table, kernel flagged via crs_method) ──
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

    // ── Update z_traj via proven update rule (Theorem 3a/3b) ─────────────────
    // updateZTraj computes:
    //   A(t) = γ · Σ_law sev(law)·dir(law)
    //   z_{t+1} = normalize(clamp(ρ·z_t + (1−ρ)·x_t − A(t), τ/2, 1−τ))
    // and persists z_c/z_r/z_s alongside the existing structural fields.
    // prevCRS is loaded from existing z_traj last_c/r/s inside updateZTraj.
    const currentCRS = { c: result.state.C, r: result.state.R, s: result.state.S };
    const prevCRS    = { c: r.raw_state.C, r: r.raw_state.R, s: r.raw_state.S };

    await updateZTraj(
      sessionId,
      currentCRS,
      prevCRS,
      result.attack_pressure,
      lawEvents,
    );

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
        result.receipt.safety_projection_triggered ? 'cbf_projection' : 'none',
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
