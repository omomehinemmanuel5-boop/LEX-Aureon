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
 * HONESTY CONSTRAINT (2026-07-18) — read before changing the copy below:
 * verified the real output before writing any claim here. The governed run's
 * min_M (0.05) never drops below τ_cbf (0.05) and the ungoverned run's does
 * (collapses to 0.000, a real safety_violated=true outcome) — that
 * observable difference is the true, defensible headline. Do NOT headline
 * `fpl1_classification` as "proven" — on this run it reads 'NOT PROVEN' for
 * BOTH arms, including governed, because invariance_violations counts a
 * stricter, separate condition (whether the raw pre-projection dynamics ever
 * touched below-floor on any single coordinate, not just whether the final
 * min-pillar value M did) — it can be nonzero even when the actual observed
 * trajectory never violates safety. That's real nuance, not a bug to hide;
 * see lib/cbf_simulation.ts's own invarianceViolations computation. The copy
 * below states the true, narrower claim (floor-holding) and is explicit that
 * the broader formal classification is open — same discipline as the
 * ΔV_z card next to it.
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
interface SimResponse {
  governed: SimArm;
  ungoverned: SimArm;
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
        {' '}<b className="text-slate-800 dark:text-white">What this doesn&rsquo;t show:</b> this simulator
        also runs a stricter, separate formal test (Lyapunov descent ratio, zero raw-dynamics floor incursions,
        bounded peak deviation) — on this run that stricter test reads <span className="font-mono">&ldquo;{data.governed.fpl1_classification}&rdquo;</span> for
        the governed arm too. The floor-holding result above is real and measured; the fuller formal
        classification is an open item, not asserted here as settled.
      </p>
    </div>
  );
}
