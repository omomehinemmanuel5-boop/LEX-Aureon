/**
 * scripts/cbf/fpl1-dt-sweep.ts
 *
 * Diagnostic: is the FPL-1 `NOT PROVEN` classification a real failure of the
 * governed dynamics, or a discrete-time integration artifact?
 *
 * The landing-page CBF simulator (lib/cbf_simulation.ts, GET /api/cbf-simulation)
 * runs at dt=1.0, steps=150 and reports fpl1_classification = 'NOT PROVEN'
 * because invariance_violations > 0 and the V_z excursion exceeds 0.25. But
 * FPL-1 is a claim about the CONTINUOUS-TIME governed flow ẋ = −Π_Σ ∇V_z(x);
 * dt=1.0 forward-Euler is a coarse numerical integration of that flow.
 *
 * This sweep holds the simulated horizon T = steps·dt ≈ 150 constant while
 * refining dt, across 10 seeds, and reports the three FPL-1 quantities. If they
 * converge to a pass as dt→0, `NOT PROVEN` at dt=1.0 is a discretization
 * artifact, not a dynamics failure.
 *
 * Run:  npx tsx scripts/cbf/fpl1-dt-sweep.ts
 *
 * This does NOT modify any constitutional math — it only reads the existing
 * simulator across integration steps. See research/empirical-results.md
 * "Run 002" for the interpretation and the (Emmanuel-owned) decision it unlocks.
 */
import { simulateCbf } from '../../lib/cbf_simulation';

const DTS = [1.0, 0.5, 0.25, 0.1, 0.05];
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const HORIZON = 150;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const f3 = (n: number) => n.toFixed(3);

console.log('FPL-1 passes iff: stability_ratio > 0.6 AND invariance_violations == 0 AND excursion < 0.25\n');
console.log('dt      steps  | inv_viol mean/max | excursion mean/max | stab_ratio mean/min | safety_viol | minM min | verdict');
console.log('-'.repeat(120));

for (const dt of DTS) {
  const steps = Math.round(HORIZON / dt);
  const inv: number[] = [], exc: number[] = [], stab: number[] = [], minM: number[] = [];
  let anySafety = false;
  for (const seed of SEEDS) {
    const r = simulateCbf({ dt, steps, seed, cbfEnabled: true });
    inv.push(r.invariance_violations);
    exc.push(r.max_deviation);
    stab.push(r.stability_ratio);
    minM.push(r.min_M);
    if (r.safety_violated) anySafety = true;
  }
  const passAll = Math.max(...inv) === 0 && Math.max(...exc) < 0.25 && Math.min(...stab) > 0.6;
  console.log(
    `${dt.toFixed(2).padEnd(7)} ${String(steps).padEnd(6)} | ` +
    `${f3(mean(inv))} / ${f3(Math.max(...inv))}`.padEnd(17) + ' | ' +
    `${f3(mean(exc))} / ${f3(Math.max(...exc))}`.padEnd(18) + ' | ' +
    `${f3(mean(stab))} / ${f3(Math.min(...stab))}`.padEnd(19) + ' | ' +
    `${String(anySafety).padEnd(11)} | ${f3(Math.min(...minM))}  | ${passAll ? 'PASS (all seeds)' : 'NOT PROVEN'}`,
  );
}
