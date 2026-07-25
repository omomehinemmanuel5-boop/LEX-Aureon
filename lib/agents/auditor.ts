/**
 * ═══════════════════════════════════════════════════════════════════════
 * ARTICLE V — Auditor
 * Constitutional role: Sign and record immutable audit receipt.
 * Cannot: generate, modify, or govern output.
 * Cannot: retry, revise, or dispute the output it signs.
 * Produces: SHA-256 cryptographic receipt + brittleness metric B(x)
 * Guarantee: what was governed is permanently sealed.
 *
 * fix: sigma_viol now sourced from ctx.sigma_viol (passed from z_traj
 * directly by the route caller) instead of searching ctx.receipts for
 * an agent named 'PRAXIS' that never exists. The receipts array contains
 * per-agent pipeline traces — no agent is named 'PRAXIS'. The previous
 * fallback to 0 made sigma_viol permanently zero in every Auditor receipt.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { AgentContext, AgentResult } from './types';
import crypto from 'crypto';
import { MODELS } from '../llm_provider';
import { auditorSigningKey } from '../kernel_bridge';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function AuditorAgent(ctx: AgentContext): Promise<AgentResult> {
  const t = Date.now();
  try {
    const timestamp = Date.now();
    const inputHash  = sha256(ctx.prompt || '');
    const outputHash = sha256(ctx.governed_output ?? ctx.raw_output ?? '');
    const rawHash    = sha256(ctx.raw_output ?? '');

    const crs      = ctx.crs_state;
    const M        = crs?.M ?? 0;
    const health_band = ctx.health_band ?? 'UNKNOWN';

    // ── sigma_viol: sourced from ctx.sigma_viol (from z_traj) ───────────────
    // Previous implementation searched ctx.receipts for agent === 'PRAXIS'
    // which never matched (no agent has that name), so sigma_viol was always 0.
    // Route callers should pass ctx.sigma_viol directly from z_traj.sigma_viol.
    // Falls back to 0 for backwards compatibility when not provided.
    const sigma_viol: number = typeof ctx.sigma_viol === 'number' ? ctx.sigma_viol : 0;

    // ── Brittleness metric B(x) ─────────────────────────────────────────────
    // B(x) = (1/3 - M) / (1/3 - M + d_geo)
    // d_geo = √Σ(xᵢ - 1/3)² — Euclidean distance from simplex centroid
    //
    // Properties:
    // · B ∈ [0, 1]
    // · B = 0 at centroid (balanced)
    // · Single-pillar attacks: high (1/3-M) relative to d_geo → higher B
    // · Multi-attack: d_geo grows faster than (1/3-M) → lower B at equal energy
    const CENTROID = 1 / 3;
    const d_geo = crs
      ? Math.sqrt(
          (crs.C - CENTROID) ** 2 +
          (crs.R - CENTROID) ** 2 +
          (crs.S - CENTROID) ** 2,
        )
      : 0;
    const min_deficit = Math.max(0, CENTROID - M);
    const brittleness = (min_deficit + d_geo) > 0
      ? min_deficit / (min_deficit + d_geo)
      : 0;

    const receiptData = JSON.stringify({
      prompt: inputHash,
      output: outputHash,
      crs: { C: crs?.C, R: crs?.R, S: crs?.S, M },
      timestamp,
      intervention: ctx.intervention_required,
    });
    const receiptHash = sha256(receiptData);
    const shortId     = receiptHash.slice(0, 8).toUpperCase();
    const audit_id    = `LEX-${shortId}`;

    // 2026-07-20: shared key resolution — production refuses the public
    // fallback key (throws); see lib/kernel_bridge.ts auditorSigningKey.
    const signingKey = auditorSigningKey();
    const signature  = crypto
      .createHmac('sha256', signingKey)
      .update(receiptData)
      .digest('hex');

    const receipt = {
      id:                   audit_id,
      timestamp,
      session_id:           ctx.session_id,
      input_hash:           inputHash.slice(0, 16),
      raw_output_hash:      rawHash.slice(0, 16),
      governed_output_hash: outputHash.slice(0, 16),
      receipt_hash:         receiptHash.slice(0, 16),
      signature:            signature.slice(0, 32),
      crs_state:            crs,
      M_score:              Math.round(M * 1000) / 1000,
      health_band,
      brittleness:          Math.round(brittleness * 1000) / 1000,
      intervention:         ctx.intervention_required ?? false,
      trigger_reason:       ctx.trigger_reason,
      lyapunov_V:           ctx.lyapunov_V,
      delta_V:              ctx.delta_V,
      cbf_triggered:        ctx.cbf_triggered,
      sigma_viol,            // now from z_traj via ctx.sigma_viol
      model:                MODELS.PRIMARY,
      kernel_version:       'SovereignKernel-v2-Agentic',
      constitution:         'Lex Aureon Constitution v1.0 — Article IV',
      constitutional:       M >= 0.05,
      signed:               true,
      verified_by:          'Vaulturex Cryptographic Provider',
    };

    const pipelineTrace = (ctx.receipts ?? []).map(r => ({
      agent:       r.agent,
      duration_ms: r.duration_ms,
      success:     r.success,
      decision:    r.decision,
    }));

    const totalDuration = pipelineTrace.reduce((s, r) => s + r.duration_ms, 0);

    return {
      success: true,
      output: '',
      duration_ms: Date.now() - t,
      meta: {
        receipt,
        audit_id,
        output_hash: outputHash,
        brittleness_B: brittleness,
        pipeline_trace: pipelineTrace,
        total_pipeline_duration_ms: totalDuration,
        agents_executed: pipelineTrace.length + 1,
      },
    };
  } catch (e) {
    return { success: false, error: String(e), duration_ms: Date.now() - t };
  }
}
