/**
 * Kernel Bridge — connects SovereignKernel to Turso
 * Writes kernel receipts into existing audit infrastructure.
 * No new tables. Uses: praxis_receipts, z_traj, governor_log.
 *
 * governor_effort: now OR of two sources (max):
 *   1. result.governor_sensing.correction_magnitude — L2 norm of async G(x,z) delta
 *      applied at the START of this turn from the previous turn's sensing cycle.
 *      This is the primary source — reflects real governor work on ~healthy sessions.
 *   2. result.projection_magnitude — L2 norm of CBF floor projection.
 *      This fires only when M < TAU (0.05) — rare in healthy sessions.
 *   Max of the two is used so both modes of correction are visible.
 *
 * slow_drip: OR(semantic classifier, sigma_viol > SIGMA_THRESHOLD).
 *
 * z_traj: written via proven Banach update rule (lib/kv.ts → updateZTraj).
 *
 * loadKernelZ: exported for route callers to thread session z into runCycle.
 *
 * crsMethod override: optional 4th arg. When the caller resolved an
 *   authoritative CRS via the Python backend (api/python/govern.py), it passes
 *   mergePythonCRS().crs_method here (e.g. 'python-cbf|ccp=...|iec=...|adv=...')
 *   so the persisted crs_method column reflects which engine actually produced
 *   the measurement. When omitted (stream route, refusal path, Python fallback),
 *   the receipt records the TypeScript kernel string exactly as before.
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
  crsMethod?: string,
): Promise<string> {
  const db = getClient();
  const receiptId = `KRN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const r = result.receipt;

  const mBefore = Math.min(result.receipt.raw_state.C, result.receipt.raw_state.R, result.receipt.raw_state.S);
  const sigmaViol = Math.max(0, TAU - mBefore);

  // ── governor_effort: max(async G correction, CBF projection) ─────────────
  // Async G(x,z) magnitude: non-zero on turns where sensing fired last turn
  //   and IEC filter passed. This is the primary signal for healthy sessions.
  // CBF projection magnitude: non-zero only when M < TAU (hard floor breach).
  //   Rare in healthy sessions but critical to record when it fires.
  const asyncGovEffort  = result.governor_sensing.correction_magnitude ?? 0;
  const cbfProjEffort   = result.projection_magnitude ?? 0;
  const governorEffort  = Math.max(asyncGovEffort, cbfProjEffort);

  // ── crs_method: Python override when present, else TS kernel string ──────
  // The persisted tag now tells auditors which engine produced the authoritative
  // CRS this turn. Python success → 'python-cbf|...'; fallback/stream/refusal →
  // 'SovereignKernel-v2|θ=...|T=...'. Previously this was always the TS string,
  // so the audit log could not distinguish Python-authoritative turns.
  const crsMethodTag = crsMethod
    ?? `SovereignKernel-v2|θ=${result.theta.toFixed(3)}|T=${result.temperature.toFixed(2)}`;

  // ── Law events for z-weight update ───────────────────────────────────────
  const lawEvents: string[] = [];
  if (result.semantic_signal.attack_type && result.semantic_signal.attack_type !== 'none') {
    lawEvents.push(result.semantic_signal.attack_type);
  }
  if (result.receipt.active_law && !lawEvents.includes(result.receipt.active_law)) {
    lawEvents.push(result.receipt.active_law);
  }

  try {
    // ── Update z_traj (proven Banach rule) BEFORE receipt write ──────────────
    const currentCRS = { c: result.state.C, r: result.state.R, s: result.state.S };
    const prevCRS    = { c: r.raw_state.C, r: r.raw_state.R, s: r.raw_state.S };

    await updateZTraj(sessionId, currentCRS, prevCRS, result.attack_pressure, lawEvents);

    // ── Slow-drip: OR(semantic, sigma_viol accumulator) ───────────────────────
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

    // ── Write receipt ─────────────────────────────────────────────────────────
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
        crsMethodTag,
        new Date().toISOString(),
      ],
    });

    // ── Governor log ──────────────────────────────────────────────────────────
    const driftDir = result.delta_V < -0.001 ? 'converging'
      : result.delta_V > 0.001 ? 'diverging' : 'stable';

    await db.execute({
      sql: `INSERT INTO governor_log
              (session_id, turn, m_before, m_after, drift_dir,
               sigma_viol, intervention, law_fired, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId, turn,
        mBefore, result.M, driftDir, sigmaViol,
        result.receipt.safety_projection_triggered ? 'cbf_projection'
          : slowDrip ? 'slow_drip_accumulator'
          : asyncGovEffort > 0 ? 'async_governor'
          : 'none',
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
    return { C: Number(row.last_c), R: Number(row.last_r), S: Number(row.last_s) };
  } catch {
    return null;
  }
}
