/**
 * scripts/cbf/op1-lyapunov-check.ts
 *
 * Numerical corroboration for the Open Problem 1 (multi-pillar global Lyapunov)
 * progress written up in research/empirical-results.md "Run 003". Uses the
 * ACTUAL production certificate and governor from lib/aureonics_core.ts — not a
 * re-derivation — so the checks track the deployed math.
 *
 * Three claims, all MULTI-PILLAR (no single-pillar restriction):
 *   1. V_z is convex on the floor-simplex  (⇒ idealized flow global Lyapunov).
 *   2. The projected-gradient flow ẋ = −Π_Σ∇V_z decreases V_z monotonically
 *      from every start, all pillars free.
 *   3. The DEPLOYED governor G always descends V_z: ⟨∇V_z(x), G(x)⟩ ≤ 0 for
 *      all x, including states with two pillars simultaneously near the floor.
 *
 * These are numerical CONFIRMATIONS of analytical arguments (convexity of V_z;
 * Chebyshev's sum inequality for the governor term). They are evidence, not a
 * proof, and they do NOT discharge the remaining gap — the governor-vs-drift
 * margin under the replicator field F. See the write-up for exactly what stays
 * open.
 *
 * Run:  npx tsx scripts/cbf/op1-lyapunov-check.ts
 */
import { lyapunovBarrierZ, calculateGovernorG, projectToSimplex, TAU } from '../../lib/aureonics_core';

type V3 = [number, number, number];
const z: V3 = [1 / 3, 1 / 3, 1 / 3]; // uniform z (Z_RECOVERY / FPL-1 certificate case)
const V = (x: V3) => lyapunovBarrierZ(x, z);

function gradV(x: V3): V3 {
  const h = 1e-6; const g: number[] = [];
  for (let i = 0; i < 3; i++) {
    const xp = [...x] as V3, xm = [...x] as V3;
    xp[i] += h; xm[i] -= h;
    g.push((V(xp) - V(xm)) / (2 * h));
  }
  return g as V3;
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function randSimplex(): V3 {
  let a = [Math.random(), Math.random(), Math.random()];
  const s = a[0] + a[1] + a[2]; a = a.map(v => v / s);
  return projectToSimplex(a as V3, TAU);
}

// 1 — convexity (midpoint inequality; the floor-simplex is convex so (a+b)/2 is on it)
let cViol = 0; const N1 = 200_000;
for (let i = 0; i < N1; i++) {
  const a = randSimplex(), b = randSimplex();
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  if (V(mid) - (V(a) + V(b)) / 2 > 1e-9) cViol++;
}
console.log(`1. V_z convexity            : ${cViol}/${N1} midpoint violations  → ${cViol === 0 ? 'CONVEX' : 'NOT convex'}`);

// 2 — projected-gradient descent monotonicity
let dViol = 0; const starts = 2000;
for (let s = 0; s < starts; s++) {
  let x = randSimplex(); let prev = V(x);
  for (let step = 0; step < 400; step++) {
    const g = gradV(x); const gbar = (g[0] + g[1] + g[2]) / 3;
    x = projectToSimplex([x[0] - 0.01 * (g[0] - gbar), x[1] - 0.01 * (g[1] - gbar), x[2] - 0.01 * (g[2] - gbar)], TAU);
    const now = V(x); if (now > prev + 1e-7) dViol++; prev = now;
  }
}
console.log(`2. −Π∇V_z descent          : ${dViol} increase-steps / ${starts * 400} steps  → ${dViol === 0 ? 'MONOTONE ↓' : 'NON-monotone'}`);

// 3 — deployed governor descent, incl. multi-pillar-stressed states
let gViol = 0; const N3 = 300_000;
for (let i = 0; i < N3; i++) { const x = randSimplex(); if (dot(gradV(x), calculateGovernorG(x)) > 1e-9) gViol++; }
let mViol = 0; const M3 = 200_000;
for (let i = 0; i < M3; i++) {
  const lo1 = TAU + Math.random() * 0.07, lo2 = TAU + Math.random() * 0.07;
  const x = projectToSimplex([lo1, lo2, 1 - lo1 - lo2] as V3, TAU);
  if (dot(gradV(x), calculateGovernorG(x)) > 1e-9) mViol++;
}
console.log(`3. ⟨∇V_z, G⟩ ≤ 0 (random)   : ${gViol}/${N3} violations`);
console.log(`   ⟨∇V_z, G⟩ ≤ 0 (2-pillar) : ${mViol}/${M3} violations  → ${gViol === 0 && mViol === 0 ? 'GOVERNOR ALWAYS DESCENDS V_z' : 'conditional'}`);
