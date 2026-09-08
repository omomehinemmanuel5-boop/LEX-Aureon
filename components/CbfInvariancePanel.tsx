'use client';

/**
 * CbfInvariancePanel — Research Page.
 *
 * Shows a controlled counterfactual: identical adversarial perturbation
 * sequence, replayed once with the deployed floor-respecting projection
 * enabled and once without it. The moment the ungoverned arm crosses the
 * safety floor is the whole point of this chart, so it's marked explicitly
 * rather than left for the viewer to notice in a dashed line.
 */

import { useEffect, useState, type ReactNode } from 'react';

const G = {
  gold: '#c9a84c',
  goldL: '#e8c96d',
  red: '#ef4444',
  slate: '#64748b',
};

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

function findBreachIndex(steps: SimStep[], tau: number): number | null {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].M < tau) return i;
  }
  return null;
}

function TrajectoryChart({ data, tau }: { data: SimResponse; tau: number }) {
  const W = 800, H = 220, PAD_L = 40, PAD_R = 20, PAD_T = 20, PAD_B = 30;
  const yMax = 0.5;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xAt = (i: number, n: number) => PAD_L + (i / (n - 1)) * innerW;
  const yAt = (m: number) => PAD_T + (1 - Math.min(m, yMax) / yMax) * innerH;

  const toXY = (steps: SimStep[]) =>
    steps.map((s, i) => `${xAt(i, steps.length).toFixed(1)},${yAt(s.M).toFixed(1)}`).join(' ');

  const tauY = yAt(tau);
  const breachIdx = findBreachIndex(data.ungoverned.trajectory, tau);
  const breach = breachIdx !== null
    ? { x: xAt(breachIdx, data.ungoverned.trajectory.length), y: yAt(data.ungoverned.trajectory[breachIdx].M) }
    : null;

  return (
    <div className="relative w-full rounded-xl border border-white/5 bg-slate-950/30 p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img"
           aria-label="Constitutional margin over time, governed versus ungoverned">
        {[0, 0.25, 0.5].map(val => (
          <g key={val}>
            <line x1={PAD_L} y1={yAt(val)} x2={W - PAD_R} y2={yAt(val)} stroke="white" strokeOpacity="0.05" />
            <text x={PAD_L - 8} y={yAt(val) + 3} textAnchor="end" className="fill-slate-500 text-[9px]">{val.toFixed(2)}</text>
          </g>
        ))}

        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="white" strokeOpacity="0.2" />

        <line x1={PAD_L} y1={tauY} x2={W - PAD_R} y2={tauY} stroke={G.gold} strokeWidth={1} strokeDasharray="4 2" opacity={0.5} />
        <text x={W - PAD_R} y={tauY - 6} textAnchor="end" className="fill-[#c9a84c] text-[9px] font-semibold">safety floor · τ={tau.toFixed(2)}</text>

        <polyline points={toXY(data.ungoverned.trajectory)} fill="none" stroke={G.red} strokeWidth={1.5} opacity={0.55} />
        <polyline points={toXY(data.governed.trajectory)} fill="none" stroke={G.gold} strokeWidth={2.5} />

        {breach && (
          <g>
            <circle cx={breach.x} cy={breach.y} r={9} fill={G.red} opacity={0.15}>
              <animate attributeName="r" values="9;16;9" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.2;0.02;0.2" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx={breach.x} cy={breach.y} r={3} fill={G.red} />
            <text x={breach.x} y={breach.y - 14} textAnchor="middle" className="fill-red-400 text-[9px] font-semibold">
              floor breached — no governance
            </text>
          </g>
        )}
      </svg>

      <div className="mt-3 flex items-center gap-4 border-t border-white/5 pt-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ background: G.gold }} /> Governed
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-2 w-2 rounded-full bg-red-500 opacity-60" /> Ungoverned
        </span>
      </div>
    </div>
  );
}

function Readout({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'good' | 'bad' | 'gold' }) {
  const color = tone === 'good' ? 'text-green-400' : tone === 'bad' ? 'text-red-400' : tone === 'gold' ? 'text-[#c9a84c]' : 'text-slate-900 dark:text-white';
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`font-mono text-lg leading-tight ${color}`}>{value}</div>
    </div>
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

  if (error) return null;
  if (!data) {
    return (
      <div className="animate-pulse rounded-2xl border border-white/5 bg-slate-900/20 p-8">
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">Running kernel simulation…</div>
      </div>
    );
  }

  const improvementX = (data.governed.min_M / Math.max(0.0001, data.ungoverned.min_M));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/50 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/40 sm:p-10">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-2xl font-light tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Governed vs. ungoverned, same attack
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Same seeded adversarial sequence, replayed twice — once through the deployed floor-respecting
            projection, once raw. The ungoverned arm shows what would happen without it.
          </p>
        </div>
        <div className="text-xs text-slate-500 sm:text-right">
          seed {data.seed}, {data.steps} steps
        </div>
      </div>

      <TrajectoryChart data={data} tau={data.tau_cbf} />

      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Readout label="Min margin, governed" value={data.governed.min_M.toFixed(4)} tone="gold" />
        <Readout label="Min margin, ungoverned" value={data.ungoverned.min_M.toFixed(4)} tone="bad" />
        <Readout label="Safety status"
          value={data.governed.safety_violated ? 'Violated' : 'Held'}
          tone={data.governed.safety_violated ? 'bad' : 'good'} />
        <Readout label="Margin retained" value={`${(improvementX * 100).toFixed(0)}%`} />
      </div>

      {data.certificate && (
        <div className="relative mt-8 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-6">
          <div className="absolute left-0 top-0 h-full w-1 bg-[#c9a84c]" />
          <div className="mb-1 text-sm font-medium text-slate-900 dark:text-white">
            FPL-1 certificate: <span className="italic text-[#c9a84c]">&ldquo;{data.certificate.fpl1_classification}&rdquo;</span>
          </div>
          <div className="mb-4 text-xs text-slate-500">Certified at the continuous-flow limit, this seed and horizon only.</div>
          <div className="grid gap-4 text-[13px] sm:grid-cols-3">
            <div>
              <span className="text-slate-500">Stability ratio </span>
              <span className="font-mono text-slate-900 dark:text-white">{data.certificate.stability_ratio.toFixed(3)}</span>
              <span className="text-slate-600"> (≥ 0.60)</span>
            </div>
            <div>
              <span className="text-slate-500">Floor incursions </span>
              <span className={`font-mono ${data.certificate.invariance_violations === 0 ? 'text-green-400' : 'text-red-400'}`}>{data.certificate.invariance_violations}</span>
              <span className="text-slate-600"> (= 0)</span>
            </div>
            <div>
              <span className="text-slate-500">Peak excursion </span>
              <span className="font-mono text-slate-900 dark:text-white">{data.certificate.max_deviation.toFixed(3)}</span>
              <span className="text-slate-600"> (≤ 0.25)</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 border-t border-white/5 pt-6 text-xs leading-relaxed text-slate-500">
        This is a seeded, finite-horizon numerical certificate — it isn&rsquo;t the open analytical
        multi-pillar Lyapunov proof (Open Problem 1). It also simulates the idealized continuous-time
        model (correction and drift applied together each step), not the deployed system&rsquo;s actual
        discrete, one-turn-delayed correction — production behavior doesn&rsquo;t yet match this
        continuous-flow simulation on every turn.
      </div>
    </div>
  );
}
