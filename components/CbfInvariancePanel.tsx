'use client';

/**
 * CbfInvariancePanel — Redesigned for the Research Page.
 * 
 * Focused on empirical certification and the counterfactual proof.
 * High-precision aesthetic, data-dense but readable.
 */

import { useEffect, useState } from 'react';

const G = { 
  gold: '#c9a84c', 
  goldL: '#e8c96d',
  red: '#ef4444',
  slate: '#64748b'
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

function TrajectoryChart({ data, tau }: { data: SimResponse; tau: number }) {
  const W = 800, H = 200, PAD = 30;
  const yMax = 0.5;
  
  const toXY = (steps: SimStep[]) => steps.map((s, i) => {
    const x = PAD + (i / (steps.length - 1)) * (W - 2 * PAD);
    const y = PAD + (1 - Math.min(s.M, yMax) / yMax) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const tauY = PAD + (1 - tau / yMax) * (H - 2 * PAD);

  return (
    <div className="relative w-full bg-slate-950/20 rounded-xl border border-white/5 p-4 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" role="img">
        {/* Y-axis labels */}
        {[0, 0.25, 0.5].map(val => {
          const y = PAD + (1 - val / yMax) * (H - 2 * PAD);
          return (
            <g key={val}>
              <line x1={PAD - 5} y1={y} x2={W - PAD} y2={y} stroke="white" strokeOpacity="0.05" />
              <text x={PAD - 10} y={y + 3} textAnchor="end" className="fill-slate-500 font-mono text-[9px]">{val.toFixed(2)}</text>
            </g>
          );
        })}

        {/* X-axis line */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="white" strokeOpacity="0.2" />
        
        {/* Safety Floor */}
        <line x1={PAD} y1={tauY} x2={W - PAD} y2={tauY} stroke={G.gold} strokeWidth={1} strokeDasharray="4 2" opacity={0.4} />
        <text x={W - PAD + 5} y={tauY + 3} className="fill-[#c9a84c] font-mono text-[9px] font-bold">τ={tau.toFixed(2)}</text>

        {/* Ungoverned Path */}
        <polyline points={toXY(data.ungoverned.trajectory)} fill="none" stroke={G.red} strokeWidth={1.5} opacity={0.6} />
        
        {/* Governed Path */}
        <polyline points={toXY(data.governed.trajectory)} fill="none" stroke={G.gold} strokeWidth={2.5} />
      </svg>
      
      <div className="absolute top-4 right-4 flex flex-col gap-1 text-[9px] font-mono uppercase tracking-widest">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#c9a84c]" />
          <span className="text-slate-300">Governed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 opacity-60" />
          <span className="text-slate-500">Ungoverned</span>
        </div>
      </div>
    </div>
  );
}

export default function CbfInvariancePanel() {
  const [data, setData] = useState<SimResponse | null>(null);
  const [error, setError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    fetch('/api/cbf-simulation')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <div className="rounded-2xl border p-8 bg-slate-900/20 border-white/5 animate-pulse">
        <div className="h-48 flex items-center justify-center">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Initializing Kernel Simulation...</span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="rounded-2xl border p-6 sm:p-10 bg-white/50 dark:bg-slate-900/40 backdrop-blur-xl border-slate-200 dark:border-white/10 shadow-xl transition-all duration-500"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
        <div>
          <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500 mb-2">
            Empirical Counterfactual
          </h2>
          <div className="text-2xl sm:text-3xl font-light text-slate-900 dark:text-white tracking-tight">
            Constitutional <span className="text-[#c9a84c] font-medium italic">Invariance</span> Proof
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">Source Certificate</div>
          <div className="text-[11px] font-mono text-slate-700 dark:text-white bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/10">
            SEED_{data.seed} · T_{data.steps} · DT_0.10
          </div>
        </div>
      </div>

      <div className="mb-8">
        <p className="text-slate-400 text-xs leading-relaxed max-w-2xl">
          Controlled numerical integration comparing identical perturbation sequences. 
          The <span className="text-white font-medium">Governed Arm</span> utilizes the Duchi floor-respecting projection 
          deployed in the LEX kernel, while the <span className="text-red-400 font-medium">Ungoverned Arm</span> represents 
          the raw adversarial dynamics.
        </p>
      </div>

      <TrajectoryChart data={data} tau={data.tau_cbf} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mt-10">
        <div className="space-y-1">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Min Margin (G)</div>
          <div className="text-xl font-mono text-[#c9a84c]">{data.governed.min_M.toFixed(4)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Min Margin (U)</div>
          <div className="text-xl font-mono text-red-400">{data.ungoverned.min_M.toFixed(4)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Safety Status</div>
          <div className={`text-xs font-mono px-2 py-0.5 rounded inline-block border ${data.governed.safety_violated ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
            {data.governed.safety_violated ? 'VIOLATED' : 'SECURE'}
          </div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Improvement</div>
          <div className="text-xl font-mono text-slate-900 dark:text-white">+{((data.governed.min_M / Math.max(0.0001, data.ungoverned.min_M)) * 100).toFixed(0)}%</div>
        </div>
      </div>

      {data.certificate && (
        <div className="mt-10 p-6 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-[#c9a84c]" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-mono text-[#c9a84c] uppercase tracking-widest font-bold">Formal FPL-1 Certificate</span>
            <span className="text-[10px] font-mono text-slate-500 italic">Certified at Continuous Limit</span>
          </div>
          <div className="text-lg font-light text-slate-900 dark:text-white mb-4 italic">
            &ldquo;{data.certificate.fpl1_classification}&rdquo;
          </div>
          <div className="grid sm:grid-cols-3 gap-6 text-[10px] font-mono text-slate-400">
            <div>
              <span className="block text-slate-600 mb-1">STABILITY RATIO</span>
              <span className="text-slate-900 dark:text-white">{data.certificate.stability_ratio.toFixed(3)}</span> <span className="text-slate-600">(≥ 0.60)</span>
            </div>
            <div>
              <span className="block text-slate-600 mb-1">FLOOR INCURSIONS</span>
              <span className={data.certificate.invariance_violations === 0 ? 'text-green-400' : 'text-red-400'}>{data.certificate.invariance_violations}</span> <span className="text-slate-600">(= 0)</span>
            </div>
            <div>
              <span className="block text-slate-600 mb-1">PEAK EXCURSION</span>
              <span className="text-slate-900 dark:text-white">{data.certificate.max_deviation.toFixed(3)}</span> <span className="text-slate-600">(≤ 0.25)</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="text-[10px] font-mono text-slate-600 max-w-md leading-relaxed">
          <b className="text-slate-400">DISCLAIMER:</b> This is a seeded, finite-horizon numerical certificate. It does not constitute a global analytical Lyapunov proof (Open Problem 1).
        </div>
        <button className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-[10px] font-mono text-slate-700 dark:text-white uppercase tracking-widest transition-all hover:border-[#c9a84c]/50 active:scale-95">
          View Raw Telemetry
        </button>
      </div>
    </div>
  );
}
