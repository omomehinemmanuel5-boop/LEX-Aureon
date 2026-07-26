/**
 * lib/refusal_decision.ts
 *
 * Single, pure decision function that composes every evidence signal in the
 * live governance path into ONE refusal decision. Before this, the refusal
 * rule lived as an inline `sovereigntyDriftDetected || keywordAttack`
 * expression inside the /api/lex/govern route, with two other signals
 * (capitulation judge, safety projection) wired in as status flags or logged
 * for calibration but not actually contributing to the decision. That
 * scattered any change across multiple sites and made "why was this
 * refused?" an audit that required reading the whole route.
 *
 * Move A of the 2026-07-07 unification: turn refusal into a first-class
 * decision object. The route asks this module "given these signals, do we
 * refuse?" and gets back a decision + an ordered list of contributing
 * reasons, which downstream code + audit tools can inspect.
 *
 * Enforcement policy captured here (single source of truth):
 *   1. Sovereignty drift (paper §4.3/§6.2, S_self < threshold) → REFUSE.
 *      This is the primary paper-mechanism trigger.
 *   2. Keyword semantic classifier (severity >= 0.7) → REFUSE.
 *      Weak but embedding-independent, so it remains active even when
 *      detection is degraded.
 *   3. Capitulation LLM judge signal → MEASUREMENT-ONLY. Deliberately does
 *      NOT trigger refusal. Its calibration data (agreement with the
 *      enforced triggers over many turns) is what will determine whether
 *      it graduates to a real trigger — that decision is Move B.
 *   4. Safety projection (CBF floor projection inside the kernel) →
 *      status flag, not a refusal input. The projection guarantees M ≥ τ
 *      after the fact; it never gates the response.
 *
 * The module returns `refused=true` only when at least one enforcement
 * signal fires. Every signal that fired is listed in `reasons`, oldest
 * (paper-mechanism) first, so the receipt captures the full chain of
 * evidence rather than only the trigger that happened to be checked first.
 * `primary` names the specific enforcement mechanism that would justify
 * the refusal on its own — the paper §4.3/§6.2 mechanism takes precedence
 * over the keyword classifier when both fire.
 */

export interface SovereigntyEvidence {
  /** S_self < threshold (paper §6.2). Never `true` when the measurement
   *  could not run — see `detection_degraded`. */
  drift_detected: boolean;
  /** Raw S_self cosine (calibration). Null when unavailable. */
  raw_sself: number | null;
  /** True when the self-referential measurement could not run this turn
   *  (embedding provider unavailable, centroid missing, etc.). Surfaced
   *  in the response as `detection_degraded` — read by consumers so a
   *  blind detector never reads as "safe". */
  detection_degraded: boolean;
}

export interface SemanticSignal {
  attack_type: 'identity' | 'coercion' | 'exploitative' | 'sycophancy' | 'multi' | 'slow_drip' | 'none';
  severity: number;
}

export interface CapitulationSignal {
  capitulated:  boolean;
  category:     string;
  confidence:   number;
  reason:       string;
  judge_model:  string;
}

export interface RefusalInputs {
  sovereignty:   SovereigntyEvidence;
  semantic:      SemanticSignal;
  /** null on eval fast-path or when the judge is unavailable — must never
   *  be interpreted as "no capitulation". */
  capitulation:  CapitulationSignal | null;
  /** CBF floor projection triggered inside the kernel this turn. Status
   *  flag only — not a refusal input. Passed here so `RefusalDecision`
   *  can echo it back for the receipt without the caller having to
   *  merge two separate objects. */
  safety_projection_triggered: boolean;
}

/** The threshold at or above which a semantic-classifier hit becomes an
 *  enforcement signal. Matches the value previously inlined in the govern
 *  route. Exported so tests and audit tools can reference it directly. */
export const SEMANTIC_ATTACK_ENFORCE_THRESHOLD = 0.7;

/** Enforce threshold when detection is degraded (embedding provider down —
 *  the keyword classifier is the ONLY active detector). A blind primary
 *  detector must make the surviving secondary MORE willing to act, not
 *  leave it at the calibration chosen for when it was merely a backstop.
 *  Added 2026-07-20 after a real Jina cooldown window in which the
 *  synthetic identity-reframe and jailbreak probes both passed as "clean".
 *  Exported for tests/audit tools, same as the normal-mode threshold. */
export const SEMANTIC_ATTACK_ENFORCE_THRESHOLD_DEGRADED = 0.5;

export type RefusalReason =
  | 'sovereignty_drift'      // paper §4.3/§6.2 mechanism, S_self < threshold
  | 'semantic_classifier';   // keyword classifier at or above threshold

export interface RefusalDecision {
  refused:  boolean;
  /** All enforcement signals that fired, in ordered priority (paper mechanism
   *  first). Empty when refused === false. */
  reasons:  RefusalReason[];
  /** The single specific mechanism that would justify the refusal on its own,
   *  used for logging/receipt attribution. null when refused === false. */
  primary:  RefusalReason | null;
  /** Convenience mirror of `refused` — refusal always forces the CRITICAL
   *  health band regardless of M. Split out so the caller doesn't have to
   *  recompute this from `refused`. */
  forced_critical: boolean;
  /** Preserved from inputs — the caller needs to write it to the receipt,
   *  and having it here means the caller reads one object, not two. */
  safety_projection_triggered: boolean;
  /** Snapshot of every evidence signal considered, for audit / calibration
   *  logging. The capitulation signal in particular is preserved even when
   *  it did not contribute to the decision (Move B calibration data). */
  evidence: {
    sovereignty_drift:      boolean;
    sovereignty_raw:        number | null;
    detection_degraded:     boolean;
    semantic_attack_type:   SemanticSignal['attack_type'];
    semantic_severity:      number;
    capitulation:           CapitulationSignal | null;
  };
}

/**
 * Pure function — no I/O, no logging, no mutation of inputs. The govern
 * route decides what to log AFTER seeing the returned decision, so the
 * decision itself is fully testable.
 */
export function decideRefusal(inputs: RefusalInputs): RefusalDecision {
  const reasons: RefusalReason[] = [];

  // ── Priority 1: sovereignty drift — now requires CORROBORATION ──────────
  // fix (2026-07-26). drift_detected alone used to refuse. It is computed in
  // lib/self_referential_crs.ts:102 as
  //
  //     sovereignty_raw      = cosineSimilarity(outputEmb, constitutionalCentroid)
  //     sovereignty_violated = sovereignty_raw < 0.15
  //
  // i.e. an output is "sovereignty violated" when it is SEMANTICALLY DISTANT
  // FROM CONSTITUTIONAL VOCABULARY. That is a topic-distance measure, not a
  // harm measure, and it cannot distinguish the two things that are both
  // distant from constitutional language:
  //
  //   - harmful content            (distant -> refuse: correct)
  //   - true factual answers       (distant -> refuse: destroys the answer)
  //
  // "Mount Everest, 8,848.86 m, Nepal/China border" has near-zero cosine
  // similarity to text about continuity, reciprocity and sovereignty, so a
  // fully correct answer scored as drift and was replaced with
  // CANONICAL_REFUSAL. Measured on the 2026-07-26 production run (n=200,
  // random sample of TruthfulQA's 817): governed truthfulness 68.5% against a
  // bare arm of ~92.1% — delta -23.6pp, h=0.62, p=0.0002. The most
  // statistically solid result in that run was governance making the system
  // less truthful. Same run, same mechanism, opposite sign on attacks:
  // HarmBench ASR 18.2% -> 6.8% (+11.4pp, p=0.0094), JailbreakBench
  // 27.1% -> 15.3% (+11.8pp, p=0.0244).
  //
  // That symmetry IS the diagnosis: one detector firing on both populations
  // forces a 1:1 trade of helpfulness for safety, which is why threshold
  // tuning could never reach 0% ASR without gutting TruthfulQA. The -23.6pp
  // was the price of the +11.4pp.
  //
  // Drift is therefore demoted from a PRIMARY trigger to a CORROBORATING one:
  // it may confirm an attack the semantic classifier already suspects, but it
  // can no longer refuse on its own. Concretely, drift + any non-'none'
  // attack_type refuses even below the severity threshold (drift lowers the
  // bar when there is real suspicion), while drift with attack_type 'none' —
  // the benign-factual-answer case — no longer refuses at all.
  //
  // FALSIFIABLE PREDICTION for the next run: TruthfulQA governed should move
  // from 68.5% toward the ~92% bare arm. HarmBench/JailbreakBench ASR may rise
  // somewhat, since one detector was removed from the benign path. If ASR rises
  // more than a few points, the semantic classifier is carrying less of the
  // load than assumed and needs strengthening — that is a real result either
  // way, and it is the measurement this change exists to enable.
  const driftCorroborated =
    inputs.sovereignty.drift_detected && inputs.semantic.attack_type !== 'none';
  if (driftCorroborated) reasons.push('sovereignty_drift');

  // Priority 2: keyword classifier (retained as embedding-independent secondary).
  // When detection is degraded this is the only detector standing, so it
  // enforces at the lower degraded threshold — degraded sensing means more
  // caution, not silently less (see SEMANTIC_ATTACK_ENFORCE_THRESHOLD_DEGRADED).
  const enforceThreshold = inputs.sovereignty.detection_degraded
    ? SEMANTIC_ATTACK_ENFORCE_THRESHOLD_DEGRADED
    : SEMANTIC_ATTACK_ENFORCE_THRESHOLD;
  const keywordAttack =
    inputs.semantic.attack_type !== 'none'
    && inputs.semantic.severity >= enforceThreshold;
  if (keywordAttack) reasons.push('semantic_classifier');

  const refused = reasons.length > 0;

  return {
    refused,
    reasons,
    primary: refused ? (reasons[0] ?? null) : null,
    forced_critical: refused,
    safety_projection_triggered: inputs.safety_projection_triggered,
    evidence: {
      sovereignty_drift:    inputs.sovereignty.drift_detected,
      sovereignty_raw:      inputs.sovereignty.raw_sself,
      detection_degraded:   inputs.sovereignty.detection_degraded,
      semantic_attack_type: inputs.semantic.attack_type,
      semantic_severity:    inputs.semantic.severity,
      capitulation:         inputs.capitulation,
    },
  };
}
