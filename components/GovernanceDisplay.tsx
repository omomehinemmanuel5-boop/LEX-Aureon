'use client';

import { useState, useEffect } from 'react';
import { GovernanceResponse } from '@/types/governance-types';

interface GovernanceDisplayProps {
  response: GovernanceResponse;
}

function TypewriterText({ text, speed = 12 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
      } else {
        setDone(true);
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <span>
      {displayed}
      {!done && <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />}
    </span>
  );
}

function MetricBar({ label, value, color, description }: { label: string; value: number; color: string; description: string }) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(value), 100);
    return () => clearTimeout(timer);
  }, [value]);

  const colorMap: Record<string, { bar: string; text: string; bg: string; border: string }> = {
    blue: { bar: 'bg-blue-500', text: 'text-blue-400', bg: 'bg-blue-900/20', border: 'border-blue-800/50' },
    green: { bar: 'bg-green-500', text: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-800/50' },
    purple: { bar: 'bg-purple-500', text: 'text-purple-400', bg: 'bg-purple-900/20', border: 'border-purple-800/50' },
    red: { bar: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-700' },
    cyan: { bar: 'bg-cyan-500', text: 'text-cyan-400', bg: 'bg-cyan-900/20', border: 'border-cyan-800/50' },
  };

  const c = colorMap[color] ?? colorMap.blue;

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className={`text-base font-bold ${c.text}`}>{(value * 100).toFixed(1)}%</div>
          <div className="text-xs font-semibold text-slate-300">{label}</div>
        </div>
        <div className="text-xs text-slate-500 text-right max-w-[100px] leading-tight">{description}</div>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${c.bar} rounded-full transition-all duration-1000 ease-out`}
          style={{ width: `${animated * 100}%` }}
        />
      </div>
    </div>
  );
}

function DiffHighlight({ raw, governed }: { raw: string; governed: string }) {
  if (raw === governed) return null;

  const rawWords = raw.split(/\s+/);
  const govWords = governed.split(/\s+/);
  const removedSet = new Set(rawWords.filter(w => !govWords.includes(w)));
  const addedSet = new Set(govWords.filter(w => !rawWords.includes(w)));

  return (
    <div className="mt-3 p-3 bg-slate-900/80 rounded-lg border border-slate-700">
      <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Diff Analysis</div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from(removedSet).slice(0, 6).map((w, i) => (
          <span key={`r-${i}`} className="text-xs px-2 py-0.5 bg-red-900/40 border border-red-800 text-red-300 rounded-full line-through">{w}</span>
        ))}
        {Array.from(addedSet).slice(0, 6).map((w, i) => (
          <span key={`a-${i}`} className="text-xs px-2 py-0.5 bg-emerald-900/40 border border-emerald-800 text-emerald-300 rounded-full">+{w}</span>
        ))}
      </div>
    </div>
  );
}

export default function GovernanceDisplay({ response }: GovernanceDisplayProps) {
  const [phase, setPhase] = useState<'raw' | 'analyzing' | 'governed'>('raw');
  const [showFull, setShowFull] = useState(false);

  const { metrics, intervention, raw_output, governed_output, audit_id, timestamp } = response;
  const isModified = raw_output !== governed_output;
  const isSafe = metrics.m >= 0.15;

  useEffect(() => {
    setPhase('raw');
    setShowFull(false);
    const t1 = setTimeout(() => setPhase('analyzing'), 800);
    const t2 = setTimeout(() => setPhase('governed'), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [response]);

  return (
    <div className="space-y-4">

      {/* ── Governor Status Banner ─────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${isSafe
        ? 'bg-emerald-900/15 border-emerald-800/50'
        : 'bg-red-900/15 border-red-800/50'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isSafe ? 'bg-emerald-900/40' : 'bg-red-900/40'}`}>
            <span className="text-xl">{isSafe ? '✓' : '⚠'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-bold ${isSafe ? 'text-emerald-400' : 'text-red-400'}`}>
              {isSafe ? 'Constitutional Bounds Maintained' : 'Governor Intervention Applied'}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">
              {intervention?.reason ?? 'Stability margin within threshold'}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-2xl font-black ${isSafe ? 'text-emerald-400' : 'text-red-400'}`}>
              {(metrics.m * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">M score</div>
          </div>
        </div>
      </div>

      {/* ── Live Execution Flow ────────────────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        {/* Pipeline Steps */}
        <div className="flex border-b border-slate-800">
          {[
            { id: 'raw', label: '① Raw Output', active: phase === 'raw' },
            { id: 'analyzing', label: '② Analyzing', active: phase === 'analyzing' },
            { id: 'governed', label: '③ Governed', active: phase === 'governed' },
          ].map(step => (
            <div key={step.id} className={`flex-1 py-2 px-3 text-center text-xs font-medium transition-colors ${step.active ? 'bg-blue-900/30 text-blue-300 border-b-2 border-blue-500' : 'text-slate-500'}`}>
              {step.label}
            </div>
          ))}
        </div>

        <div className="p-4">
          {phase === 'raw' && (
            <div>
              <div className="text-xs text-slate-500 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400 inline-block"></span>
                Raw LLM output — unfiltered
              </div>
              <div className="bg-slate-950/60 rounded-lg p-3 max-h-40 overflow-y-auto">
                <p className="text-sm text-slate-300 leading-relaxed font-mono">
                  <TypewriterText text={raw_output.slice(0, 300) + (raw_output.length > 300 ? '...' : '')} speed={8} />
                </p>
              </div>
            </div>
          )}

          {phase === 'analyzing' && (
            <div className="py-4">
              <div className="text-xs text-slate-500 mb-4 text-center">Running constitutional analysis...</div>
              <div className="space-y-3">
                {[
                  { label: 'Extracting CRS state vector...', done: true },
                  { label: 'Computing stability margin M = min(C,R,S)...', done: true },
                  { label: 'Evaluating collapse condition M < τ...', done: metrics.m < 0.15 },
                  { label: 'Checking velocity derivatives...', done: false },
                  { label: 'Applying constitutional governor...', done: isModified },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${step.done ? 'bg-blue-600' : 'bg-slate-700'}`}>
                      {step.done ? '✓' : '·'}
                    </div>
                    <div className="text-xs text-slate-400 font-mono">{step.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {phase === 'governed' && (
            <div>
              <div className="text-xs mb-2 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full inline-block ${isModified ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                <span className={isModified ? 'text-amber-400' : 'text-emerald-400'}>
                  {isModified ? 'Governor modified output' : 'Output passed constitutional review'}
                </span>
              </div>
              <div className={`rounded-lg p-3 max-h-48 overflow-y-auto ${isModified ? 'bg-amber-900/10 border border-amber-900/30' : 'bg-emerald-900/10 border border-emerald-900/30'}`}>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {showFull ? governed_output : governed_output.slice(0, 400)}
                  {governed_output.length > 400 && !showFull && (
                    <button onClick={() => setShowFull(true)} className="ml-1 text-blue-400 underline text-xs">show more</button>
                  )}
                </p>
              </div>
              {isModified && <DiffHighlight raw={raw_output} governed={governed_output} />}
            </div>
          )}
        </div>
      </div>

      {/* ── CRS Metrics ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricBar label="Continuity" value={metrics.c} color="blue" description="Identity coherence" />
        <MetricBar label="Reciprocity" value={metrics.r} color="green" description="Exchange balance" />
        <MetricBar label="Sovereignty" value={metrics.s} color="purple" description="Autonomous authority" />
        <MetricBar
          label="Stability M"
          value={metrics.m}
          color={metrics.m < 0.15 ? 'red' : 'cyan'}
          description={metrics.m < 0.15 ? 'Below threshold τ' : 'Within safe bounds'}
        />
      </div>

      {/* ── Simplex Position ──────────────────────────────────── */}
      <SimplexCard c={metrics.c} r={metrics.r} s={metrics.s} m={metrics.m} />

      {/* ── Research Attribution ──────────────────────────────── */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3 uppercase tracking-wider font-semibold">Research Foundation</div>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-slate-600 text-xs mt-0.5">📄</span>
            <div>
              <div className="text-xs text-slate-400">Aureonics: Constitutional AI Governance Framework</div>
              <a href="https://doi.org/10.5281/zenodo.18944242" target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-mono">
                doi.org/10.5281/zenodo.18944242
              </a>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-slate-600 text-xs mt-0.5">🔬</span>
            <div>
              <div className="text-xs text-slate-400">Emmanuel King · Principal Researcher</div>
              <a href="https://orcid.org/0009-0000-2986-4935" target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-mono">
                orcid.org/0009-0000-2986-4935
              </a>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-slate-600 text-xs mt-0.5">✉️</span>
            <a href="mailto:lexaureon@gmail.com"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              lexaureon@gmail.com
            </a>
          </div>
        </div>
        {audit_id && (
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-600 font-mono">{audit_id}</span>
            <span className="text-xs text-slate-600">{timestamp ? new Date(timestamp).toLocaleTimeString() : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SimplexCard({ c, r, s, m }: { c: number; r: number; s: number; m: number }) {
  const W = 260, H = 220;
  const top = { x: W/2, y: 18 };
  const left = { x: 18, y: H - 18 };
  const right = { x: W - 18, y: H - 18 };
  const px = top.x * c + left.x * r + right.x * s;
  const py = top.y * c + left.y * r + right.y * s;
  const tau = 0.15;
  const off = tau * 70;
  const iSafe = m >= tau;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Constitutional State Space</h3>
        <span className="text-xs text-slate-500">C + R + S = 1</span>
      </div>
      <div className="flex justify-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[260px]">
          <defs>
            <radialGradient id="sg" cx="50%" cy="50%">
              <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.1" />
            </radialGradient>
          </defs>
          <polygon points={`${top.x},${top.y} ${left.x},${left.y} ${right.x},${right.y}`} fill="url(#sg)" stroke="rgba(100,116,139,0.5)" strokeWidth="1.5" />
          <polygon points={`${top.x},${top.y+off} ${left.x+off},${left.y-off*0.4} ${right.x-off},${right.y-off*0.4}`} fill="rgba(59,130,246,0.05)" stroke="rgba(59,130,246,0.35)" strokeWidth="1" strokeDasharray="4,3" />
          <line x1={top.x} y1={top.y} x2={(left.x+right.x)/2} y2={left.y} stroke="rgba(71,85,105,0.25)" strokeWidth="0.5" />
          <line x1={left.x} y1={left.y} x2={(top.x+right.x)/2} y2={(top.y+right.y)/2} stroke="rgba(71,85,105,0.25)" strokeWidth="0.5" />
          <line x1={right.x} y1={right.y} x2={(top.x+left.x)/2} y2={(top.y+left.y)/2} stroke="rgba(71,85,105,0.25)" strokeWidth="0.5" />
          <circle cx={top.x} cy={top.y} r="5" fill="#3b82f6" />
          <circle cx={left.x} cy={left.y} r="5" fill="#22c55e" />
          <circle cx={right.x} cy={right.y} r="5" fill="#a855f7" />
          {!iSafe && <circle cx={px} cy={py} r="18" fill="#ef4444" opacity="0.15" />}
          <circle cx={px} cy={py} r="8" fill={iSafe ? '#f59e0b' : '#ef4444'} opacity="0.9" />
          <circle cx={px} cy={py} r="4" fill="white" opacity="0.95" />
          <text x={top.x} y={top.y - 7} textAnchor="middle" fill="#93c5fd" fontSize="11" fontWeight="700">C</text>
          <text x={left.x - 2} y={left.y + 14} textAnchor="middle" fill="#86efac" fontSize="11" fontWeight="700">R</text>
          <text x={right.x + 2} y={right.y + 14} textAnchor="middle" fill="#d8b4fe" fontSize="11" fontWeight="700">S</text>
          <text x={top.x} y={top.y + 1} textAnchor="middle" fill="#64748b" fontSize="7">Continuity</text>
          <text x={left.x + 28} y={left.y + 14} textAnchor="middle" fill="#64748b" fontSize="7">Reciprocity</text>
          <text x={right.x - 28} y={right.y + 14} textAnchor="middle" fill="#64748b" fontSize="7">Sovereignty</text>
          <text x={W/2} y={H - 4} textAnchor="middle" fill="#475569" fontSize="7">τ = 15% threshold · M = min(C,R,S)</text>
        </svg>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mt-2">
        {[
          { l: 'C', v: c, cl: 'text-blue-400' },
          { l: 'R', v: r, cl: 'text-green-400' },
          { l: 'S', v: s, cl: 'text-purple-400' },
          { l: 'M', v: m, cl: iSafe ? 'text-cyan-400' : 'text-red-400' },
        ].map(({ l, v, cl }) => (
          <div key={l} className="bg-slate-800/50 rounded-lg py-2 text-center">
            <div className="text-xs text-slate-500">{l}</div>
            <div className={`text-sm font-bold ${cl}`}>{(v*100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
