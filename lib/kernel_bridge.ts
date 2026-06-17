/**
 * Kernel Bridge — connects SovereignKernel to Turso
 * Writes kernel receipts into existing audit infrastructure.
 * No new tables. Uses: praxis_receipts, z_traj, governor_log.
 *
 * fix: uses singleton getClient() from db.ts — was calling createClient()
 * on every writeKernelReceipt/loadKernelState call (same leak fixed in lex_memory.ts).
 */

import { getClient } from './db';
import { KernelCycleResult, KernelState } from './sovereign_kernel';

export async function writeKernelReceipt(
  sessionId: string,
  turn: number,
  result: KernelCycleResult,
): Promise<string> {
  const db = getClient();
  const receiptId = `KRN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const r = result.receipt;

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
        Math.min(result.receipt.raw_state.C, result.receipt.raw_state.R, result.receipt.raw_state.S),
        result.M,
        `kernel-${result.health_band.toLowerCase()}`,
        result.receipt.safety_projection_triggered ? 1 : 0,
        result.epsilon_injected ? 1 : 0,
        result.effective_theta,
        result.attack_pressure,
        `SovereignKernel-v2|θ=${result.theta.toFixed(3)}|T=${result.temperature.toFixed(2)}`,
        new Date().toISOString(),
      ],
    });

    // ── Update z_traj with kernel state ──────────────────────────────────────
    const driftDir = result.delta_V < -0.001 ? 'converging'
      : result.delta_V > 0.001 ? 'diverging' : 'stable';

    await db.execute({
      sql: `INSERT INTO z_traj
              (session_id, velocity, n_stable, drift_dir, sigma_viol,
               last_m, last_c, last_r, last_s, attack_pressure, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              velocity       = excluded.velocity,
              n_stable       = excluded.n_stable,
              drift_dir      = excluded.drift_dir,
              sigma_viol     = excluded.sigma_viol,
              last_m         = excluded.last_m,
              last_c         = excluded.last_c,
              last_r         = excluded.last_r,
              last_s         = excluded.last_s,
              attack_pressure = excluded.attack_pressure,
              updated_at     = excluded.updated_at`,
      args: [
        sessionId,
        Math.sqrt(result.lyapunov_V),
        result.stability_ratio > 0.7 ? 3 : 0,
        driftDir,
        result.attack_pressure,
        result.M,
        result.state.C, result.state.R, result.state.S,
        result.attack_pressure,
        new Date().toISOString(),
      ],
    });

    // ── Log to governor_log ───────────────────────────────────────────────────
    await db.execute({
      sql: `INSERT INTO governor_log
              (session_id, turn, m_before, m_after, drift_dir,
               sigma_viol, intervention, law_fired, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId, turn,
        Math.min(r.raw_state.C, r.raw_state.R, r.raw_state.S),
        result.M,
        driftDir,
        result.attack_pressure,
        result.receipt.safety_projection_triggered ? 'cbf_projection' : 'none',
        result.receipt.active_law || (result.semantic_signal.attack_type !== 'none'
          ? `semantic:${result.semantic_signal.attack_type}` : null),
        new Date().toISOString(),
      ],
    });

  } catch (e) {
    console.error('kernel_bridge write error:', e);
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
