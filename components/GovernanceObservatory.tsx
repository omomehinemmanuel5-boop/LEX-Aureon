'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Receipt = {
  id: string;
  timestamp: number;
  m_before: number;
  m_after: number;
  governor_mode?: string;
  intervention: boolean;
  pre_eval_label?: string;
  slow_drip?: boolean;
  sigma_viol?: number;
};

type Metrics = {
  timestamp: string;
  system: { total_calls: number; total_interventions: number; intervention_rate: number; avg_m_before: number; avg_m_after: number; avg_governor_effort: number };
  health_status: string;
};

type State = { C: number | null; R: number | null; S: number | null; M: number | null };

const COLORS = { indigo: '#818cf8', teal: '#2dd4bf', amber: '#fbbf24', red: '#fb7185', ink: '#07070d' };

function pct(value: number | null | undefined) { return value == null ? '—' : `${Math.round(value * 100)}%`; }
function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
function tone(value: number | null | undefined) { return value == null ? 'muted' : value >= 0.25 ? 'good' : value >= 0.15 ? 'warn' : 'bad'; }

function Gauge({ label, value, color }: { label: string; value: number | null; color: string }) {
  const safe = Math.max(0, Math.min(1, value ?? 0));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:flex-col sm:items-start sm:p-4">
    <div className="relative h-[76px] w-[76px] shrink-0 sm:h-[94px] sm:w-[94px]">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="42" cy="42" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="7" />
        <circle cx="42" cy="42" r={radius} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - safe)} className="transition-all duration-700" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-white">{pct(value)}</span>
    </div>
    <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">{label}</div><div className="mt-1 text-xs text-slate-500">constitutional pillar</div></div>
  </div>;
}

function Panel({ title, eyebrow, children, className = '' }: { title: string; eyebrow?: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,.18)] sm:p-5 ${className}`}>
    <div className="mb-4 flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-indigo-300">{eyebrow ?? 'Observatory'}</div><h2 className="mt-1 text-base font-bold text-white sm:text-lg">{title}</h2></div></div>
    {children}
  </section>;
}

export default function GovernanceObservatory() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, m, s] = await Promise.all([fetch('/api/audits/recent?limit=8'), fetch('/api/observability/metrics'), fetch('/api/live-state')]);
      if (!r.ok || !m.ok || !s.ok) throw new Error('observatory unavailable');
      const recent = await r.json() as { receipts?: Receipt[] };
      const metricData = await m.json() as Metrics;
      const stateData = await s.json() as { state?: State };
      setReceipts(recent.receipts ?? []); setMetrics(metricData); setState(stateData.state ?? null); setError(false);
    } catch { setError(true); }
  }, []);

  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]);

  const heat = useMemo(() => Array.from({ length: 42 }, (_, i) => receipts.length ? (receipts[i % receipts.length].m_after ?? 0) : null), [receipts]);
  const health = metrics?.health_status ?? 'NO DATA';
  const healthColor = health === 'OPTIMAL' ? COLORS.teal : health === 'CRITICAL' ? COLORS.red : COLORS.amber;

  return <main className="min-h-screen overflow-x-hidden bg-[#07070d] text-slate-200">
    <div className="mx-auto max-w-7xl px-4 pb-14 pt-24 sm:px-6 lg:px-8">
      <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/5 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[.16em] text-teal-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" /> Live governance surface</div><h1 className="max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">Governance <span className="text-indigo-300">Observatory</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">A verifiable execution history for constitutional decisions, receipts, and runtime state.</p></div>
        <div className="flex gap-2"><Link href="/console" className="min-h-11 rounded-xl border border-white/10 px-4 py-3 text-center text-xs font-bold text-slate-200 transition hover:border-indigo-300/40 hover:text-white">Run a governed action</Link><button onClick={() => void load()} className="min-h-11 rounded-xl bg-indigo-400 px-4 py-3 text-xs font-bold text-[#101126] transition hover:bg-indigo-300">Refresh</button></div>
      </header>

      {error && <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"><span>Some live sources are unavailable. The Observatory will keep the last known state.</span><button onClick={() => void load()} className="self-start rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-bold sm:self-auto">Retry</button></div>}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <Panel title="Constitutional state" eyebrow="Live CRS dashboard"><div className="flex flex-col gap-4 sm:flex-row"><Gauge label="Continuity" value={state?.C ?? null} color={COLORS.indigo} /><Gauge label="Reciprocity" value={state?.R ?? null} color={COLORS.teal} /><Gauge label="Sovereignty" value={state?.S ?? null} color={COLORS.amber} /></div><div className="mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3 py-3"><span className="text-xs text-slate-400">Stability margin <span className="font-mono text-white">M = min(C,R,S)</span></span><span className={`font-mono text-sm font-bold text-${tone(state?.M) === 'good' ? 'teal' : tone(state?.M) === 'warn' ? 'amber' : 'rose'}-300`}>{pct(state?.M)}</span></div></Panel>
        <Panel title="System pulse" eyebrow="Last 30 minutes"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Governed calls</div><div className="mt-2 font-mono text-2xl font-bold text-white">{metrics?.system.total_calls ?? '—'}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Interventions</div><div className="mt-2 font-mono text-2xl font-bold text-amber-300">{metrics?.system.total_interventions ?? '—'}</div></div></div><div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3"><span className="text-xs text-slate-400">Health band</span><span className="font-mono text-xs font-bold" style={{ color: healthColor }}>{health}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-400">Intervention rate</span><span className="font-mono text-xs text-white">{metrics ? `${(metrics.system.intervention_rate * 100).toFixed(1)}%` : '—'}</span></div></Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <Panel title="Receipt replay" eyebrow="Immutable execution history" className="min-w-0"><div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>{receipts.length ? `${receipts.length} recent receipts` : 'No receipts returned'}</span><Link href="/audit" className="font-bold text-indigo-300 hover:text-indigo-200">Open audit index →</Link></div><div className="space-y-2">{receipts.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">No production receipts available yet. Run the console to create a real replay.</div>}{receipts.map((receipt) => <Link href={`/receipts/${encodeURIComponent(receipt.id)}`} key={receipt.id} className="group flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-black/15 p-3 transition hover:border-indigo-300/40 hover:bg-indigo-300/5"><span className={`h-2 w-2 shrink-0 rounded-full ${receipt.intervention ? 'bg-amber-300' : 'bg-teal-300'}`} /><span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs font-bold text-slate-200 group-hover:text-white">{receipt.id}</span><span className="mt-1 block text-[11px] text-slate-500">{receipt.intervention ? 'Governor intervention' : 'Constitutional pass'} · M {pct(receipt.m_after)}</span></span><span className="shrink-0 font-mono text-[10px] text-slate-500">{timeAgo(receipt.timestamp)} ↗</span></Link>)}</div></Panel>
        <Panel title="Execution path" eyebrow="Tool call graph"><div className="relative flex min-h-[220px] items-center justify-center"><svg viewBox="0 0 360 210" className="absolute inset-0 h-full w-full" aria-label="Execution path from user through Lex to receipt"><path d="M72 105H142M218 105H288" stroke="rgba(129,140,248,.5)" strokeWidth="2" strokeDasharray="5 5" className="animate-[shimmer_3s_linear_infinite]" /><path d="M180 66V32M180 144V178" stroke="rgba(45,212,191,.35)" strokeWidth="2" strokeDasharray="5 5" /></svg>{[['User', 'left-2 top-[92px]', COLORS.amber], ['Lex', 'left-1/2 top-[92px] -translate-x-1/2', COLORS.indigo], ['Receipt', 'right-2 top-[92px]', COLORS.teal], ['MCP / tools', 'left-1/2 top-1 -translate-x-1/2', '#94a3b8'], ['Replay', 'bottom-1 left-1/2 -translate-x-1/2', '#c084fc']].map(([label, pos, color]) => <div key={String(label)} className={`absolute ${pos} rounded-xl border border-white/10 bg-[#101126] px-3 py-2 text-center shadow-lg`}><div className="text-xs font-bold" style={{ color: String(color) }}>{label}</div><div className="mt-0.5 font-mono text-[9px] text-slate-500">verified edge</div></div>)}</div><p className="text-xs leading-5 text-slate-500">SVG graph is a runtime topology view. Edge animation indicates execution flow, not a claim that every provider is currently connected.</p></Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <Panel title="Drift heatmap" eyebrow="Governance intensity"><div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>Recent execution windows</span><span className="rounded-full border border-amber-300/20 px-2 py-1 font-mono text-[10px] text-amber-200">Demo when no receipts exist</span></div><div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10">{heat.map((value, i) => { const color = value == null ? 'rgba(255,255,255,.07)' : value >= .25 ? 'rgba(45,212,191,.72)' : value >= .15 ? 'rgba(251,191,36,.72)' : 'rgba(251,113,133,.72)'; return <div key={i} title={value == null ? 'No production snapshot' : `CRS snapshot M=${value.toFixed(3)}`} className="aspect-square rounded-md transition hover:scale-110" style={{ background: color }} />; })}</div><div className="mt-4 flex gap-4 text-[10px] text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-teal-300" />stable</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300" />alert</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-300" />critical</span></div></Panel>
        <Panel title="Trajectory replay" eyebrow="Session history"><div className="rounded-xl border border-dashed border-white/10 bg-black/15 p-4"><div className="flex items-center gap-2"><span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 font-mono text-[10px] font-bold text-amber-200">DEMO</span><span className="text-xs text-slate-400">No session selected</span></div><p className="mt-3 text-sm leading-6 text-slate-400">Choose a session in Deep Observability to replay persisted turns. This preview never presents fabricated trajectory data as production history.</p><div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">{['Request', 'Evaluate', 'Approve', 'Execute', 'Receipt'].map((step, i) => <div key={step} className="flex shrink-0 items-center gap-2"><div className={`rounded-lg border px-2.5 py-2 text-[10px] font-bold ${i < 2 ? 'border-teal-300/30 bg-teal-300/10 text-teal-200' : 'border-white/10 bg-white/5 text-slate-500'}`}>{step}</div>{i < 4 && <span className="text-slate-600">→</span>}</div>)}</div></div></Panel>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3"><Link href="/api-docs" className="rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-indigo-300/30"><div className="font-mono text-[10px] uppercase tracking-widest text-indigo-300">SDK</div><h3 className="mt-2 font-bold text-white">Integrate governance</h3><p className="mt-1 text-xs leading-5 text-slate-500">JavaScript, Python, and Rust installation paths.</p></Link><div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="font-mono text-[10px] uppercase tracking-widest text-amber-200">Passport</div><h3 className="mt-2 font-bold text-white">Governance Passport</h3><p className="mt-1 text-xs leading-5 text-slate-500">Coming Soon · signed history and policy provenance.</p></div><Link href="/observability" className="rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-teal-300/30"><div className="font-mono text-[10px] uppercase tracking-widest text-teal-300">Deep dive</div><h3 className="mt-2 font-bold text-white">Session observability</h3><p className="mt-1 text-xs leading-5 text-slate-500">Filter and replay persisted turns by session ID.</p></Link></div>
    </div>
  </main>;
}

export { COLORS };
