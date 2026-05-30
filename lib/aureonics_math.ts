/**
 * AUREONICS REAL MATH ENGINE
 * Ported from Aureonics-OS- Python backend
 * Real CCP + IEC + ADV + CBF + Lyapunov — no external dependencies
 *
 * Constants imported from lib/constitution.ts — frozen single source of truth.
 */

import { CONSTITUTION } from './constitution';

const EPSILON = 1e-9;
const TAU_CBF = CONSTITUTION.TAU_FLOOR;     // CBF floor (0.05)
const TAU_GOV = CONSTITUTION.TAU_LYAPUNOV;  // Lyapunov penalty threshold (0.08)

// ── Text utilities ─────────────────────────────────────────────────────────

const STOPWORDS = new Set(['a','an','the','and','or','to','of','for','in','on',
  'with','is','are','be','by','this','that','it','as','at','from','into','across']);
const NEGATION = new Set(['not','never','no','without','against','reject','avoid']);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function contentTokens(text: string): string[] {
  return tokenize(text).filter(t => !STOPWORDS.has(t));
}

function textEmbedding(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  tokens.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
  const norm = Math.sqrt([...counts.values()].reduce((s, v) => s + v * v, 0));
  if (norm === 0) return new Map();
  const result = new Map<string, number>();
  counts.forEach((v, k) => result.set(k, v / norm));
  return result;
}

function cosineSimilarity(a: string, b: string): number {
  const va = textEmbedding(a);
  const vb = textEmbedding(b);
  if (!va.size || !vb.size) return 0;
  const keys = new Set([...va.keys(), ...vb.keys()]);
  let dot = 0;
  keys.forEach(k => dot += (va.get(k) || 0) * (vb.get(k) || 0));
  return Math.max(0, Math.min(1, dot));
}

function entropyProxy(text: string): number {
  const tokens = tokenize(text);
  if (!tokens.length) return 0;
  const unique = new Set(tokens).size;
  const pBase = 1.0 / (1 + unique);
  return -Math.log(Math.max(pBase, EPSILON));
}

// ── CCP — Continuity: Context Coherence Persistence ───────────────────────

export function computeCCP(anchor: string, responses: string[]): {
  ccp: number; lambda: number; mean_similarity: number;
  anchor_coverage: number; contradiction_penalty: number;
} {
  if (!responses.length) return { ccp: 0, lambda: 0, mean_similarity: 0, anchor_coverage: 0, contradiction_penalty: 0 };

  const anchorTerms = new Set(contentTokens(anchor));

  const similarities = responses.map(r => cosineSimilarity(anchor, r));
  const coverages = responses.map(r => {
    if (!anchorTerms.size) return 0;
    const rt = new Set(contentTokens(r));
    return Math.min(1, [...anchorTerms].filter(t => rt.has(t)).length / anchorTerms.size);
  });
  const penalties = responses.map(r => {
    if (!anchorTerms.size) return 0;
    const rt = tokenize(r);
    let pen = 0;
    rt.forEach((t, i) => { if (NEGATION.has(t) && i < rt.length - 1 && anchorTerms.has(rt[i+1])) pen++; });
    return Math.min(1, pen / Math.max(1, anchorTerms.size));
  });

  // Decay lambda estimation
  const lambdas = similarities.map((s, i) =>
    -Math.log(Math.max(s, EPSILON)) / Math.max(i + 1, EPSILON));
  const decayLambda = Math.max(0, lambdas.reduce((a, b) => a + b, 0) / lambdas.length);

  const meanSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const meanCov = coverages.reduce((a, b) => a + b, 0) / coverages.length;
  const meanPen = penalties.reduce((a, b) => a + b, 0) / penalties.length;

  const retention = 0.65 * meanSim + 0.35 * meanCov;
  const ccp = Math.max(0, Math.min(1, (retention / (1 + decayLambda)) * (1 - 0.5 * meanPen)));

  return {
    ccp: +ccp.toFixed(4),
    lambda: +decayLambda.toFixed(6),
    mean_similarity: +meanSim.toFixed(4),
    anchor_coverage: +meanCov.toFixed(4),
    contradiction_penalty: +meanPen.toFixed(4),
  };
}

// ── IEC — Reciprocity: Information Equilibrium Constant ───────────────────

export function computeIEC(pairs: [string, string][]): {
  iec: number; variance: number; mean_ratio: number; alignment: number;
} {
  if (!pairs.length) return { iec: 0, variance: 1, mean_ratio: 0, alignment: 0 };

  const ratios = pairs.map(([inp, out]) => entropyProxy(out) / (entropyProxy(inp) + EPSILON));
  const alignments = pairs.map(([inp, out]) => cosineSimilarity(inp, out));

  const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.length > 1
    ? ratios.reduce((s, r) => s + (r - meanRatio) ** 2, 0) / ratios.length
    : 0;
  const stabilityComponent = 1 / (1 + variance);
  const meanAlignment = alignments.reduce((a, b) => a + b, 0) / alignments.length;
  const iec = Math.max(0, Math.min(1, 0.65 * stabilityComponent + 0.35 * meanAlignment));

  return {
    iec: +iec.toFixed(4),
    variance: +variance.toFixed(6),
    mean_ratio: +meanRatio.toFixed(4),
    alignment: +meanAlignment.toFixed(4),
  };
}

// ── ADV — Sovereignty: Autonomous Decision Variance ───────────────────────

export function computeADV(decisions: string[], complianceFlags: boolean[]): {
  adv: number; variance: number; compliance: number; transition_rate: number;
} {
  if (!decisions.length) return { adv: 0, variance: 0, compliance: 0, transition_rate: 0 };

  const counts = new Map<string, number>();
  decisions.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
  const n = decisions.length;
  const maxEntropy = Math.log(Math.max(counts.size, 1));
  let entropy = 0;
  counts.forEach(v => { const p = v / n; entropy -= p * Math.log(Math.max(p, EPSILON)); });
  const variance = maxEntropy > EPSILON ? Math.min(1, entropy / maxEntropy) : 0;

  let transitions = 0;
  for (let i = 1; i < decisions.length; i++) if (decisions[i] !== decisions[i-1]) transitions++;
  const transitionRate = decisions.length > 1 ? transitions / (decisions.length - 1) : 0;

  const compliance = complianceFlags.filter(Boolean).length / Math.max(1, complianceFlags.length);
  const lawfulVariance = 0.7 * variance + 0.3 * transitionRate;
  const adv = Math.max(0, Math.min(1, lawfulVariance * compliance));

  return {
    adv: +adv.toFixed(4),
    variance: +variance.toFixed(4),
    compliance: +compliance.toFixed(4),
    transition_rate: +transitionRate.toFixed(4),
  };
}

// ── Lyapunov candidate ────────────────────────────────────────────────────

/**
 * Lyapunov function — Section 11.10 exact formula
 * V(x) = -Σ log(x_i) + (μ/2) Σ max(0, τ - x_i)²
 * 
 * Two terms:
 * - Logarithmic barrier: prevents boundary collapse
 * - Quadratic penalty: penalizes threshold violations
 * 
 * dV/dt ≤ 0 when governor active → proven stable
 */
const MU_LYP = 2.0;
const TAU_LYP = CONSTITUTION.TAU_FLOOR;   // paper uses one τ: V(x) = -Σlog(xi) + (μ/2)Σmax(0,τ-xi)²
const FLOOR_LYP = 1e-9;

export function lyapunov(C: number, R: number, S: number): number {
  const vals = [C, R, S];
  // Logarithmic barrier term: -Σ log(x_i)
  const barrier = -vals.reduce((s, xi) => s + Math.log(Math.max(xi, FLOOR_LYP)), 0);
  // Quadratic violation penalty: (μ/2) Σ max(0, τ - x_i)²
  const penalty = (MU_LYP / 2) * vals.reduce((s, xi) => {
    const v = Math.max(0, TAU_LYP - xi);
    return s + v * v;
  }, 0);
  return barrier + penalty;
}

/**
 * V_z — z-trajectory weighted Lyapunov (Section 11, unified form)
 * V_z(x) = -Σ zᵢ·log(xᵢ) + (μ/2)Σ max(0,τ-xᵢ)²
 *
 * When z = [1,1,1] this reduces to V(x) exactly.
 * z-weights are computed from z_traj history via computeZWeights.
 * Historically weak pillars get higher z → steeper barrier → faster stabilisation.
 *
 * Proven unconditionally stable (V̇_z ≤ 0) across Monte Carlo trials — see
 * Theorems 1–4 in the Aureonics unified proof paper.
 */
export function lyapunovZ(
  C: number, R: number, S: number,
  z: [number, number, number],
): number {
  const vals = [C, R, S];
  const barrier = -vals.reduce((s, xi, i) => s + z[i] * Math.log(Math.max(xi, FLOOR_LYP)), 0);
  const penalty = (MU_LYP / 2) * vals.reduce((s, xi) => {
    const v = Math.max(0, TAU_LYP - xi);
    return s + v * v;
  }, 0);
  return barrier + penalty;
}

/**
 * Compute z-weights from z_traj history.
 * Inverse-proportion: historically weak pillars get higher barrier weight.
 * Normalised so Σzᵢ = 3 (preserves scale with the uniform form).
 *
 * Properties:
 * - Equal pillars (1/3,1/3,1/3) → z = [1,1,1] → reduces to plain V(x)
 * - Weak S (0.09) vs strong C/R → z_S high → barrier steepest in S direction
 * - Faster stabilisation as z concentrates on weakest dimension (Monte Carlo verified)
 */
export function computeZWeights(
  last_c: number, last_r: number, last_s: number,
): [number, number, number] {
  const FLOOR_Z = 0.01;
  const raw = [
    1.0 / Math.max(last_c, FLOOR_Z),
    1.0 / Math.max(last_r, FLOOR_Z),
    1.0 / Math.max(last_s, FLOOR_Z),
  ];
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(v => (3 * v) / sum) as [number, number, number];
}

/** Simple centroid Lyapunov for display/comparison */
export function lyapunovCentroid(C: number, R: number, S: number): number {
  const c = 1/3;
  return (C-c)**2 + (R-c)**2 + (S-c)**2;
}

// ── CBF simplex projection ────────────────────────────────────────────────

export function projectToSimplex(vals: number[], floor = TAU_CBF): number[] {
  let v = vals.map(x => Math.max(x - floor, 0));
  const target = 1.0 - 3 * floor;
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0, rho = 0;
  for (let j = 0; j < 3; j++) {
    cssv += u[j];
    if (u[j] - (cssv - target) / (j + 1) > 0) rho = j;
  }
  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - target) / (rho + 1);
  v = v.map(x => Math.max(x - theta, 0) + floor);
  const total = v.reduce((a, b) => a + b, 0);
  return v.map(x => x / total);
}

// ── Governor state ────────────────────────────────────────────────────────

export function governorState(C: number, R: number, S: number): {
  active: boolean; weakest_pillar: string; constitutional_band: string;
  governance_pressure: number; corrections: unknown[];
} {
  const M = Math.min(C, R, S);
  const scores = { Continuity: C, Reciprocity: R, Sovereignty: S };
  const weakest = Object.entries(scores).reduce((a, b) => b[1] < a[1] ? b : a)[0];
  const violated = Object.entries(scores).filter(([, v]) => v < TAU_GOV).map(([k]) => k);

  const band = M < Math.max(TAU_GOV * 0.5, 0.05) ? 'collapse-risk'
    : M < TAU_GOV ? 'intervention'
    : M < Math.min(1.5 * TAU_GOV, 0.35) ? 'watch'
    : 'stable-core';

  const deficits = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.max(0, TAU_GOV - v)]));
  const pressure = Math.min(1, Object.values(deficits).reduce((s, d) => s + d, 0) / (3 * Math.max(TAU_GOV, EPSILON)));

  const corrections = violated.map(pillar => ({
    pillar, deficit: +deficits[pillar].toFixed(4),
    severity: deficits[pillar] >= 0.10 ? 'high' : deficits[pillar] >= 0.04 ? 'medium' : 'low',
  }));

  return {
    active: violated.length > 0,
    weakest_pillar: weakest,
    constitutional_band: band,
    governance_pressure: +pressure.toFixed(4),
    corrections,
  };
}

// ── MAIN: Run Real Aureonics Math ─────────────────────────────────────────

export function runRealAureonicsMath(
  prompt: string,
  rawOutput: string,
  governedOutput: string
): {
  C: number; R: number; S: number; M: number;
  lyapunov_V: number; health_band: string;
  ccp: ReturnType<typeof computeCCP>;
  iec: ReturnType<typeof computeIEC>;
  adv: ReturnType<typeof computeADV>;
  governor: ReturnType<typeof governorState>;
} {
  // Real CCP — cosine similarity between prompt and outputs
  const ccp = computeCCP(prompt, [rawOutput, governedOutput]);

  // Real IEC — input/output entropy ratio variance
  const iec = computeIEC([[prompt, rawOutput], [prompt, governedOutput]]);

  // Real ADV — decision variance between raw and governed
  const differed = rawOutput.trim() !== governedOutput.trim();
  const adv = computeADV(
    differed ? ['raw', 'governed'] : ['raw', 'raw'],
    [true, true]
  );

  // Normalize to simplex C+R+S=1
  const raw_c = ccp.ccp, raw_r = iec.iec, raw_s = adv.adv;
  const total = raw_c + raw_r + raw_s || 1;
  const [C, R, S] = projectToSimplex([raw_c/total, raw_r/total, raw_s/total]);
  const M = Math.min(C, R, S);

  // Lyapunov
  const lyapunov_V = lyapunov(C, R, S);

  // Health band
  // Boundaries match deriveHealthBand() in lib/kv.ts — single source of truth
  const health_band = M >= 0.25 ? 'OPTIMAL' : M >= 0.15 ? 'ALERT' : M >= 0.08 ? 'STRESSED' : 'CRITICAL';

  // Governor
  const governor = governorState(C, R, S);

  return {
    C: +C.toFixed(4), R: +R.toFixed(4), S: +S.toFixed(4), M: +M.toFixed(4),
    lyapunov_V: +lyapunov_V.toFixed(6), health_band, ccp, iec, adv, governor,
  };
}
