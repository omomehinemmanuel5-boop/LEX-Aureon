'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import SignalPillBar from '@/components/SignalPillBar';
import UpgradeModal from '@/components/UpgradeModal';
import DynamicSimplex from '@/components/DynamicSimplex';
import EmailCapture from '@/components/EmailCapture';
import { GovernanceResponse } from '@/types';

const MAX_CALLS = 10;
type Tab = 'governed' | 'raw' | 'analysis' | 'audit';

/* ── Terminal progress bar ──────────────────────────────────── */
function TermProgressBar({ value, max = 1, color = '#22c55e', label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.min(1, value / max);
  const filled = Math.round(pct * 15);
  const empty = 15 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const display = (value * 100).toFixed(1);

  return (
    <span className="font-mono" style={{ color }}>
      [{bar}] {display}% {label}
    </span>
  );
}

/* ── Terminal timestamp ─────────────────────────────────────── */
function TS() {
  return (
    <span className="text-slate-600 font-mono text-xs select-none mr-2">
      [{new Date().toISOString().slice(11, 19)}]
    </span>
  );
}

/* ── Main Console ─────────────────────────────────────────── */
export default function Console() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<GovernanceResponse | null>(null);
  const [apiCalls, setApiCalls] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('governed');
  const [pulse, setPulse] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [totalRuns, setTotalRuns] = useState<number | null>(null);
  const [outputLines, setOutputLines] = useState<{ ts: string; text: string; color: string }[]>([]);
  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'console';
    const stored = localStorage.getItem('lex_session_id');
    if (stored) return stored;
    const id = `console_${crypto.randomUUID()}`;
    localStorage.setItem('lex_session_id', id);
    return id;
  });
  const resultsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(d => setTotalRuns(d.runs)).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('dev_reset') === 'true') {
        localStorage.removeItem('lex_api_calls');
        setApiCalls(0);
        window.history.replaceState({}, '', '/console');
        return;
      }
    }
    const s = localStorage.getItem('lex_api_calls');
    if (s) setApiCalls(parseInt(s));
  }, []);

  useEffect(() => {
    localStorage.setItem('lex_api_calls', apiCalls.toString());
  }, [apiCalls]);

  const addLine = useCallback((text: string, color = '#22c55e') => {
    const ts = new Date().toISOString().slice(11, 19);
    setOutputLines(prev => [...prev.slice(-200), { ts, text, color }]);
  }, []);

  const run = useCallback(async () => {
    if (apiCalls >= MAX_CALLS) { setShowUpgrade(true); return; }
    if (!localStorage.getItem('lex_email_captured') && apiCalls === 0) {
      setShowEmail(true); return;
    }
    if (!prompt.trim()) return;

    setLoading(true); setError(null); setPulse(false);
    addLine('> Initiating constitutional governance pipeline...', '#c9a84c');
    addLine('> Extracting CRS state from prompt...', '#64748b');

    try {
      const r = await fetch('/api/lex/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: sessionId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);

      setRes(data); setApiCalls(p => p + 1); setTab('governed');
      if (totalRuns !== null) setTotalRuns(t => t !== null ? t + 1 : null);
      setPulse(true); setTimeout(() => setPulse(false), 2500);

      const m = data.metrics;
      const intervened = data.intervention?.triggered || data.intervention?.applied || false;
      addLine(`> CRS extracted: C=${m?.c?.toFixed(3)} R=${m?.r?.toFixed(3)} S=${m?.s?.toFixed(3)}`, '#3b82f6');
      addLine(`> M score: ${((m?.m ?? 0) * 100).toFixed(1)}% — ${m?.health ?? 'UNKNOWN'}`, m?.health === 'SAFE' ? '#22c55e' : '#ef4444');
      if (intervened) {
        addLine(`> ⚠ GOVERNOR INTERVENED · ${data.intervention?.reason ?? 'threshold breach'}`, '#ef4444');
      } else {
        addLine('> ✓ Constitutional bounds maintained — no intervention', '#22c55e');
      }
      addLine(`> Audit receipt: ${data.audit_id ?? 'N/A'}`, '#c9a84c');
      addLine('> Pipeline complete.', '#64748b');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Execution failed';
      setError(msg);
      addLine(`> ERROR: ${msg}`, '#ef4444');
    } finally {
      setLoading(false);
    }
  }, [apiCalls, prompt, totalRuns, addLine]);

  const m = res?.metrics;
  const intervened = res?.intervention?.triggered || res?.intervention?.applied || false;
  const pct = Math.round((apiCalls / MAX_CALLS) * 100);

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'governed', icon: '✦', label: 'Output' },
    { id: 'raw', icon: '◎', label: 'Raw' },
    { id: 'analysis', icon: '⬡', label: 'Analysis' },
    { id: 'audit', icon: '🔐', label: 'Audit' },
  ];

  return (
    <div
      className="min-h-screen text-white flex flex-col terminal-scanlines"
      style={{ background: '#050810', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}
    >
      {/* ── Terminal Header Bar ─────────────────────────── */}
      <div
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-2 border-b"
        style={{
          background: '#0a0d18',
          borderColor: '#1a2040',
          boxShadow: '0 1px 20px rgba(0,0,0,0.6)',
        }}
      >
        {/* macOS dots */}
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#ffbd2e' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
          <span className="ml-4 text-xs font-mono font-bold" style={{ color: '#c9a84c' }}>
            LEX AUREON · PRAXIS v1.0 · CONSTITUTIONAL TERMINAL
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xs font-mono text-slate-600 hover:text-slate-400 transition-colors">
            ← home
          </Link>
          {/* Usage */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <TermProgressBar value={apiCalls} max={MAX_CALLS} color={pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e'} label={`${apiCalls}/${MAX_CALLS}`} />
            </div>
            <span className="sm:hidden text-xs font-mono text-slate-500">{apiCalls}/{MAX_CALLS}</span>
            {totalRuns && (
              <span className="text-xs text-slate-700 font-mono hidden sm:inline">· {totalRuns.toLocaleString()} total</span>
            )}
          </div>
          <button
            onClick={() => setShowUpgrade(true)}
            className="text-xs px-3 py-1 rounded border font-mono transition-all hover:opacity-80"
            style={{ borderColor: '#c9a84c40', color: '#c9a84c', background: '#c9a84c0a' }}
          >
            upgrade
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-36 space-y-4">

          {/* ── Terminal Input ──────────────────────────── */}
          <div
            className="rounded-lg border p-4"
            style={{ background: '#070b14', borderColor: '#1a2040' }}
          >
            {/* Input label */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-mono" style={{ color: '#c9a84c' }}>root@lex-praxis:~$</span>
              <span className="text-xs font-mono text-slate-500">governance --prompt</span>
              <span className="ml-auto text-xs font-mono text-slate-700">{MAX_CALLS - apiCalls} runs left</span>
            </div>

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value.slice(0, 5000))}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && prompt.trim() && !loading) run();
                }}
                placeholder="Enter prompt for constitutional governance..."
                rows={4}
                className="w-full rounded p-3 text-sm leading-relaxed resize-none focus:outline-none focus:ring-1"
                style={{
                  background: '#040609',
                  border: '1px solid #1a2040',
                  color: '#22c55e',
                  caretColor: '#22c55e',
                  fontFamily: 'inherit',
                }}
              />
              {/* blinking cursor indicator */}
              {!prompt && (
                <span
                  className="absolute left-3 top-3 pointer-events-none"
                  style={{
                    display: 'inline-block',
                    width: 8, height: 14,
                    background: '#22c55e',
                    animation: 'term-blink 1s step-end infinite',
                    opacity: 0.7,
                  }}
                />
              )}
            </div>

            {/* Signal pills */}
            <SignalPillBar prompt={prompt} />

            <div className="flex items-center justify-between mt-3">
              <span className="text-xs font-mono text-slate-700">{prompt.length}/5000</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-700 hidden sm:block">⌘+Enter to run</span>
                <button
                  onClick={run}
                  disabled={!prompt.trim() || loading || apiCalls >= MAX_CALLS}
                  className="px-5 py-2 rounded text-xs font-bold font-mono transition-all active:scale-95 disabled:opacity-30"
                  style={{
                    background: prompt.trim() && !loading && apiCalls < MAX_CALLS
                      ? 'linear-gradient(90deg, #c9a84c, #e8c96d)'
                      : '#1a2040',
                    color: prompt.trim() && !loading && apiCalls < MAX_CALLS ? '#07070d' : '#475569',
                  }}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      executing...
                    </span>
                  ) : apiCalls >= MAX_CALLS ? 'limit reached' : '⚡ run governance'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Terminal Output Log ─────────────────────── */}
          {outputLines.length > 0 && (
            <div
              className="rounded-lg border p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto"
              style={{ background: '#040609', borderColor: '#1a2040' }}
            >
              <div className="text-slate-700 mb-2">{'// system output'}</div>
              {outputLines.map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-slate-700 flex-shrink-0">[{line.ts}]</span>
                  <span style={{ color: line.color }}>{line.text}</span>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-700">[{new Date().toISOString().slice(11, 19)}]</span>
                  <span style={{ color: '#c9a84c' }}>
                    {'> '}
                    <span style={{ animation: 'term-blink 0.8s step-end infinite', display: 'inline-block', background: '#c9a84c', width: 6, height: 12, verticalAlign: 'middle' }} />
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Error ──────────────────────────────────── */}
          {error && (
            <div
              className="rounded-lg border p-4 font-mono text-xs"
              style={{ background: '#1a0505', borderColor: '#7f1d1d' }}
            >
              <div className="text-red-400">⚠ ERROR · {new Date().toISOString().slice(11, 19)}</div>
              <div className="text-red-300 mt-1">{error}</div>
            </div>
          )}

          {/* ── Loading ─────────────────────────────────── */}
          {loading && (
            <div
              className="rounded-lg border p-6 flex flex-col items-center gap-3"
              style={{ background: '#040609', borderColor: '#1a2040' }}
            >
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 border-2 border-slate-800 border-t-green-500 rounded-full animate-spin" />
                <div className="absolute inset-1 border border-transparent border-b-amber-500 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.7s' }} />
              </div>
              <div className="text-center font-mono">
                <p className="text-xs text-green-400">Executing constitutional governance pipeline...</p>
                <p className="text-xs text-slate-600 mt-1">extracting CRS · checking M · evaluating velocity</p>
              </div>
            </div>
          )}

          {/* ── Results ─────────────────────────────────── */}
          {res && !loading && (
            <div ref={resultsRef} className="space-y-4">

              {/* Governor status */}
              {intervened ? (
                <div
                  className="rounded-lg border p-4 font-mono text-xs"
                  style={{ background: '#1a0505', borderColor: '#7f1d1d' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-400 text-sm">⚠</span>
                    <span className="text-red-400 font-bold text-sm">GOVERNOR INTERVENED · mode: {res.intervention?.type ?? 'correction'}</span>
                  </div>
                  <div className="text-red-300/70">{res.intervention?.reason ?? 'Constitutional threshold violated'}</div>
                </div>
              ) : (
                <div
                  className="rounded-lg border p-3 font-mono text-xs flex items-center gap-2"
                  style={{ background: '#050f0a', borderColor: '#14532d' }}
                >
                  <span className="text-green-400">✓</span>
                  <span className="text-green-400">GOVERNOR PASSED · constitutional bounds maintained</span>
                  <span className="ml-auto text-slate-600">M = {((m?.m ?? 0) * 100).toFixed(1)}%</span>
                </div>
              )}

              {/* M score terminal bar */}
              {m && (
                <div
                  className="rounded-lg border p-4 font-mono text-xs space-y-2"
                  style={{ background: '#040609', borderColor: '#1a2040' }}
                >
                  <div className="text-slate-500 mb-3">{'// constitutional state · M score'}</div>
                  {[
                    { key: 'C', val: m.c, label: 'Continuity', color: '#3b82f6' },
                    { key: 'R', val: m.r, label: 'Reciprocity', color: '#10b981' },
                    { key: 'S', val: m.s, label: 'Sovereignty', color: '#f59e0b' },
                    { key: 'M', val: m.m, label: m.m <= 0.05 ? '⚠ BELOW τ' : m.m < 0.08 ? '⚠ STRESSED' : 'SAFE', color: m.m <= 0.05 ? '#ef4444' : m.m < 0.08 ? '#f59e0b' : '#22c55e' },
                  ].map(({ key, val, label, color }) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-4 text-right font-bold" style={{ color }}>{key}</span>
                      <span className="flex-1">
                        <TermProgressBar value={val} color={color} label={label} />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab bar (terminal style) */}
              <div
                className="rounded-lg border overflow-hidden"
                style={{ background: '#040609', borderColor: '#1a2040' }}
              >
                <div
                  className="flex border-b"
                  style={{ borderColor: '#1a2040' }}
                >
                  {tabs.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono transition-all"
                      style={{
                        color: tab === t.id ? '#c9a84c' : '#475569',
                        background: tab === t.id ? '#0f1929' : 'transparent',
                        borderBottom: tab === t.id ? '1px solid #c9a84c' : '1px solid transparent',
                      }}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                <div className="p-4">
                  {/* Output tab — governor is a gate, not an editor; output = raw when not blocked */}
                  {tab === 'governed' && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <TS />
                        <span className="text-xs font-mono" style={{ color: intervened ? '#f59e0b' : '#22c55e' }}>
                          {intervened ? '// governor invoked constitutional constraints' : '// passed constitutional review'}
                        </span>
                      </div>
                      <div
                        className="rounded p-4 max-h-64 overflow-y-auto text-sm leading-relaxed"
                        style={{
                          background: '#020408',
                          border: `1px solid ${intervened ? '#92400e30' : '#14532d30'}`,
                          color: intervened ? '#fcd34d' : '#86efac',
                          fontFamily: 'inherit',
                        }}
                      >
                        {res.governed_output}
                      </div>
                    </div>
                  )}

                  {/* Raw tab */}
                  {tab === 'raw' && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <TS />
                        <span className="text-xs font-mono text-slate-500">{'// raw LLM output · pre-governor'}</span>
                      </div>
                      <div
                        className="rounded p-4 max-h-64 overflow-y-auto text-sm leading-relaxed"
                        style={{ background: '#020408', border: '1px solid #1a2040', color: '#64748b', fontFamily: 'inherit' }}
                      >
                        {res.raw_output}
                      </div>
                    </div>
                  )}

                  {/* Analysis tab */}
                  {tab === 'analysis' && m && (
                    <div className="space-y-4">
                      <DynamicSimplex
                        liveC={m.c} liveR={m.r} liveS={m.s} liveM={m.m}
                        intervention={intervened}
                        healthBand={res.metrics.health_band ?? 'OPTIMAL'}
                        animating={pulse}
                      />

                      {/* z_traj terminal readout */}
                      {res.z_traj && (() => {
                        const z = res.z_traj!;
                        return (
                          <div
                            className="rounded p-4 font-mono text-xs space-y-1"
                            style={{ background: '#020408', border: '1px solid #1a2040' }}
                          >
                            <div className="text-slate-600 mb-2">{'// z_traj state vector'}</div>
                            {[
                              { key: 'velocity', val: z.velocity.toFixed(3), color: z.velocity < 0.1 ? '#22c55e' : z.velocity < 0.3 ? '#f59e0b' : '#ef4444' },
                              { key: 'n_stable', val: String(z.n_stable), color: z.n_stable >= 3 ? '#22c55e' : z.n_stable >= 1 ? '#f59e0b' : '#ef4444' },
                              { key: 'drift_dir', val: z.drift_dir || 'none', color: z.drift_dir && z.drift_dir !== 'none' ? '#f59e0b' : '#22c55e' },
                              { key: 'σ_viol', val: z.sigma_viol.toFixed(3), color: z.sigma_viol < 0.1 ? '#22c55e' : z.sigma_viol < 0.25 ? '#f59e0b' : '#ef4444' },
                            ].map(({ key, val, color }) => (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-slate-600">{'>'}</span>
                                <span className="text-slate-400 w-20">{key}:</span>
                                <span className="font-bold" style={{ color }}>{val}</span>
                              </div>
                            ))}
                            {z.sigma_viol >= 0.25 && (
                              <div className="mt-2 pt-2 border-t" style={{ borderColor: '#1a2040' }}>
                                <span style={{ color: '#f97316' }}>⚠ slow-drip erosion detected · σ={z.sigma_viol.toFixed(3)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Triggers */}
                      {res.triggers && (
                        <div
                          className="rounded p-3 font-mono text-xs"
                          style={{ background: '#020408', border: '1px solid #1a2040' }}
                        >
                          <div className="text-slate-600 mb-2">{'// trigger analysis'}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {res.triggers.collapse && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1a0505', color: '#f87171', border: '1px solid #7f1d1d' }}>M_collapse</span>}
                            {res.triggers.velocity && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1c1005', color: '#fb923c', border: '1px solid #7c2d12' }}>‖dx/dt‖&gt;δ</span>}
                            {res.triggers.per_invariant?.C && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#07162b', color: '#60a5fa', border: '1px solid #1e3a5f' }}>dC/dt&lt;-ε</span>}
                            {res.triggers.per_invariant?.R && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#051a10', color: '#34d399', border: '1px solid #065f46' }}>dR/dt&lt;-ε</span>}
                            {res.triggers.per_invariant?.S && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1a1205', color: '#fbbf24', border: '1px solid #78350f' }}>dS/dt&lt;-ε</span>}
                            {!res.triggers.collapse && !res.triggers.velocity && !res.triggers.per_invariant?.C && !res.triggers.per_invariant?.R && !res.triggers.per_invariant?.S && (
                              <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#052017', color: '#4ade80', border: '1px solid #14532d' }}>✓ no_triggers</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Audit tab */}
                  {tab === 'audit' && (
                    <div className="font-mono text-xs space-y-3">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-slate-500">{'// governance audit trail'}</span>
                        <div className="flex gap-2">
                          {res.audit_id && (
                            <a href={`/audit/${res.audit_id}`} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1 rounded text-xs font-mono transition-all hover:opacity-80"
                              style={{ background: '#c9a84c15', color: '#c9a84c', border: '1px solid #c9a84c30' }}>
                              share ↗
                            </a>
                          )}
                          <button
                            onClick={() => {
                              const blob = new Blob([JSON.stringify({ audit_id: res.audit_id, timestamp: res.timestamp, metrics: res.metrics, intervention: res.intervention }, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = `lex-audit-${res.audit_id}.json`;
                              a.click(); URL.revokeObjectURL(url);
                            }}
                            className="px-2.5 py-1 rounded text-xs font-mono transition-all hover:opacity-80"
                            style={{ background: '#1a2040', color: '#64748b', border: '1px solid #1a2040' }}
                          >
                            export ↓
                          </button>
                        </div>
                      </div>
                      {[
                        { label: 'audit_id', value: res.audit_id ?? 'N/A', color: '#c9a84c', href: res.audit_id ? `/audit/${res.audit_id}` : undefined },
                        { label: 'timestamp', value: res.timestamp ? new Date(res.timestamp).toISOString() : 'N/A', color: '#94a3b8', href: undefined },
                        { label: 'health', value: m?.health ?? 'N/A', color: m?.health === 'SAFE' ? '#22c55e' : '#ef4444', href: undefined },
                        { label: 'governor', value: intervened ? 'INTERVENED' : 'PASSED', color: intervened ? '#f59e0b' : '#22c55e', href: undefined },
                      ].map(({ label, value, color, href }) => (
                        <div key={label}
                          className="rounded p-3"
                          style={{ background: '#020408', border: '1px solid #1a2040' }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600">{'>'}</span>
                            <span className="text-slate-500 w-24">{label}:</span>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all underline underline-offset-2 hover:opacity-80 transition-opacity"
                                style={{ color }}
                              >
                                {value}
                              </a>
                            ) : (
                              <span className="break-all" style={{ color }}>{value}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="rounded p-3 max-h-40 overflow-y-auto"
                        style={{ background: '#020408', border: '1px solid #1a2040' }}>
                        <div className="text-slate-600 mb-1">{'>'} metrics:</div>
                        <pre className="text-xs" style={{ color: '#22c55e' }}>
                          {JSON.stringify({ c: m?.c, r: m?.r, s: m?.s, m: m?.m, intervention: intervened }, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick re-run */}
              <div className="flex items-center gap-2 p-3 rounded font-mono text-xs"
                style={{ background: '#040609', border: '1px solid #1a2040' }}>
                <span className="text-slate-600 flex-1">{'>'} run complete — edit prompt or re-run</span>
                <button onClick={run} disabled={!prompt.trim() || loading || apiCalls >= MAX_CALLS}
                  className="px-3 py-1 rounded text-xs font-mono transition-all disabled:opacity-30"
                  style={{ background: '#c9a84c15', color: '#c9a84c', border: '1px solid #c9a84c30' }}>
                  {apiCalls >= MAX_CALLS ? 'upgrade ↗' : '↺ re-run'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Sticky Bottom Bar ─────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t safe-area-pb"
        style={{ background: '#050810e6', borderColor: '#1a2040', backdropFilter: 'blur(12px)' }}
      >
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          {res && (
            <div className="flex gap-1 flex-1">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 py-2.5 rounded text-xs font-mono transition-all"
                  style={{
                    background: tab === t.id ? '#c9a84c' : '#0a0d18',
                    color: tab === t.id ? '#07070d' : '#475569',
                    border: `1px solid ${tab === t.id ? '#c9a84c' : '#1a2040'}`,
                  }}>
                  {t.icon}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={run}
            disabled={!prompt.trim() || loading || apiCalls >= MAX_CALLS}
            className={`${res ? 'flex-shrink-0 px-5' : 'w-full'} py-3 rounded text-xs font-bold font-mono transition-all active:scale-95 disabled:opacity-30`}
            style={{
              background: prompt.trim() && !loading && apiCalls < MAX_CALLS
                ? 'linear-gradient(90deg, #c9a84c, #e8c96d)'
                : '#0a0d18',
              color: prompt.trim() && !loading && apiCalls < MAX_CALLS ? '#07070d' : '#475569',
              border: '1px solid #1a2040',
            }}
          >
            {loading ? '...' : apiCalls >= MAX_CALLS ? 'upgrade ↗' : res ? '↺ re-run' : '⚡ run governance'}
          </button>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail && (
        <EmailCapture onComplete={(email) => {
          console.log('Email captured:', email);
          setShowEmail(false);
          setTimeout(() => run(), 100);
        }} />
      )}
    </div>
  );
}
