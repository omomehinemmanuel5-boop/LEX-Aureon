'use client';

interface HealthBandProps {
  band: string;
  m: number;
  theta?: number;
  attackPressure?: number;
  lyapunovV?: number;
  deltaV?: number;
}

const BAND_CONFIG: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  bar: string;
  description: string;
  range: string;
}> = {
  OPTIMAL:  {
    label: 'OPTIMAL',
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/15',
    border: 'border-emerald-800/40',
    bar: 'bg-emerald-500',
    description: 'Expansive reasoning · Full constitutional capacity · Governor suppressed',
    range: 'M ≥ 0.25',
  },
  ALERT: {
    label: 'ALERT',
    color: 'text-yellow-400',
    bg: 'bg-yellow-900/15',
    border: 'border-yellow-800/40',
    bar: 'bg-yellow-500',
    description: 'Structured reasoning · Above TAU_RECOVERY · Governor in suppress mode',
    range: '0.15 ≤ M < 0.25',
  },
  STRESSED: {
    label: 'STRESSED',
    color: 'text-orange-400',
    bg: 'bg-orange-900/15',
    border: 'border-orange-800/40',
    bar: 'bg-orange-500',
    description: 'Constrained reasoning · Lyapunov penalty active · Governor in nudge/recovery mode',
    range: '0.08 ≤ M < 0.15',
  },
  CRITICAL: {
    label: 'CRITICAL',
    color: 'text-red-400',
    bg: 'bg-red-900/15',
    border: 'border-red-800/50',
    bar: 'bg-red-500',
    description: 'Near constitutional floor · Correction mode imminent (CBF activates at M ≤ 0.05)',
    range: 'M < 0.08',
  },
  SAFE: {
    label: 'SAFE',
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/15',
    border: 'border-emerald-800/40',
    bar: 'bg-emerald-500',
    description: 'Constitutional bounds maintained · M above TAU_FLOOR (0.05)',
    range: 'M ≥ τ (0.05)',
  },
  UNSAFE: {
    label: 'UNSAFE',
    color: 'text-red-400',
    bg: 'bg-red-900/15',
    border: 'border-red-800/50',
    bar: 'bg-red-500',
    description: 'Below constitutional floor · CBF correction active · M ≤ TAU_FLOOR (0.05)',
    range: 'M < τ (0.05)',
  },
};

export default function HealthBand({
  band,
  m,
  theta,
  attackPressure,
  lyapunovV,
  deltaV,
}: HealthBandProps) {
  const cfg = BAND_CONFIG[band] ?? BAND_CONFIG['SAFE'];

  // M bar: normalize to 0-100% where 0.5 = max display
  const barWidth = Math.min(100, (m / 0.5) * 100);

  return (
    <div className={`rounded-xl border p-3 ${cfg.bg} ${cfg.border}`}>

      {/* Top row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.bar} ${band === 'CRITICAL' ? 'animate-pulse' : ''}`}/>
          <span className={`text-xs font-bold font-mono ${cfg.color}`}>{cfg.label}</span>
        </div>
        <span className="text-xs text-slate-500 font-mono">{cfg.range}</span>
      </div>

      {/* M bar */}
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${cfg.bar} transition-all duration-1000`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 mb-2">{cfg.description}</p>

      {/* Kernel metrics */}
      {(theta !== undefined || attackPressure !== undefined || lyapunovV !== undefined) && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
          {theta !== undefined && (
            <span className="text-xs font-mono text-slate-600">θ={theta.toFixed(3)}</span>
          )}
          {attackPressure !== undefined && attackPressure > 0 && (
            <span className="text-xs font-mono text-orange-500">
              pressure={attackPressure.toFixed(3)}
            </span>
          )}
          {lyapunovV !== undefined && (
            <span className="text-xs font-mono text-blue-500">
              V={lyapunovV.toFixed(5)}
            </span>
          )}
          {deltaV !== undefined && (
            <span className={`text-xs font-mono ${deltaV < 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              δV={deltaV > 0 ? '+' : ''}{deltaV.toFixed(5)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
