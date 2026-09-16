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
type Session = { session_id: string; last_seen: string; turns: number };

const COLORS = { gold: '#c9a84c', goldLight: '#e8c96d', blue: '#3b82f6', teal: '#10b981', amber: '#f59e0b', red: '#ef4444', ink: '#07070d' };

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
  return <div className="flex min-w-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.035] p-2.5 text-center sm:flex-1 sm:items-start sm:p-4 sm:text-left">
    <div className="relative h-[64px] w-[64px] shrink-0 sm:h-[94px] sm:w-[94px]">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="42" cy="42" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="7" />
        <circle cx="42" cy="42" r={radius} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - safe)} className="transition-all duration-700" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-white sm:text-sm">{pct(value)}</span>
    </div>
    <div className="mt-2 min-w-0"><div className="truncate text-[9px] font-bold uppercase tracking-[.12em] text-slate-400 sm:text-[10px] sm:tracking-[.18em]">{label}</div><div className="mt-1 hidden text-xs text-slate-500 sm:block">constitutional pillar</div></div>
  </div>;
}

function Panel({ title, eyebrow, children, className = '' }: { title: string; eyebrow?: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,.18)] sm:rounded-3xl sm:p-5 ${className}`}>
    <div className="mb-4 flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-[#e8c96d]">{eyebrow ?? 'Observatory'}</div><h2 className="mt-1 text-base font-bold text-white sm:text-lg">{title}</h2></div></div>
    {children}
  </section>;
}

function ReceiptActions({ receiptId }: { receiptId: string }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'tampered' | 'unsigned' | 'legacy_insecure' | 'not_found' | 'unavailable'>('idle');
  const verify = async () => {
    setStatus('checking');
    try {
      const response = await fetch('/api/audits/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt_id: receiptId }) });
      const data = await response.json() as { status?: string };
      setStatus((data.status as typeof status) ?? 'unavailable');
    } catch { setStatus('unavailable'); }
  };
  const label = status === 'checking' ? 'Checking…' : status === 'valid' ? 'Verified' : status === 'tampered' ? 'Tampered' : status === 'legacy_insecure' ? 'Legacy key' : status === 'unsigned' ? 'Unsigned' : status === 'not_found' ? 'Not found' : 'Verify';
  const color = status === 'valid' ? COLORS.teal : status === 'tampered' ? COLORS.red : status === 'idle' ? COLORS.gold : COLORS.amber;
  return <div className="flex shrink-0 items-center gap-1.5"><button type="button" onClick={verify} disabled={status === 'checking'} aria-label={`Verify receipt ${receiptId}`} className="min-h-9 rounded-lg border px-2.5 py-2 font-mono text-[10px] font-bold transition hover:bg-white/5 disabled:opacity-60" style={{ borderColor: `${color}55`, color }}>{label}</button><a href={`/api/audits/${encodeURIComponent(receiptId)}/export`} aria-label={`Export receipt ${receiptId}`} className="flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-white/10 px-2 text-xs text-slate-400 transition hover:border-white/25 hover:text-white">↓</a></div>;
}

function StabilityTrend({ receipts }: { receipts: Receipt[] }) {
  const values = receipts.slice().reverse().map(receipt => receipt.m_after).filter(value => Number.isFinite(value));
  const points = values.map((value, index) => `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${100 - Math.max(0, Math.min(1, value)) * 100}`).join(' ');
  return <div className="relative h-36 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2" role="img" aria-label={`Stability margin trend across ${values.length} recent receipts`}><div className="pointer-events-none absolute inset-x-2 top-2 border-t border-white/5" /><div className="pointer-events-none absolute inset-x-2 top-1/2 border-t border-white/5" /><div className="pointer-events-none absolute inset-x-2 bottom-2 border-t border-white/5" />{values.length > 0 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><polyline points={points} fill="none" stroke={COLORS.goldLight} strokeWidth="2.5" vectorEffect="non-scaling-stroke" /><polyline points={`0,100 ${points} 100,100`} fill="rgba(201,168,76,.10)" stroke="none" /></svg> : <div className="flex h-full items-center justify-center text-xs text-slate-500">No persisted M history available</div>}<div className="absolute bottom-2 left-3 font-mono text-[9px] text-slate-500">older</div><div className="absolute bottom-2 right-3 font-mono text-[9px] text-slate-500">newer</div></div>;
}

export default function GovernanceObservatory() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      fetch('/api/audits/recent?limit=8').then(async response => response.ok ? await response.json() as { receipts?: Receipt[] } : Promise.reject()),
      fetch('/api/observability/metrics').then(async response => response.ok ? await response.json() as Metrics : Promise.reject()),
      fetch('/api/live-state').then(async response => response.ok ? await response.json() as { state?: State } : Promise.reject()),
      fetch('/api/observability/sessions?limit=6').then(async response => response.ok ? await response.json() as { sessions?: Session[] } : Promise.reject()),
    ]);
    const [recent, metricData, stateData, sessionData] = results;
    if (recent.status === 'fulfilled') setReceipts(recent.value.receipts ?? []);
    if (metricData.status === 'fulfilled') setMetrics(metricData.value);
    if (stateData.status === 'fulfilled') setState(stateData.value.state ?? null);
    if (sessionData.status === 'fulfilled') setSessions(sessionData.value.sessions ?? []);
    setError(results.some(result => result.status === 'rejected'));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]);

  const heat = useMemo(() => Array.from({ length: 42 }, (_, i) => receipts.length ? (receipts[i % receipts.length].m_after ?? 0) : null), [receipts]);
  const health = metrics?.health_status ?? 'NO DATA';
  const healthColor = health === 'OPTIMAL' ? COLORS.teal : health === 'CRITICAL' ? COLORS.red : COLORS.amber;

  return <main className="min-h-screen overflow-x-hidden bg-[#07070d] text-slate-200">
    <div className="mx-auto max-w-7xl px-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))] pt-24 sm:px-6 sm:pb-14 lg:px-8">
      <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[.12em] text-[#e8c96d] sm:tracking-[.16em]"><span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#e8c96d]" /> Live governance surface</div><h1 className="max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">Governance <span className="text-gold">Observatory</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">A verifiable execution history for constitutional decisions, receipts, and runtime state.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:flex"><Link href="/console" className="flex min-h-11 items-center justify-center rounded-xl border border-[#c9a84c]/30 px-3 py-3 text-center text-[11px] font-bold text-slate-200 transition hover:border-[#e8c96d]/60 hover:text-white sm:px-4 sm:text-xs">Run a governed action</Link><button type="button" onClick={() => void load()} disabled={refreshing} aria-busy={refreshing} className="min-h-11 rounded-xl bg-gradient-to-br from-[#c9a84c] to-[#e8c96d] px-3 py-3 text-xs font-bold text-[#07070d] shadow-[0_8px_24px_rgba(201,168,76,.18)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70 sm:px-4">{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
      </header>

      {error && <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"><span>Some live sources are unavailable. The Observatory will keep the last known state.</span><button onClick={() => void load()} className="self-start rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-bold sm:self-auto">Retry</button></div>}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <Panel title="Constitutional state" eyebrow="Live CRS dashboard"><div className="grid grid-cols-3 gap-2 sm:flex sm:gap-4">{loading ? [COLORS.blue, COLORS.teal, COLORS.amber].map((color, index) => <div key={color} className="flex min-w-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.035] p-2.5 sm:flex-1 sm:items-start sm:p-4"><div className="h-16 w-16 animate-pulse rounded-full border-[7px] border-white/10 sm:h-[94px] sm:w-[94px]" style={{ borderTopColor: color }} /><div className="mt-2 h-3 w-16 animate-pulse rounded bg-white/10" /><span className="sr-only">Loading pillar {index + 1}</span></div>) : <><Gauge label="Continuity" value={state?.C ?? null} color={COLORS.blue} /><Gauge label="Reciprocity" value={state?.R ?? null} color={COLORS.teal} /><Gauge label="Sovereignty" value={state?.S ?? null} color={COLORS.amber} /></>}</div><div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#c9a84c]/20 bg-black/20 px-3 py-3"><span className="text-xs text-slate-400">Stability margin <span className="font-mono text-white">M = min(C,R,S)</span></span><span className="shrink-0 font-mono text-sm font-bold" style={{ color: tone(state?.M) === 'good' ? COLORS.teal : tone(state?.M) === 'warn' ? COLORS.amber : COLORS.red }}>{loading ? '…' : pct(state?.M)}</span></div></Panel>
        <Panel title="System pulse" eyebrow="Last 30 minutes"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Governed calls</div><div className="mt-2 font-mono text-2xl font-bold text-white">{loading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-white/10" /> : metrics?.system.total_calls ?? '—'}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Interventions</div><div className="mt-2 font-mono text-2xl font-bold text-amber-300">{loading ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-white/10" /> : metrics?.system.total_interventions ?? '—'}</div></div></div><div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3"><span className="text-xs text-slate-400">Health band</span><span className="font-mono text-xs font-bold" style={{ color: healthColor }}>{loading ? 'SYNCING' : health}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-400">Intervention rate</span><span className="font-mono text-xs text-white">{metrics ? `${(metrics.system.intervention_rate * 100).toFixed(1)}%` : '—'}</span></div></Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <Panel title="Receipt replay" eyebrow="Immutable execution history" className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{receipts.length ? `${receipts.length} recent receipts` : 'No receipts returned'}</span><div className="flex items-center gap-3"><Link href="/audit" className="font-bold text-[#e8c96d] hover:text-white">Open audit index →</Link>{receipts[0] && <ReceiptActions receiptId={receipts[0].id} />}</div></div><div className="space-y-2">{receipts.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">No production receipts available yet. Run the console to create a real replay.</div>}{receipts.map((receipt) => <Link href={`/receipts/${encodeURIComponent(receipt.id)}`} key={receipt.id} className="group flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-black/15 p-3 transition hover:border-[#c9a84c]/40 hover:bg-[#c9a84c]/5"><span className={`h-2 w-2 shrink-0 rounded-full ${receipt.intervention ? 'bg-amber-300' : 'bg-emerald-300'}`} /><span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs font-bold text-slate-200 group-hover:text-white">{receipt.id}</span><span className="mt-1 block text-[11px] text-slate-500">{receipt.intervention ? 'Governor intervention' : 'Constitutional pass'} · M {pct(receipt.m_after)}</span></span><span className="shrink-0 font-mono text-[10px] text-slate-500">{timeAgo(receipt.timestamp)} ↗</span></Link>)}</div></Panel>
        <Panel title="Execution path" eyebrow="Tool call graph"><div className="relative flex min-h-[220px] items-center justify-center"><svg viewBox="0 0 360 210" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="Execution path from user through Lex to receipt"><path d="M72 105H142M218 105H288" stroke="rgba(201,168,76,.5)" strokeWidth="2" strokeDasharray="5 5" className="animate-[shimmer_3s_linear_infinite]" /><path d="M180 66V32M180 144V178" stroke="rgba(16,185,129,.35)" strokeWidth="2" strokeDasharray="5 5" /></svg>{[{ label: 'User', left: '20%', top: '50%', translate: 'translate(0,-50%)', color: COLORS.amber }, { label: 'Lex', left: '50%', top: '50%', translate: 'translate(-50%,-50%)', color: COLORS.goldLight }, { label: 'Receipt', left: '80%', top: '50%', translate: 'translate(-100%,-50%)', color: COLORS.teal }, { label: 'MCP / tools', left: '50%', top: '15%', translate: 'translate(-50%,-50%)', color: '#94a3b8' }, { label: 'Replay', left: '50%', top: '85%', translate: 'translate(-50%,-50%)', color: COLORS.blue }].map((node) => <div key={node.label} className="absolute rounded-xl border border-white/10 bg-[#101126] px-3 py-2 text-center shadow-lg" style={{ left: node.left, top: node.top, transform: node.translate }}><div className="text-xs font-bold" style={{ color: node.color }}>{node.label}</div><div className="mt-0.5 font-mono text-[9px] text-slate-500">verified edge</div></div>)}</div><p className="text-xs leading-5 text-slate-500">SVG graph is a runtime topology view. Edge animation indicates execution flow, not a claim that every provider is currently connected.</p></Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <Panel title="Stability history" eyebrow="CRS evidence"><StabilityTrend receipts={receipts} /><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500"><span>M after governance · recent receipts</span><span className="font-mono text-[#e8c96d]">Cryptographic history surface</span></div></Panel>
        <Panel title="Drift heatmap" eyebrow="Governance intensity"><div className="mb-3 flex flex-col gap-2 text-xs text-slate-500 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between"><span>Recent execution windows</span><span className="self-start rounded-full border border-amber-300/20 px-2 py-1 font-mono text-[10px] text-amber-200">{receipts.length ? 'Production snapshots' : 'Demo · no receipts'}</span></div><div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10">{heat.map((value, i) => { const color = value == null ? 'rgba(255,255,255,.07)' : value >= .25 ? 'rgba(16,185,129,.72)' : value >= .15 ? 'rgba(245,158,11,.72)' : 'rgba(239,68,68,.72)'; return <div key={i} title={value == null ? 'No production snapshot' : `CRS snapshot M=${value.toFixed(3)}`} className="aspect-square min-h-7 rounded-md transition hover:scale-110" style={{ background: color }} />; })}</div><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />stable</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />alert</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />critical</span></div></Panel>
        <Panel title="Trajectory replay" eyebrow="Session history"><div className="rounded-xl border border-dashed border-white/10 bg-black/15 p-4"><div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 font-mono text-[10px] font-bold ${sessions.length ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/25 bg-amber-300/10 text-amber-200'}`}>{sessions.length ? 'LIVE SESSIONS' : 'DEMO'}</span><span className="truncate text-xs text-slate-400">{sessions.length ? `${sessions.length} recently active` : 'No session selected'}</span></div><p className="mt-3 text-sm leading-6 text-slate-400">{sessions.length ? 'Select a session in Deep Observability to replay its persisted turns.' : 'Choose a session in Deep Observability to replay persisted turns. This preview never presents fabricated trajectory data as production history.'}</p>{sessions.length > 0 && <div className="mt-3 grid gap-2 min-[420px]:grid-cols-2">{sessions.slice(0, 4).map(session => <Link key={session.session_id} href={`/observability?session=${encodeURIComponent(session.session_id)}`} className="min-w-0 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 transition hover:border-[#c9a84c]/40"><span className="block truncate font-mono text-[10px] text-[#e8c96d]">{session.session_id}</span><span className="mt-1 block text-[10px] text-slate-500">{session.turns} turns</span></Link>)}</div>}<div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">{['Request', 'Evaluate', 'Approve', 'Execute', 'Receipt'].map((step, i) => <div key={step} className="flex shrink-0 items-center gap-2"><div className={`rounded-lg border px-2.5 py-2 text-[10px] font-bold ${i < 2 ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-500'}`}>{step}</div>{i < 4 && <span className="text-slate-600">→</span>}</div>)}</div></div></Panel>
      </div>

      <Panel title="Governance Passport" eyebrow="Trust layer preview" className="mt-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Signed receipts</div><div className="mt-2 font-mono text-xl font-bold text-[#e8c96d]">{receipts.length || '—'}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Verified workflows</div><div className="mt-2 font-mono text-xl font-bold text-emerald-300">{sessions.length || '—'}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Policy version</div><div className="mt-2 font-mono text-xl font-bold text-white">PRAXIS 1.0</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Status</div><div className="mt-2 font-mono text-xl font-bold text-amber-200">Preview</div></div></div><p className="mt-4 text-xs leading-5 text-slate-500">Passport issuance, signed bundles, and workflow attestations are not yet implemented. This surface reports only the live counts available to this page.</p></Panel>
      <Panel title="Event stream" eyebrow="Newest governance activity" className="mt-4"><div className="space-y-2">{receipts.slice(0, 5).map(receipt => <Link key={`event-${receipt.id}`} href={`/receipts/${encodeURIComponent(receipt.id)}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-black/15 px-3 py-3 transition hover:border-[#c9a84c]/30"><span className={`h-2 w-2 shrink-0 rounded-full ${receipt.intervention ? 'bg-amber-300' : 'bg-emerald-300'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{receipt.intervention ? 'Governor intervention recorded' : 'Receipt generated and sealed'}</span><span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{receipt.id} · {receipt.governor_mode ?? receipt.pre_eval_label ?? 'governance decision'}</span></span><span className="shrink-0 font-mono text-[10px] text-slate-500">{timeAgo(receipt.timestamp)}</span></Link>)}{receipts.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-slate-500">No production events available. Demo events are intentionally not fabricated.</div>}</div><div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500"><span>Live source: recent receipts</span><Link href="/observability" className="font-bold text-[#e8c96d]">Open session observability →</Link></div></Panel>

      <div className="mt-4 grid gap-4 sm:grid-cols-3"><Link href="/api-docs" className="rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-indigo-300/30"><div className="font-mono text-[10px] uppercase tracking-widest text-indigo-300">SDK</div><h3 className="mt-2 font-bold text-white">Integrate governance</h3><p className="mt-1 text-xs leading-5 text-slate-500">JavaScript, Python, and Rust installation paths.</p></Link><div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="font-mono text-[10px] uppercase tracking-widest text-amber-200">Passport</div><h3 className="mt-2 font-bold text-white">Governance Passport</h3><p className="mt-1 text-xs leading-5 text-slate-500">Coming Soon · signed history and policy provenance.</p></div><Link href="/observability" className="rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-teal-300/30"><div className="font-mono text-[10px] uppercase tracking-widest text-teal-300">Deep dive</div><h3 className="mt-2 font-bold text-white">Session observability</h3><p className="mt-1 text-xs leading-5 text-slate-500">Filter and replay persisted turns by session ID.</p></Link></div>
    </div>
  </main>;
}

export { COLORS };
