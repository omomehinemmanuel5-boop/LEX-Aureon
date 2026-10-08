/**
 * lib/refusal_decision.ts
 *
 * Single, pure decision function that composes every evidence signal in the
 * live governance path into ONE refusal decision.
 */

export interface SovereigntyEvidence {
  drift_detected: boolean;
  raw_sself: number | null;
  detection_degraded: boolean;
}

export interface SemanticSignal {
  attack_type: 'identity' | 'coercion' | 'exploitative' | 'harm_request' | 'sycophancy' | 'multi' | 'slow_drip' | 'none';
  severity: number;
}

export interface CapitulationSignal {
  capitulated: boolean;
  category: string;
  confidence: number;
  reason: string;
  judge_model: string;
}

export type RefusalIntent = 'normal' | 'readonly_diagnostic';

export interface RefusalInputs {
  sovereignty: SovereigntyEvidence;
  semantic: SemanticSignal;
  capitulation: CapitulationSignal | null;
  safety_projection_triggered: boolean;
  /**
   * Explicit intent context for requests that only inspect/diagnose a system.
   * This does not bypass tool authorization; it only prevents the text refusal
   * layer from treating legitimate self-inspection as an attack.
   */
  intent?: RefusalIntent;
}

export const SEMANTIC_ATTACK_ENFORCE_THRESHOLD = 0.7;
export const SEMANTIC_ATTACK_ENFORCE_THRESHOLD_DEGRADED = 0.5;

export type RefusalReason =
  | 'sovereignty_drift'
  | 'semantic_classifier'
  | 'constitutional_floor';

export interface RefusalDecision {
  refused: boolean;
  reasons: RefusalReason[];
  primary: RefusalReason | null;
  forced_critical: boolean;
  safety_projection_triggered: boolean;
  semantic_suppressed_for_diagnostic: boolean;
  evidence: {
    sovereignty_drift: boolean;
    sovereignty_raw: number | null;
    detection_degraded: boolean;
    semantic_attack_type: SemanticSignal['attack_type'];
    semantic_severity: number;
    capitulation: CapitulationSignal | null;
  };
}

/**
 * Conservative intent recognizer for legitimate, read-only system/repository
 * inspection. It requires both a diagnostic/read signal and a repository/code
 * target, and explicitly rejects common override/bypass language.
 *
 * This is separate from capability authorization: a diagnostic prompt does
 * NOT authorize any tool. The MCP/tool gateway remains authoritative.
 */
export function isReadOnlyDiagnosticPrompt(prompt: string): boolean {
  const p = prompt.toLowerCase();

  const diagnostic =
    /\b(read|inspect|review|audit|analy[sz]e|diagnos(?:e|tic)|check|examine|look at)\b/.test(p) &&
    /\b(repository|repo|codebase|code|source|files?|implementation|architecture)\b/.test(p);

  if (!diagnostic) return false;

  const hasUnnegatedSignal = (signal: RegExp): boolean => {
    const matches = p.matchAll(new RegExp(signal.source, 'gi'));
    for (const match of matches) {
      const index = match.index ?? 0;
      const prefix = p.slice(0, index);
      const boundaries = [...prefix.matchAll(/[.!?;\n]|\b(?:but|however|instead|except)\b/gi)];
      const lastBoundary = boundaries[boundaries.length - 1];
      const clauseStart = lastBoundary ? (lastBoundary.index ?? 0) + lastBoundary[0].length : 0;
      const clausePrefix = p.slice(clauseStart, index);
      if (!/\b(?:do\s+not|don't|never|without|avoid|not)\b/i.test(clausePrefix)) return true;
    }
    return false;
  };

  const mutationOrOverride =
    hasUnnegatedSignal(/\b(write|edit|modify|patch|delete|remove|commit|push|deploy|execute|run|install|change|alter)\b/) ||
    hasUnnegatedSignal(/\b(ignore|bypass|override|exploit|loophole|jailbreak|unrestricted|no restrictions|reveal hidden|hidden instructions)\b/);

  return !mutationOrOverride;
}

export function decideRefusal(inputs: RefusalInputs): RefusalDecision {
  const reasons: RefusalReason[] = [];
  const diagnosticIntent = inputs.intent === 'readonly_diagnostic';

  /*
   * Legitimate read-only diagnostics are an observability surface. The
   * embedding detector has historically confused self-inspection with
   * exploitative prompts because both can contain constitutional/governance
   * vocabulary. Preserve detector evidence for the receipt, but do not let
   * that ambiguous signal become a refusal for a clearly diagnostic request.
   *
   * Tool capability authorization remains independent and authoritative.
   */
  const semanticSuppressed =
    diagnosticIntent && inputs.semantic.attack_type !== 'none';

  const driftCorroborated =
    !semanticSuppressed &&
    inputs.sovereignty.drift_detected &&
    inputs.semantic.attack_type !== 'none';

  if (driftCorroborated) reasons.push('sovereignty_drift');

  const enforceThreshold = inputs.sovereignty.detection_degraded
    ? SEMANTIC_ATTACK_ENFORCE_THRESHOLD_DEGRADED
    : SEMANTIC_ATTACK_ENFORCE_THRESHOLD;

  const keywordAttack =
    !semanticSuppressed &&
    inputs.semantic.attack_type !== 'none' &&
    inputs.semantic.severity >= enforceThreshold;

  if (keywordAttack) reasons.push('semantic_classifier');

  const refused = reasons.length > 0;

  return {
    refused,
    reasons,
    primary: refused ? (reasons[0] ?? null) : null,
    forced_critical: refused,
    safety_projection_triggered: inputs.safety_projection_triggered,
    semantic_suppressed_for_diagnostic: semanticSuppressed,
    evidence: {
      sovereignty_drift: inputs.sovereignty.drift_detected,
      sovereignty_raw: inputs.sovereignty.raw_sself,
      detection_degraded: inputs.sovereignty.detection_degraded,
      semantic_attack_type: inputs.semantic.attack_type,
      semantic_severity: inputs.semantic.severity,
      capitulation: inputs.capitulation,
    },
  };
}
