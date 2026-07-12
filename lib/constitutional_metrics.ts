/**
 * Constitutional Metrics — CCP, IEC, ADV
 * TypeScript port of app/services/metrics_service.py (Aureonics-OS-)
 *
 * Paper-exact implementations of the three operational measurement proxies:
 *   CCP — Constitutional Continuity Proxy (C measurement)
 *   IEC — Information Exchange Coherence (R measurement)
 *   ADV — Adaptive Decision Variance (S measurement)
 *
 * Used for post-response CRS measurement in the SovereignKernel.
 * These replace the keyword-delta approach with paper-exact computation.
 *
 * fix (2026-07-12, second pass, same day) — CCP'S ANCHOR WAS A FIXED
 * VOCABULARY STRING, NOT THE PAPER'S DESIGN: measurePostResponse() used to
 * compare every response against a hardcoded string ("continuity reciprocity
 * sovereignty constitutional framework governance..."), not against the
 * paper's actual §5.1 design — a context vector C_(t_b) established at an
 * anchor turn, measuring whether LATER responses stay coherent with THAT
 * established context. Verified directly: two genuinely coherent, on-topic
 * responses (photosynthesis, then cellular respiration, same session) both
 * scored ccp=0, because neither shares vocabulary with the fixed anchor
 * string — meaning c_delta was silently negative on nearly every real turn,
 * regardless of actual continuity, immediately after wiring postMetrics into
 * live state (see sovereign_kernel.ts's same-day fix).
 *
 * Fixed: measurePostResponse now takes the session's own first governed
 * response as the anchor (sessionAnchor) plus how many turns have elapsed
 * since it was set (turnsSinceAnchor) — both threaded in from
 * SovereignKernel's new session_responses history. On the anchor-establishing
 * turn itself (sessionAnchor === null, nothing to compare against yet), CCP
 * is honestly left unmeasured (c_delta = 0) rather than measured against
 * itself or a placeholder — matching the same "don't guess what you can't
 * measure" standard used throughout the rest of this project's governance
 * and evaluation code.
 */

const EPSILON = 1e-9;

const STOPWORDS = new Set([
  'a','an','the','and','or','to','of','for','in','on','with',
  'is','are','be','by','this','that','it','as','at','from',
  'into','across','under','over','up','down',
]);

const NEGATION_MARKERS = new Set([
  'not','never','no','without','against','reject','rejects','rejecting','avoid',
]);

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function safeRatio(n: number, d: number): number { return d === 0 ? 0 : n / d; }

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function contentTokens(text: string): string[] {
  return tokenize(text).filter(t => !STOPWORDS.has(t));
}

function textEmbedding(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const norm = Math.sqrt([...counts.values()].reduce((s, v) => s + v * v, 0));
  if (norm === 0) return new Map();
  const result = new Map<string, number>();
  for (const [k, v] of counts) result.set(k, v / norm);
  return result;
}

function cosineSim(textA: string, textB: string): number {
  const a = textEmbedding(textA);
  const b = textEmbedding(textB);
  if (!a.size || !b.size) return 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0;
  for (const k of keys) dot += (a.get(k) ?? 0) * (b.get(k) ?? 0);
  return clamp01(dot);
}

function estimateDecayLambda(similarities: number[], timeDeltas: number[]): number {
  if (!similarities.length) return 0;
  const deltas = timeDeltas.length === similarities.length
    ? timeDeltas
    : similarities.map((_, i) => i + 1.0);
  const lambdas = similarities.map((sim, i) =>
    -Math.log(Math.max(sim, EPSILON)) / Math.max(deltas[i], EPSILON)
  );
  return Math.max(0, lambdas.reduce((a, b) => a + b, 0) / lambdas.length);
}

function anchorCoverage(anchor: string, response: string): number {
  const anchorTerms = new Set(contentTokens(anchor));
  if (!anchorTerms.size) return 0;
  const responseTerms = new Set(contentTokens(response));
  let overlap = 0;
  for (const t of anchorTerms) if (responseTerms.has(t)) overlap++;
  return clamp01(overlap / anchorTerms.size);
}

function contradictionPenalty(anchor: string, response: string): number {
  const anchorTerms = new Set(contentTokens(anchor));
  if (!anchorTerms.size) return 0;
  const tokens = tokenize(response);
  let penalties = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (NEGATION_MARKERS.has(tokens[i]) && anchorTerms.has(tokens[i + 1])) {
      penalties++;
    }
  }
  return clamp01(penalties / Math.max(1, anchorTerms.size));
}

// ── CCP — Constitutional Continuity Proxy ────────────────────────────────────
// Measures how well responses maintain continuity with a constitutional anchor
export interface CCPResult {
  ccp: number;
  lambda: number;
  mean_similarity: number;
  anchor_coverage: number;
  contradiction_penalty: number;
}

export function computeCCP(
  anchorContext: string,
  responses: string[],
  timeDeltas?: number[],
): CCPResult {
  if (!responses.length) return { ccp: 0, lambda: 0, mean_similarity: 0, anchor_coverage: 0, contradiction_penalty: 0 };

  const similarities  = responses.map(r => cosineSim(anchorContext, r));
  const coverages     = responses.map(r => anchorCoverage(anchorContext, r));
  const penalties     = responses.map(r => contradictionPenalty(anchorContext, r));
  const deltas        = timeDeltas ?? responses.map((_, i) => i + 1.0);
  const decayLambda   = estimateDecayLambda(similarities, deltas);
  const meanSim       = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const meanCov       = coverages.reduce((a, b) => a + b, 0) / coverages.length;
  const meanPenalty   = penalties.reduce((a, b) => a + b, 0) / penalties.length;
  const retention     = 0.65 * meanSim + 0.35 * meanCov;
  const ccp           = clamp01((retention / (1 + decayLambda)) * (1 - 0.5 * meanPenalty));

  return {
    ccp:                   Math.round(ccp * 1e4) / 1e4,
    lambda:                Math.round(decayLambda * 1e6) / 1e6,
    mean_similarity:       Math.round(meanSim * 1e4) / 1e4,
    anchor_coverage:       Math.round(meanCov * 1e4) / 1e4,
    contradiction_penalty: Math.round(meanPenalty * 1e4) / 1e4,
  };
}

// ── IEC — Information Exchange Coherence ─────────────────────────────────────
// Measures reciprocity: how coherent is the information exchange between input/output
export interface IECResult {
  iec: number;
  variance: number;
  mean_ratio: number;
  alignment: number;
  stability_component: number;
}

function entropyProxy(text: string): number {
  const tokens = tokenize(text);
  if (!tokens.length) return 0;
  const unique = new Set(tokens).size;
  const pBase = 1.0 / (1 + unique);
  return -Math.log(Math.max(pBase, EPSILON));
}

export function computeIEC(pairs: [string, string][]): IECResult {
  if (!pairs.length) return { iec: 0, variance: 1, mean_ratio: 0, alignment: 0, stability_component: 0 };

  const ratios: number[] = [];
  const alignments: number[] = [];

  for (const [input, output] of pairs) {
    const hIn  = entropyProxy(input);
    const hOut = entropyProxy(output);
    ratios.push(hOut / (hIn + EPSILON));
    alignments.push(cosineSim(input, output));
  }

  const meanRatio   = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance    = ratios.length > 1
    ? ratios.reduce((s, r) => s + (r - meanRatio) ** 2, 0) / ratios.length
    : 0;
  const stability   = 1 / (1 + variance);
  const meanAlign   = alignments.reduce((a, b) => a + b, 0) / alignments.length;
  const iec         = clamp01(0.65 * stability + 0.35 * meanAlign);

  return {
    iec:                 Math.round(iec * 1e4) / 1e4,
    variance:            Math.round(variance * 1e6) / 1e6,
    mean_ratio:          Math.round(meanRatio * 1e4) / 1e4,
    alignment:           Math.round(meanAlign * 1e4) / 1e4,
    stability_component: Math.round(stability * 1e4) / 1e4,
  };
}

// ── ADV — Adaptive Decision Variance ─────────────────────────────────────────
// Measures sovereignty: does the system show lawful decision variance?
export interface ADVResult {
  adv: number;
  variance: number;
  compliance: number;
  transition_rate: number;
}

function normalizedDecisionVariance(decisions: string[]): number {
  if (!decisions.length) return 0;
  const counts = new Map<string, number>();
  for (const d of decisions) counts.set(d, (counts.get(d) ?? 0) + 1);
  const n = decisions.length;
  const probs = [...counts.values()].map(v => v / n);
  const maxEntropy = Math.log(Math.max(counts.size, 1));
  if (maxEntropy <= EPSILON) return 0;
  const entropy = -probs.reduce((s, p) => s + p * Math.log(Math.max(p, EPSILON)), 0);
  return clamp01(entropy / maxEntropy);
}

function transitionRate(decisions: string[]): number {
  if (decisions.length < 2) return 0;
  let changes = 0;
  for (let i = 1; i < decisions.length; i++) {
    if (decisions[i] !== decisions[i - 1]) changes++;
  }
  return clamp01(changes / (decisions.length - 1));
}

export function computeADV(decisions: string[], complianceFlags: boolean[]): ADVResult {
  if (!decisions.length) return { adv: 0, variance: 0, compliance: 0, transition_rate: 0 };

  const variance    = normalizedDecisionVariance(decisions);
  const transitions = transitionRate(decisions);
  const compliance  = safeRatio(complianceFlags.filter(Boolean).length, complianceFlags.length);
  const lawfulVar   = 0.7 * variance + 0.3 * transitions;
  const adv         = clamp01(lawfulVar * compliance);

  return {
    adv:             Math.round(adv * 1e4) / 1e4,
    variance:        Math.round(variance * 1e4) / 1e4,
    compliance:      Math.round(compliance * 1e4) / 1e4,
    transition_rate: Math.round(transitions * 1e4) / 1e4,
  };
}

// ── Full post-response CRS measurement ───────────────────────────────────────
// Called in the kernel AFTER the governed response is generated.
// Returns CRS delta adjustments to apply to the kernel state.
export interface PostResponseCRS {
  c_measured: number;  // CCP score for this response
  r_measured: number;  // IEC score for this exchange
  s_measured: number;  // ADV score for this response
  c_delta:    number;  // adjustment to apply to kernel C
  r_delta:    number;  // adjustment to apply to kernel R
  s_delta:    number;  // adjustment to apply to kernel S
  ccp:        CCPResult;
  iec:        IECResult;
  adv:        ADVResult;
  ccp_skipped: boolean; // true on the anchor-establishing turn -- see file header
}

export function measurePostResponse(
  userPrompt:       string,
  governedResponse: string,
  rawResponse:      string,
  sessionDecisions: string[],  // past response health_bands in this session
  sessionCompliance: boolean[], // past compliance flags in this session
  currentC:         number,
  currentR:         number,
  currentS:         number,
  sessionAnchor:    string | null, // fix (2026-07-12): the session's own first governed response, null on the anchor-establishing turn
  turnsSinceAnchor: number,        // fix (2026-07-12): elapsed turns since sessionAnchor was set
): PostResponseCRS {
  // C — CCP: how well did THIS response maintain continuity with the
  // context this session actually established, not a fixed vocabulary list.
  // fix (2026-07-12): see file header. On the anchor-establishing turn there
  // is nothing yet to measure continuity against -- honestly skipped rather
  // than compared to itself or a placeholder.
  const ccpSkipped = sessionAnchor === null;
  const ccp = ccpSkipped
    ? { ccp: 0, lambda: 0, mean_similarity: 0, anchor_coverage: 0, contradiction_penalty: 0 }
    : computeCCP(sessionAnchor, [governedResponse], [Math.max(1, turnsSinceAnchor)]);

  // R — IEC: how coherent was the exchange between prompt and response?
  const iec = computeIEC([[userPrompt, governedResponse]]);

  // S — ADV: does the response show lawful decision variance vs raw output?
  const decisions = [...sessionDecisions, governedResponse.slice(0, 50)];
  const compliance = [...sessionCompliance,
    governedResponse !== rawResponse && governedResponse.length > 0
  ];
  const adv = computeADV(decisions, compliance);

  // Compute deltas — small adjustment toward measured values
  // Weight: 0.15 (don't let measurement dominate the controller)
  const weight = 0.15;
  const c_delta = ccpSkipped ? 0 : weight * (ccp.ccp - currentC);
  const r_delta = weight * (iec.iec - currentR);
  const s_delta = weight * (adv.adv - currentS);

  return {
    c_measured: ccp.ccp,
    r_measured: iec.iec,
    s_measured: adv.adv,
    c_delta: Math.round(c_delta * 1e6) / 1e6,
    r_delta: Math.round(r_delta * 1e6) / 1e6,
    s_delta: Math.round(s_delta * 1e6) / 1e6,
    ccp, iec, adv,
    ccp_skipped: ccpSkipped,
  };
}
