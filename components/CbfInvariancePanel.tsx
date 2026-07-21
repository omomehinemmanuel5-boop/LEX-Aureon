'use client';

/**
 * CbfInvariancePanel — the one thing real production data can't show.
 *
 * app/page.tsx's TechnicalFoundationSection already covers the Lyapunov
 * proof, the "Proven vs Engineered" gap, and REAL production ΔV_z measurement
 * (~47,000 logged turns). This panel does not repeat that. It answers a
 * different question, deliberately: production only ever runs WITH the CBF
 * barrier active — there is no ethical or practical way to show a real user
 * what happens WITHOUT it. A controlled simulation, run twice from the
 * identical seed (once governed, once not), is the only way to honestly show
 * that counterfactual. Backed by GET /api/cbf-simulation, which wraps
 * lib/cbf_simulation.ts's simulateCbfComparison() — see that route's header
 * for why this is safe to treat as a stable, citable artifact.
 *
 * HONESTY CONSTRAINT (2026-07-18, updated 2026-07-21) — read before changing
 * the copy below. The governed run's min_M never drops below τ_cbf and the
 * ungoverned run's collapses to 0 (safety_violated=true) — that observable
 * difference is the defensible headline.
 *
 * The stricter `fpl1_classification` read 'NOT PROVEN' until 2026-07-21, and
 * two honest fixes resolved it to 'LYAPUNOV STABLE + FORWARD INVARIANT' for
 * the governed arm — NOT by weakening the test:
 *   (B) The governed arm now projects with the floor-respecting Duchi
 *       projection the DEPLOYED governor actually uses, instead of the naive
 *       x/Σx the simulator had drifted to — so forward invariance of the
 *       floor holds by construction (invariance_violations → 0), and the
 *       simulator is now faithful to production.
 *   (A) The classification is certified at a fine integration step (dt=0.1,
 *       the continuous-flow limit FPL-1 is actually a claim about) rather
 *       than the coarse dt=1.0 whose one-step Euler error inflated the V_z
 *       excursion. The full dt sweep proving this is a discretization
 *       artifact is in research/empirical-results.md "Run 002".
 * See /api/cbf-simulation for the certificate provenance (dt, seed, horizon,
 * and the three underlying quantities).
 *
 * STILL DO NOT overclaim: this is a seeded, finite-horizon NUMERICAL
 * certificate of the governed flow — it is NOT the analytical multi-pillar
 * global Lyapunov proof (Open Problem 1 remains open). The copy below states
 * exactly that — same discipline as the ΔV_z card next to it.
 */

import { useEffect, useState } from 'react';

const G = { gold: '#c9a84c', goldL: '#e8c96d' };

interface SimStep { t: number; M: number; }
interface SimArm {
  trajectory: SimStep[];
  min_M: number;
  safety_violated: boolean;
  fpl1_classification: string;
}
interface Certificate {
  dt: number;
  steps: number;
  horizon: number;
  stability_ratio: number;
  max_deviation: number;
  invariance_violations: number;
  min_M: number;
  fpl1_classification: string;
  note: string;
}
interface SimResponse {
  governed: SimArm;
  ungoverned: SimArm;
  certificate?: Certificate;
  tau_cbf: number;
  safety_guarantee_holds: boolean;
  improvement_min_M: number;
  seed: number;
  steps: number;
}

// Simple hand-rolled SVG polyline chart — matches this codebase's existing
// pattern (components/BenchmarkResults.tsx's <Bar>) of small custom
// visualizations over a charting library dependency.
function TrajectoryChart({ data, tau }: { data: SimResponse; tau: number }) {
  const W = 600, H = 180, PAD = 8;
  const yMax = 0.5; // fixed scale: both arms' M values live well under this, and a
                     // fixed (not auto-fit) scale is what makes the floor line and
                     // the collapse-to-zero visually legible and comparable.
  const toXY = (steps: SimStep[]) => steps.map((s, i) => {
    const x = PAD + (i / (steps.length - 1)) * (W - 2 * PAD);
    const y = PAD + (1 - Math.min(s.M, yMax) / yMax) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const tauY = PAD + (1 - tau / yMax) * (H - 2 * PAD);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label="Simulated constitutional stability margin over time, governed vs ungoverned">
      {/* floor line */}
      <line x1={PAD} y1={tauY} x2={W - PAD} y2={tauY}
        stroke="#64748b" strokeWidth={1} strokeDasharray="4 3" />
      <text x={W - PAD} y={tauY - 4} textAnchor="end"
        className="fill-slate-500" style={{ fontSize: 9, fontFamily: 'monospace' }}>
        τ = {tau.toFixed(2)}
      </text>
      {/* ungoverned — drawn first, underneath */}
      <polyline points={toXY(data.ungoverned.trajectory)} fill="none"
        stroke="#ef4444" strokeWidth={1.5} opacity={0.85} />
      {/* governed */}
      <polyline points={toXY(data.governed.trajectory)} fill="none"
        stroke={G.gold} strokeWidth={2} />
    </svg>
  );
}

export default function CbfInvariancePanel() {
  const [data, setData] = useState<SimResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/cbf-simulation')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null; // fails quiet — this is a supplementary panel, never blocks the page
  if (!data) {
    return (
      <div className="rounded-2xl border p-6 sm:p-8 bg-white dark:bg-black/30 border-slate-200 dark:border-white/10">
        <div className="h-40 flex items-center justify-center">
          <span className="text-xs font-mono text-slate-500">Loading simulation…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-6 sm:p-8 bg-white dark:bg-black/30 border-slate-200 dark:border-white/10 mt-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <span className="text-xs uppercase tracking-widest font-bold text-slate-600 dark:text-slate-500 font-mono">
          The counterfactual
        </span>
        <span className="text-[10px] font-mono text-slate-600 dark:text-slate-600">
          seed={data.seed}, {data.steps} steps · simulated, not live traffic
        </span>
      </div>
      <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed mb-4">
        Production only ever runs with the barrier active — there&rsquo;s no way to ethically show a real user
        what happens without it. This is a controlled simulation instead: the identical perturbation sequence,
        run twice from the same seed, once with the CBF barrier engaged and once without.
      </p>

      <TrajectoryChart data={data} tau={data.tau_cbf} />

      <div className="flex items-center gap-4 mt-3 mb-4 text-[10px] font-mono">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block" style={{ background: G.gold }} />
          <span className="text-slate-500">governed · min M = {data.governed.min_M.toFixed(3)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block bg-red-500" />
          <span className="text-slate-500">ungoverned · min M = {data.ungoverned.min_M.toFixed(3)}</span>
        </span>
      </div>

      <div className="h-px bg-slate-200 dark:bg-white/10 my-4" />

      <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
        <b className="text-slate-800 dark:text-white">What this does show:</b> the governed run&rsquo;s
        stability margin never drops below the τ = {data.tau_cbf.toFixed(2)} floor
        ({data.governed.safety_violated ? 'violated' : 'held'}); the ungoverned run&rsquo;s does
        ({data.ungoverned.safety_violated ? 'violated' : 'held'} — collapsing to M = {data.ungoverned.min_M.toFixed(3)}).
      </p>

      {data.certificate && (
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed mt-3">
          <b className="text-slate-800 dark:text-white">Formal classification:</b> the governed flow is
          certified <span className="font-mono" style={{ color: G.gold }}>&ldquo;{data.certificate.fpl1_classification}&rdquo;</span> —
          Lyapunov descent ratio {data.certificate.stability_ratio.toFixed(2)} (need &gt; 0.6),
          {' '}{data.certificate.invariance_violations} floor incursions (need 0),
          peak V<sub>z</sub> excursion {data.certificate.max_deviation.toFixed(3)} (need &lt; 0.25),
          certified at the continuous-flow limit (dt = {data.certificate.dt}, horizon {data.certificate.horizon}).
          The chart above is drawn at a coarser step ({data.steps} points) for legibility.
        </p>
      )}

      <p className="text-slate-500 dark:text-slate-500 text-[11px] leading-relaxed mt-3">
        <b className="text-slate-700 dark:text-slate-300">What this is not:</b> a seeded, finite-horizon
        <i> numerical</i> certificate of the governed dynamics — not the analytical multi-pillar
        global Lyapunov proof, which remains an open problem. The floor-holding result and the
        classification are both real and reproducible; neither is claimed as the closed-form theorem.
      </p>
    </div>
  );
}
