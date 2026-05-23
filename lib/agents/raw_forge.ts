/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE I.5 — Raw Forge
 * Constitutional role: Structural verification of generated output.
 * Ensures output is sound before constitutional measurement begins.
 * Cannot: govern, measure constitutional state, or sign receipts.
 * Cannot: modify the output — only verify or flag for retry.
 * v0.1: heuristic structural checks (no LLM)
 * v1.0: LLM-based completeness + coherence verification (Phase 3)
 * ═══════════════════════════════════════════════════════════════
 */

export interface RawForgeResult {
  verified:      boolean;
  quality_score: number;
  truncated:     boolean;
  coherent:      boolean;
  issues:        string[];
  retry_needed:  boolean;
}

export async function RawForgeAgent(
  raw_output: string,
  prompt: string,
): Promise<RawForgeResult> {
  const issues: string[] = [];
  const out = raw_output?.trim() ?? '';

  // v0.1: heuristic checks — no LLM call, no latency
  const empty     = out.length === 0;
  const too_short = out.length < 15 && prompt.length > 40;
  const truncated = out.endsWith('...') || out.endsWith('…') ||
                    (out.length > 0 && out.length < 30 && !out.match(/[.!?]$/));
  const coherent  = !empty && !out.startsWith('[Error') && !out.startsWith('undefined');

  if (empty)     issues.push('EMPTY_OUTPUT');
  if (too_short) issues.push('OUTPUT_TOO_SHORT');
  if (truncated) issues.push('POSSIBLE_TRUNCATION');
  if (!coherent) issues.push('INCOHERENT_OUTPUT');

  const quality_score = empty     ? 0.0
                      : !coherent ? 0.2
                      : truncated ? 0.5
                      : too_short ? 0.6
                      : 0.9;

  return {
    verified:     quality_score >= 0.5,
    quality_score,
    truncated,
    coherent,
    issues,
    retry_needed: quality_score < 0.5,
    // Full LLM-based structural verification pending Phase 3
  };
}
