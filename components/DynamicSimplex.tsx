'use client';

import { useEffect, useRef, useState } from 'react';

interface SimplexState {
  C: number; R: number; S: number;
  label?: string;
  color?: string;
  pulse?: boolean;
}

interface DynamicSimplexProps {
  // Live mode — pass response metrics
  liveC?: number;
  liveR?: number;
  liveS?: number;
  liveM?: number;
  intervention?: boolean;
  healthBand?: string;
  animating?: boolean;
  // Demo mode — autonomous animation
  demoMode?: boolean;
}

// Demo scenarios that play out automatically
const DEMO_SCENARIOS: {
  label: string;
  steps: SimplexState[];
  pause: number;
}[] = [
  {
    label: 'Clean Pass',
    pause: 3000,
    steps: [
      { C: 0.38, R: 0.35, S: 0.27, label: 'Generator fires', color: '#94a3b8' },
      { C: 0.40, R: 0.33, S: 0.27, label: 'CRS computed', color: '#60a5fa' },
      { C: 0.40, R: 0.33, S: 0.27, label: 'M = 0.27 ✓ SAFE', color: '#34d399' },
    ],
  },
  {
    label: 'Identity Attack',
    pause: 4000,
    steps: [
      { C: 0.33, R: 0.33, S: 0.34, label: 'Initial state', color: '#94a3b8' },
      { C: 0.06, R: 0.22, S: 0.72, label: 'Attack detected!', color: '#ef4444', pulse: true },
      { C: 0.06, R: 0.22, S: 0.72, label: 'M = 0.06 < τ', color: '#ef4444', pulse: true },
      { C: 0.26, R: 0.31, S: 0.43, label: 'CBF projection', color: '#f59e0b' },
      { C: 0.30, R: 0.33, S: 0.37, label: 'Restored ✓', color: '#34d399' },
    ],
  },
  {
    label: 'Reciprocity Drift',
    pause: 3500,
    steps: [
      { C: 0.38, R: 0.34, S: 0.28, label: 'Initial state', color: '#94a3b8' },
      { C: 0.36, R: 0.19, S: 0.45, label: 'R drifting low', color: '#fbbf24', pulse: true },
      { C: 0.35, R: 0.09, S: 0.56, label: 'dR/dt < -ε!', color: '#ef4444', pulse: true },
      { C: 0.33, R: 0.31, S: 0.36, label: 'Governor rebalanced', color: '#34d399' },
    ],
  },
  {
    label: 'Optimal State',
    pause: 2500,
    steps: [
      { C: 0.34, R: 0.33, S: 0.33, label: 'Balanced', color: '#34d399' },
      { C: 0.35, R: 0.34, S: 0.31, label: 'OPTIMAL', color: '#34d399' },
      { C: 0.36, R: 0.33, S: 0.31, label: 'M = 0.31 ✓', color: '#34d399' },
    ],
  },
];

export default function DynamicSimplex({
  liveC, liveR, liveS, liveM,
  intervention = false,
  healthBand = 'OPTIMAL',
  animating = false,
  demoMode = false,
}: DynamicSimplexProps) {
  const W = 300, H = 240;
  const top   = { x: W/2, y: 16 };
  const left  = { x: 16,  y: H - 16 };
  const right  = { x: W-16, y: H - 16 };

  // Current displayed state
  const [displayState, setDisplayState] = useState<SimplexState>({ C: 0.333, R: 0.333, S: 0.334 });
  const [stepLabel, setStepLabel] = useState('');
  const [dotColor, setDotColor] = useState('#f59e0b');
  const [isPulsing, setIsPulsing] = useState(false);
  const [trajectory, setTrajectory] = useState<{ x: number; y: number }[]>([]);
  const [scenarioLabel, setScenarioLabel] = useState('');

  const scenarioIdx = useRef(0);
  const stepIdx = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Convert CRS to SVG coordinates
  function toSVG(c: number, r: number, s: number) {
    return {
      x: top.x * c + left.x * r + right.x * s,
      y: top.y * c + left.y * r + right.y * s,
    };
  }

  // Live mode — animate to new state when props change
  useEffect(() => {
    if (!demoMode && liveC !== undefined && liveR !== undefined && liveS !== undefined) {
      const newState = { C: liveC, R: liveR, S: liveS };
      setTrajectory(prev => {
        const pt = toSVG(displayState.C, displayState.R, displayState.S);
        return [...prev.slice(-8), pt];
      });
      setDisplayState(newState);
      setDotColor(intervention ? '#ef4444' : liveM && liveM >= 0.15 ? '#34d399' : '#f59e0b');
      setIsPulsing(animating || intervention);
      setStepLabel(intervention ? 'Governor intervened' : `M = ${((liveM ?? 0)*100).toFixed(0)}% — ${healthBand}`);
      setTimeout(() => setIsPulsing(false), 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveC, liveR, liveS, liveM, intervention, animating, demoMode]);

  // Demo mode — cycle through scenarios automatically
  useEffect(() => {
    if (!demoMode) return;

    const runStep = () => {
      const scenario = DEMO_SCENARIOS[scenarioIdx.current];
      const step = scenario.steps[stepIdx.current];

      setTrajectory(prev => {
        const pt = toSVG(displayState.C, displayState.R, displayState.S);
        return [...prev.slice(-10), pt];
      });

      setDisplayState({ C: step.C, R: step.R, S: step.S });
      setDotColor(step.color ?? '#f59e0b');
      setIsPulsing(step.pulse ?? false);
      setStepLabel(step.label ?? '');
      setScenarioLabel(scenario.label);

      stepIdx.current++;

      if (stepIdx.current >= scenario.steps.length) {
        // Move to next scenario after pause
        stepIdx.current = 0;
        timerRef.current = setTimeout(() => {
          scenarioIdx.current = (scenarioIdx.current + 1) % DEMO_SCENARIOS.length;
          setTrajectory([]);
          runStep();
        }, scenario.pause);
      } else {
        timerRef.current = setTimeout(runStep, 900);
      }
    };

    timerRef.current = setTimeout(runStep, 800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const pos = toSVG(displayState.C, displayState.R, displayState.S);
  const M = Math.min(displayState.C, displayState.R, displayState.S);
  const isSafe = M >= 0.05; // TAU_FLOOR = 0.05 — CBF floor, correction mode threshold
  const tau = 0.05;         // TAU_FLOOR — must match lib/kv.ts
  const off = tau * 95;

  return (
    <div className="relative">
      {/* Scenario label */}
      {demoMode && scenarioLabel && (
        <div className="absolute top-0 right-0 text-xs font-mono text-slate-500 px-2 py-1">
          {scenarioLabel}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
        <defs>
          <radialGradient id="dsBg" cx="50%" cy="55%">
            <stop offset="0%" stopColor="#0f2744" stopOpacity="0.8"/>
            <stop offset="100%" stopColor="#020617" stopOpacity="0.2"/>
          </radialGradient>
          <radialGradient id="dsDot" cx="50%" cy="50%">
            <stop offset="0%" stopColor={dotColor} stopOpacity="0.8"/>
            <stop offset="100%" stopColor={dotColor} stopOpacity="0"/>
          </radialGradient>
          <filter id="dsGlow">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Background */}
        <polygon points={`${top.x},${top.y} ${left.x},${left.y} ${right.x},${right.y}`}
          fill="url(#dsBg)" stroke="rgba(100,116,139,0.3)" strokeWidth="1.5"/>

        {/* Tau zone */}
        <polygon
          points={`${top.x},${top.y+off*1.2} ${left.x+off},${left.y-off*0.5} ${right.x-off},${right.y-off*0.5}`}
          fill="rgba(59,130,246,0.05)"
          stroke="rgba(59,130,246,0.3)" strokeWidth="1" strokeDasharray="4,3"/>

        {/* Grid lines */}
        {[[top,left],[top,right],[left,right]].map(([a,b],i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgba(51,65,85,0.25)" strokeWidth="0.5"/>
        ))}

        {/* Trajectory path */}
        {trajectory.length > 1 && (
          <polyline
            points={trajectory.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={dotColor}
            strokeWidth="1"
            strokeDasharray="3,2"
            opacity="0.4"
          />
        )}

        {/* Trajectory dots */}
        {trajectory.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r="2"
            fill={dotColor}
            opacity={(i + 1) / trajectory.length * 0.3}/>
        ))}

        {/* Vertex dots */}
        <circle cx={top.x} cy={top.y} r="6" fill="#3b82f6" filter="url(#dsGlow)"/>
        <circle cx={left.x} cy={left.y} r="6" fill="#10b981" filter="url(#dsGlow)"/>
        <circle cx={right.x} cy={right.y} r="6" fill="#f59e0b" filter="url(#dsGlow)"/>

        {/* State glow */}
        <circle cx={pos.x} cy={pos.y} r="24" fill="url(#dsDot)" opacity="0.5"
          className={isPulsing ? 'animate-ping' : ''}/>

        {/* State dot */}
        <circle
          cx={pos.x} cy={pos.y}
          r={intervention || isPulsing ? 11 : 9}
          fill={dotColor}
          filter="url(#dsGlow)"
          opacity="0.95"
          style={{ transition: 'cx 0.8s cubic-bezier(0.4,0,0.2,1), cy 0.8s cubic-bezier(0.4,0,0.2,1), r 0.3s' }}
        />
        <circle cx={pos.x} cy={pos.y} r="4" fill="white" opacity="0.95"
          style={{ transition: 'cx 0.8s cubic-bezier(0.4,0,0.2,1), cy 0.8s cubic-bezier(0.4,0,0.2,1)' }}/>

        {/* Labels */}
        <text x={top.x} y={top.y-9} textAnchor="middle" fill="#93c5fd" fontSize="13" fontWeight="700">C</text>
        <text x={top.x} y={top.y+1} textAnchor="middle" fill="#475569" fontSize="7">Continuity</text>
        <text x={left.x} y={left.y+15} textAnchor="middle" fill="#6ee7b7" fontSize="13" fontWeight="700">R</text>
        <text x={left.x+28} y={left.y+15} textAnchor="middle" fill="#475569" fontSize="7">Reciprocity</text>
        <text x={right.x} y={right.y+15} textAnchor="middle" fill="#fcd34d" fontSize="13" fontWeight="700">S</text>
        <text x={right.x-28} y={right.y+15} textAnchor="middle" fill="#475569" fontSize="7">Sovereignty</text>

        {/* M score */}
        <text x={pos.x} y={pos.y - 14} textAnchor="middle"
          fill={dotColor} fontSize="9" fontWeight="700">
          M={( M * 100).toFixed(0)}%
        </text>

        {/* Tau label */}
        <text x={top.x} y={top.y + off * 1.2 - 4} textAnchor="middle"
          fill="rgba(59,130,246,0.45)" fontSize="7">τ=8%</text>

        {/* Bottom */}
        <text x={W/2} y={H-3} textAnchor="middle" fill="#1e293b" fontSize="7">
          C+R+S=1 · Constitutional Simplex
        </text>
      </svg>

      {/* Step label */}
      {stepLabel && (
        <div className="text-center mt-1">
          <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
            isSafe
              ? 'text-emerald-400 bg-emerald-900/20'
              : 'text-red-400 bg-red-900/20'
          }`}>
            {stepLabel}
          </span>
        </div>
      )}
    </div>
  );
}
