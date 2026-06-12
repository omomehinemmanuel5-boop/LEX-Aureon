'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SimplexVisualizerProps {
  c?: number;
  r?: number;
  s?: number;
  intervention?: boolean;
  animated?: boolean;
}

const C_VERTEX = { x: 140, y: 20 };
const R_VERTEX = { x: 20, y: 240 };
const S_VERTEX = { x: 260, y: 240 };

const CORNER_TOOLTIPS = {
  C: 'Continuity — Long-horizon coherence',
  R: 'Reciprocity — Environmental grounding',
  S: 'Sovereignty — Independent reasoning',
};

function toSVG(c: number, r: number, s: number) {
  return {
    x: c * C_VERTEX.x + r * R_VERTEX.x + s * S_VERTEX.x,
    y: c * C_VERTEX.y + r * R_VERTEX.y + s * S_VERTEX.y,
  };
}

function innerTrianglePoints(tau: number) {
  return [
    toSVG(tau, tau, 1 - 2 * tau),
    toSVG(tau, 1 - 2 * tau, tau),
    toSVG(1 - 2 * tau, tau, tau),
  ];
}

/* Clamp coordinates inside the simplex */
function clampToSimplex(c: number, r: number, s: number) {
  const total = c + r + s;
  return { c: c / total, r: r / total, s: s / total };
}

export default function SimplexVisualizer({
  c = 0.333,
  r = 0.333,
  s = 0.334,
  intervention = false,
  animated = false,
}: SimplexVisualizerProps) {
  const [hoveredCorner, setHoveredCorner] = useState<'C' | 'R' | 'S' | null>(null);
  const [clickTarget, setClickTarget] = useState<{ c: number; r: number; s: number } | null>(null);
  const [trail, setTrail] = useState<Array<{ x: number; y: number }>>([]);
  const [idleOffset, setIdleOffset] = useState({ c: 0, r: 0, s: 0 });
  const animFrameRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef(Date.now());

  /* Idle oscillation within stable region */
  useEffect(() => {
    const animate = () => {
      const t = (Date.now() - startTimeRef.current) / 1000;
      const amp = 0.025;
      const dc = Math.sin(t * 0.7) * amp;
      const dr = Math.sin(t * 0.5 + 1.2) * amp;
      const ds = -(dc + dr);
      setIdleOffset({ c: dc, r: dr, s: ds });
      animFrameRef.current = requestAnimationFrame(animate);
    };
    if (!clickTarget) {
      animFrameRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [clickTarget]);

  /* Click: move toward corner and spring back */
  const handleCornerClick = useCallback((corner: 'C' | 'R' | 'S') => {
    const targets = {
      C: { c: 0.75, r: 0.125, s: 0.125 },
      R: { c: 0.125, r: 0.75, s: 0.125 },
      S: { c: 0.125, r: 0.125, s: 0.75 },
    };
    setClickTarget(targets[corner]);
    setTimeout(() => setClickTarget(null), 1200);
  }, []);

  /* Compute effective display position */
  const baseC = clickTarget ? clickTarget.c : c + idleOffset.c;
  const baseR = clickTarget ? clickTarget.r : r + idleOffset.r;
  const baseS = clickTarget ? clickTarget.s : s + idleOffset.s;
  const { c: ec, r: er, s: es } = clampToSimplex(Math.max(0.01, baseC), Math.max(0.01, baseR), Math.max(0.01, baseS));
  const pos = toSVG(ec, er, es);

  /* Update trail */
  useEffect(() => {
    setTrail(prev => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.x - pos.x) < 0.5 && Math.abs(last.y - pos.y) < 0.5) return prev;
      return [...prev.slice(-4), { x: pos.x, y: pos.y }];
    });
  }, [pos.x, pos.y]);

  const M = Math.min(ec, er, es);
  const dotColor = M > 0.15 ? '#22c55e' : M > 0.05 ? '#f59e0b' : '#ef4444';
  const isPulsing = intervention || animated || !!clickTarget;

  const floorPts = innerTrianglePoints(0.05);
  const recoveryPts = innerTrianglePoints(0.15);
  const center = toSVG(1 / 3, 1 / 3, 1 / 3);
  const outerPts = `${C_VERTEX.x},${C_VERTEX.y} ${R_VERTEX.x},${R_VERTEX.y} ${S_VERTEX.x},${S_VERTEX.y}`;

  /* Tooltip position helper */
  const tooltipPos = {
    C: { x: C_VERTEX.x, y: C_VERTEX.y - 28, anchor: 'middle' },
    R: { x: R_VERTEX.x - 5, y: R_VERTEX.y + 42, anchor: 'start' },
    S: { x: S_VERTEX.x + 5, y: S_VERTEX.y + 42, anchor: 'end' },
  };

  /* Basin visibility based on position */
  const dominantC = ec > 0.5 ? 1 : ec > 0.35 ? 0.5 : 0.2;
  const dominantR = er > 0.5 ? 1 : er > 0.35 ? 0.5 : 0.2;
  const dominantS = es > 0.5 ? 1 : es > 0.35 ? 0.5 : 0.2;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg viewBox="0 0 280 290" width={280} height={290} style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="svCBasin" cx="50%" cy="10%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="svRBasin" cx="7%" cy="90%">
            <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#c9a84c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="svSBasin" cx="93%" cy="90%">
            <stop offset="0%" stopColor="#9b7fff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#9b7fff" stopOpacity="0" />
          </radialGradient>
          <filter id="svGlow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="svGlowSm">
            <feGaussianBlur stdDeviation="1.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Outer triangle fill */}
        <polygon points={outerPts} className="fill-black/5 dark:fill-[#07070d]/85 stroke-black/10 dark:stroke-slate-700/40" strokeWidth="1.5" />

        {/* Basin fills — fade based on position */}
        <polygon points={outerPts} fill="url(#svCBasin)" opacity={dominantC} style={{ transition: 'opacity 1s' }} />
        <polygon points={outerPts} fill="url(#svRBasin)" opacity={dominantR} style={{ transition: 'opacity 1s' }} />
        <polygon points={outerPts} fill="url(#svSBasin)" opacity={dominantS} style={{ transition: 'opacity 1s' }} />

        {/* τ_recovery boundary */}
        <polygon
          points={recoveryPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="rgba(59,130,246,0.05)"
          stroke="rgba(59,130,246,0.55)"
          strokeWidth="1"
          strokeDasharray="3,2"
        />

        {/* τ_floor boundary */}
        <polygon
          points={floorPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="rgba(239,68,68,0.04)"
          stroke="rgba(201,168,76,0.75)"
          strokeWidth="1"
          strokeDasharray="5,3"
        />

        {/* Center diamond */}
        <polygon
          points={[
            `${center.x},${center.y - 5}`,
            `${center.x + 5},${center.y}`,
            `${center.x},${center.y + 5}`,
            `${center.x - 5},${center.y}`,
          ].join(' ')}
          fill="rgba(255,255,255,0.25)"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="0.5"
        />

        {/* τ labels */}
        <text x={recoveryPts[2].x} y={recoveryPts[2].y - 5} textAnchor="middle" className="fill-blue-600/70 dark:fill-blue-400/55" fontSize="6">
          τ_rec=15%
        </text>
        <text x={floorPts[2].x} y={floorPts[2].y - 5} textAnchor="middle" className="fill-amber-700/70 dark:fill-[#c9a84c]/65" fontSize="6">
          τ_floor=5%
        </text>

        {/* Trail — last 5 positions fading out */}
        {trail.slice(0, -1).map((pt, i) => (
          <circle
            key={`trail-${i}`}
            cx={pt.x}
            cy={pt.y}
            r={2 + i * 0.5}
            fill={dotColor}
            opacity={(i + 1) * 0.07}
          />
        ))}

        {/* Pulse ring */}
        {isPulsing && (
          <circle cx={pos.x} cy={pos.y} r="18" fill={dotColor} opacity="0.15">
            <animate attributeName="r" values="10;22;10" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.2;0;0.2" dur="1.5s" repeatCount="indefinite" />
          </circle>
        )}

        {/* State dot glow */}
        <circle cx={pos.x} cy={pos.y} r="16" fill={dotColor} opacity="0.12" />

        {/* State dot */}
        <circle
          cx={pos.x}
          cy={pos.y}
          r="7"
          fill={dotColor}
          filter="url(#svGlow)"
          opacity="0.95"
          style={{ transition: 'cx 0.8s cubic-bezier(0.4,0,0.2,1), cy 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <circle
          cx={pos.x}
          cy={pos.y}
          r="2.5"
          fill="white"
          opacity="0.9"
          style={{ transition: 'cx 0.8s cubic-bezier(0.4,0,0.2,1), cy 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />

        {/* M score label next to dot */}
        <text x={pos.x} y={pos.y - 11} textAnchor="middle" fill={dotColor} fontSize="8" fontWeight="700">
          M={Math.round(M * 100)}%
        </text>

        {/* Corner vertex dots — with hover hit areas */}
        {/* C corner */}
        <g
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredCorner('C')}
          onMouseLeave={() => setHoveredCorner(null)}
          onClick={() => handleCornerClick('C')}
        >
          <circle cx={C_VERTEX.x} cy={C_VERTEX.y} r="16" fill="transparent" />
          <circle cx={C_VERTEX.x} cy={C_VERTEX.y} r="5" fill="#3b82f6" filter="url(#svGlow)"
            style={{ transform: hoveredCorner === 'C' ? 'scale(1.6)' : 'scale(1)', transformOrigin: `${C_VERTEX.x}px ${C_VERTEX.y}px`, transition: 'transform 0.2s' }} />
          <text x={C_VERTEX.x} y={C_VERTEX.y - 10} textAnchor="middle" className="fill-blue-700 dark:fill-blue-300" fontSize="13" fontWeight="700">C</text>
          <text x={C_VERTEX.x} y={C_VERTEX.y - 1} textAnchor="middle" className="fill-slate-500 dark:fill-slate-500" fontSize="7">Continuity</text>
        </g>

        {/* R corner */}
        <g
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredCorner('R')}
          onMouseLeave={() => setHoveredCorner(null)}
          onClick={() => handleCornerClick('R')}
        >
          <circle cx={R_VERTEX.x} cy={R_VERTEX.y} r="16" fill="transparent" />
          <circle cx={R_VERTEX.x} cy={R_VERTEX.y} r="5" fill="#c9a84c" filter="url(#svGlow)"
            style={{ transform: hoveredCorner === 'R' ? 'scale(1.6)' : 'scale(1)', transformOrigin: `${R_VERTEX.x}px ${R_VERTEX.y}px`, transition: 'transform 0.2s' }} />
          <text x={R_VERTEX.x - 2} y={R_VERTEX.y + 16} textAnchor="middle" className="fill-amber-700 dark:fill-amber-500" fontSize="13" fontWeight="700">R</text>
          <text x={R_VERTEX.x + 18} y={R_VERTEX.y + 27} textAnchor="middle" className="fill-slate-500 dark:fill-slate-500" fontSize="7">Reciprocity</text>
        </g>

        {/* S corner */}
        <g
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredCorner('S')}
          onMouseLeave={() => setHoveredCorner(null)}
          onClick={() => handleCornerClick('S')}
        >
          <circle cx={S_VERTEX.x} cy={S_VERTEX.y} r="16" fill="transparent" />
          <circle cx={S_VERTEX.x} cy={S_VERTEX.y} r="5" fill="#9b7fff" filter="url(#svGlow)"
            style={{ transform: hoveredCorner === 'S' ? 'scale(1.6)' : 'scale(1)', transformOrigin: `${S_VERTEX.x}px ${S_VERTEX.y}px`, transition: 'transform 0.2s' }} />
          <text x={S_VERTEX.x + 2} y={S_VERTEX.y + 16} textAnchor="middle" className="fill-purple-700 dark:fill-purple-300" fontSize="13" fontWeight="700">S</text>
          <text x={S_VERTEX.x - 18} y={S_VERTEX.y + 27} textAnchor="middle" className="fill-slate-500 dark:fill-slate-500" fontSize="7">Sovereignty</text>
        </g>

        {/* Hover tooltips */}
        {hoveredCorner && (() => {
          const tp = tooltipPos[hoveredCorner];
          const text = CORNER_TOOLTIPS[hoveredCorner];
          const textLen = text.length * 4.5;
          const boxW = textLen + 12;
          const boxH = 18;
          const boxX = tp.anchor === 'middle' ? tp.x - boxW / 2
            : tp.anchor === 'start' ? tp.x
            : tp.x - boxW;
          const cornerColors = { C: '#3b82f6', R: '#c9a84c', S: '#9b7fff' };
          const color = cornerColors[hoveredCorner];
          return (
            <g>
              <rect x={boxX} y={tp.y - boxH + 4} width={boxW} height={boxH} rx="4"
                className="fill-white dark:fill-[#0d0d1a] stroke-black/10 dark:stroke-white/10" strokeWidth="0.7" />
              <text x={tp.x} y={tp.y + 1}
                textAnchor={tp.anchor as 'middle' | 'start' | 'end'}
                fill={color} fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                {text}
              </text>
            </g>
          );
        })()}

        {/* M score label below triangle */}
        <text x={140} y={268} textAnchor="middle" className="fill-amber-700 dark:fill-[#c9a84c]" fontSize="10" fontWeight="700" fontFamily="monospace">
          M = {M.toFixed(3)}
        </text>
        <text x={140} y={282} textAnchor="middle" className="fill-slate-400 dark:fill-slate-700" fontSize="7">
          C+R+S=1 · Constitutional Simplex
        </text>
      </svg>
    </div>
  );
}
