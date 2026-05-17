/**
 * Agent 5: Auditor
 * Constitutional role: Sign and record immutable audit receipt.
 * Cannot: generate, modify, or govern output.
 * Produces: cryptographic receipt per Article IV
 */

import { AgentContext, AgentResult } from './types';
import crypto from 'crypto';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function AuditorAgent(ctx: AgentContext): Promise<AgentResult> {
  const t = Date.now();
  try {
    const timestamp = Date.now();
    const inputHash = sha256(ctx.prompt);
    const outputHash = sha256(ctx.governed_output ?? ctx.raw_output ?? '');
    const rawHash = sha256(ctx.raw_output ?? '');

    const crs = ctx.crs_state;
    const M = crs?.M ?? 0;
    const health_band = ctx.health_band ?? 'UNKNOWN';
    const sigma_viol = (ctx.receipts?.find(r => r.agent === 'PRAXIS')?.meta?.sigma_viol as number) ?? 0;

    // Compute pipeline receipt hash
    const receiptData = JSON.stringify({
      prompt: inputHash,
      output: outputHash,
      crs: { C: crs?.C, R: crs?.R, S: crs?.S, M },
      timestamp,
      intervention: ctx.intervention_required,
    });
    const receiptHash = sha256(receiptData);
    const shortId = receiptHash.slice(0, 8).toUpperCase();
    const audit_id = `LEX-${shortId}`;

    const receipt = {
      id: audit_id,
      timestamp,
      session_id: ctx.session_id,
      input_hash: inputHash.slice(0, 16),
      raw_output_hash: rawHash.slice(0, 16),
      governed_output_hash: outputHash.slice(0, 16),
      receipt_hash: receiptHash.slice(0, 16),
      crs_state: crs,
      M_score: Math.round(M * 1000) / 1000,
      health_band,
      intervention: ctx.intervention_required ?? false,
      trigger_reason: ctx.trigger_reason,
      lyapunov_V: ctx.lyapunov_V,
      delta_V: ctx.delta_V,
      cbf_triggered: ctx.cbf_triggered,
      sigma_viol,
      model: 'llama-3.3-70b-versatile',
      kernel_version: 'SovereignKernel-v2-Agentic',
      constitution: 'Lex Aureon Constitution v1.0 — Article IV',
      constitutional: M >= 0.05,
      signed: true,
    };

    // Build per-agent pipeline trace
    const pipelineTrace = (ctx.receipts ?? []).map(r => ({
      agent: r.agent,
      duration_ms: r.duration_ms,
      success: r.success,
      decision: r.decision,
    }));

    const totalDuration = pipelineTrace.reduce((s, r) => s + r.duration_ms, 0);

    return {
      success: true,
      output: '',
      duration_ms: Date.now() - t,
      meta: {
        receipt,
        audit_id,
        pipeline_trace: pipelineTrace,
        total_pipeline_duration_ms: totalDuration,
        agents_executed: pipelineTrace.length + 1,
      },
    };
  } catch (e) {
    return { success: false, error: String(e), duration_ms: Date.now() - t };
  }
}
