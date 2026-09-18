import { productionStateTransition, lyapunovDelta, type ProductionState, type ProductionTransitionInput } from '../lib/production_transition';
import { TAU, Z_RECOVERY } from '../lib/aureonics_core';

let seed = 0x9e3779b9;
function next(): number {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0xffffffff;
}
function sampleState(): ProductionState {
  const weights = [next(), next(), next()];
  const total = weights[0] + weights[1] + weights[2];
  const room = 1 - 3 * TAU;
  return {
    C: TAU + room * weights[0] / total,
    R: TAU + room * weights[1] / total,
    S: TAU + room * weights[2] / total,
  };
}
function sampleInput(state: ProductionState): ProductionTransitionInput {
  return {
    state,
    delta: { dc: (next() - 0.5) * 0.04, dr: (next() - 0.5) * 0.04, ds: (next() - 0.5) * 0.04 },
    postResponseDelta: { dc: (next() - 0.5) * 0.02, dr: (next() - 0.5) * 0.02, ds: (next() - 0.5) * 0.02 },
    activeLawDelta: next() > 0.7 ? { dc: (next() - 0.5) * 0.2, dr: (next() - 0.5) * 0.2, ds: (next() - 0.5) * 0.2 } : null,
    semanticAttack: next() > 0.8,
    semanticSeverity: next(),
    advGain: (next() - 0.5) * 0.04,
    effectiveTheta: 1.5,
    threatSignal: next(),
    theta: 1.5,
  };
}
let maxDelta = -Infinity;
let witness: { input: ProductionTransitionInput; delta: number } | null = null;
for (let i = 0; i < 100000; i++) {
  const input = sampleInput(sampleState());
  const result = productionStateTransition(input);
  const delta = lyapunovDelta(input.state, result.state, Z_RECOVERY);
  if (delta > maxDelta) { maxDelta = delta; witness = { input, delta }; }
  if (delta > 1e-9) {
    console.log(JSON.stringify({ kind: 'positive-delta-witness', sample: i, delta, input, result }, null, 2));
    process.exit(0);
  }
}
console.log(JSON.stringify({ kind: 'no-positive-sample', maxDelta, witness }, null, 2));
