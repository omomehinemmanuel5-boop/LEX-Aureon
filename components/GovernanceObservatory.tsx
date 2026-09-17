'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Receipt = {
  id: string;
  session_id?: string;
  turn?: number;
  timestamp: number;
  m_before: number;
  m_after: number;
  governor_mode?: string;
  intervention: boolean;
  pre_eval_label?: string;
  slow_drip?: boolean;
  sigma_viol?: number;
  c_after?: number | null;
  r_after?: number | null;
  s_after?: number | null;
  health_band?: string | null;
  governor_effort?: number;
};

type Metrics = {
  timestamp: string;
  system: { total_calls: number; total_interventions: number; intervention_rate: number; avg_m_before: number; avg_m_after: number; avg_governor_effort: number };
  health_status: string;
};

type State = { C: number | null; R: number | null; S: number | null; M: number | null };
type Session = { session_id: string; last_seen: string; turns: number };
type Aggregate = { total: number; today: number; sessions: number; real: number; latest?: Array<{ receipt_id: string; health_band: string; created_at: string }> };
type Integrity = { sources: Record<string, { status: string; seconds?: number | null; count?: number; endpoint?: string }> };

const COLORS = { gold: '#c9a84c', goldLight: '#e8c96d', blue: '#3b82f6', teal: '#10b981', amber: '#f59e0b', red: '#ef4444', ink: '#07070d' };

function pct(value: number | null | undefined) { return value == null ? '—' : `${Math.round(value * 100)}%`; }
function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
function tone(value: number | null | undefined) { return value == null ? 'muted' : value >= 0.25 ? 'good' : value >= 0.15 ? 'warn' : 'bad'; }
type VerificationStatus = 'idle' | 'checking' | 'valid' | 'tampered' | 'unsigned' | 'legacy_insecure' | 'not_found' | 'unavailable';
function verificationLabel(status: VerificationStatus) {
  return status === 'valid' ? 'VERIFIED' : status === 'tampered' ? 'TAMPERED' : status === 'unsigned' ? 'UNSIGNED' : status === 'legacy_insecure' ? 'LEGACY' : status === 'not_found' ? 'NOT FOUND' : status === 'unavailable' ? 'UNAVAILABLE' : status === 'checking' ? 'CHECKING' : 'VERIFY';
}
function verificationDescription(status: VerificationStatus) {
  return status === 'valid' ? 'Production signature successfully validated.' : status === 'tampered' ? 'Stored signature does not validate against the stored canonical fields.' : status === 'unsigned' ? 'No production signature is available.' : status === 'legacy_insecure' ? 'Historical fallback signing; retained for audit history but not evidence-grade.' : status === 'not_found' ? 'Receipt does not exist.' : status === 'unavailable' ? 'Verification service could not be reached.' : '';
}
function EvidenceBadge({ kind }: { kind: 'LIVE' | 'HISTORICAL' | 'RECONSTRUCTED' | 'DEMO' | 'PLANNED' }) {
  const styles = { LIVE: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200', HISTORICAL: 'border-blue-300/30 bg-blue-300/10 text-blue-200', RECONSTRUCTED: 'border-violet-300/30 bg-violet-300/10 text-violet-200', DEMO: 'border-amber-300/30 bg-amber-300/10 text-amber-200', PLANNED: 'border-white/15 bg-white/5 text-slate-400' };
  return <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] font-bold tracking-wider ${styles[kind]}`}>{kind}</span>;
}

function Gauge({ label, value, color }: { label: string; value: number | null; color: string }) {
  const safe = Math.max(0, Math.min(1, value ?? 0));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return <div className="flex min-w-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.035] p-2.5 text-center sm:flex-1 sm:items-start sm:p-4 sm:text-left">
    <div className="relative h-[64px] w-[64px] shrink-0 sm:h-[94px] sm:w-[94px]">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="42" cy="42" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="7" />
      <circle cx="42" cy="42" r={radius} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - safe)} className="transition-all duration-700 motion-reduce:transition-none" />
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
  const [status, setStatus] = useState<VerificationStatus>('idle');
  const verify = async () => {
    setStatus('checking');
    try {
      const response = await fetch('/api/audits/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt_id: receiptId }) });
      const data = await response.json() as { status?: string };
      setStatus((data.status as typeof status) ?? 'unavailable');
    } catch { setStatus('unavailable'); }
  };
  const label = verificationLabel(status);
  const color = status === 'valid' ? COLORS.teal : status === 'tampered' ? COLORS.red : status === 'idle' ? COLORS.gold : COLORS.amber;
  return <div className="flex min-w-0 shrink-0 flex-col items-end gap-1"><div className="flex items-center gap-1.5"><button type="button" onClick={verify} disabled={status === 'checking'} aria-label={`Verify receipt ${receiptId}`} className="min-h-11 rounded-lg border px-2.5 py-2 font-mono text-[10px] font-bold transition hover:bg-white/5 disabled:opacity-60" style={{ borderColor: `${color}55`, color }}>{label}</button><a href={`/api/audits/${encodeURIComponent(receiptId)}/export`} aria-label={`Export receipt ${receiptId}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/10 px-2 text-xs text-slate-400 transition hover:border-white/25 hover:text-white">↓</a></div>{status !== 'idle' && <span className="max-w-[220px] text-right text-[9px] leading-4 text-slate-500">{verificationDescription(status)}</span>}</div>;
}

function StabilityTrend({ receipts }: { receipts: Receipt[] }) {
  const values = receipts.slice().reverse().map(receipt => receipt.m_after).filter(value => Number.isFinite(value));
  const points = values.map((value, index) => `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${100 - Math.max(0, Math.min(1, value)) * 100}`).join(' ');
  return <div className="relative h-36 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2" role="img" aria-label={`Stability margin trend across ${values.length} recent receipts`}><div className="pointer-events-none absolute inset-x-2 top-2 border-t border-white/5" /><div className="pointer-events-none absolute inset-x-2 top-1/2 border-t border-white/5" /><div className="pointer-events-none absolute inset-x-2 bottom-2 border-t border-white/5" />{values.length > 0 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><polyline points={points} fill="none" stroke={COLORS.goldLight} strokeWidth="2.5" vectorEffect="non-scaling-stroke" /><polyline points={`0,100 ${points} 100,100`} fill="rgba(201,168,76,.10)" stroke="none" /></svg> : <div className="flex h-full items-center justify-center text-xs text-slate-500">No persisted M history available</div>}<div className="absolute bottom-2 left-3 font-mono text-[9px] text-slate-500">older</div><div className="absolute bottom-2 right-3 font-mono text-[9px] text-slate-500">newer</div></div>;
}

type ReplayEvent = { id: string; turn: number; m_before: number; m_after: number; governor_mode: string; intervention: boolean; slow_drip?: boolean; governor_effort?: number; sigma_viol?: number; created_at: string; pre_eval_label?: string };
function SessionReplay({ sessions }: { sessions: Session[] }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.session_id ?? '');
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { if (!sessionId) return; void fetch(`/api/observability/timeline?session_id=${encodeURIComponent(sessionId)}&limit=100`).then(response => response.ok ? response.json() : Promise.reject()).then(data => { setEvents((data.events ?? []) as ReplayEvent[]); setCursor(0); }).catch(() => { setEvents([]); setCursor(0); }); }, [sessionId]);
  useEffect(() => { if (!playing || events.length < 2) return; const timer = setInterval(() => setCursor(index => index >= events.length - 1 ? 0 : index + 1), 900); return () => clearInterval(timer); }, [playing, events.length]);
  const current = events[cursor];
  return <Panel title="Trajectory replay" eyebrow="Historical replay — reconstructed from persisted evidence" className="mt-4"><div className="flex flex-wrap gap-2">{sessions.length ? sessions.slice(0, 6).map(session => <button type="button" key={session.session_id} onClick={() => { setSessionId(session.session_id); setPlaying(false); }} className={`min-h-11 max-w-full truncate rounded-lg border px-3 py-2 font-mono text-[10px] ${sessionId === session.session_id ? 'border-[#c9a84c]/50 bg-[#c9a84c]/10 text-[#e8c96d]' : 'border-white/10 text-slate-400'}`}>{session.session_id.slice(0, 18)} · {session.turns}</button>) : <span className="text-xs text-slate-500">No persisted sessions available.</span>}</div><div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">{current ? <><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs font-bold text-white">Turn {current.turn} · {current.governor_mode}</span><EvidenceBadge kind="HISTORICAL" /></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><span className="rounded-lg bg-white/5 p-2 text-[10px] text-slate-400">M {current.m_before.toFixed(3)} → {current.m_after.toFixed(3)}</span><span className="rounded-lg bg-white/5 p-2 text-[10px] text-slate-400">{current.intervention ? 'Intervention' : 'Constitutional pass'}</span><span className="rounded-lg bg-white/5 p-2 text-[10px] text-slate-400">{current.pre_eval_label ?? 'Label unavailable'}</span><span className="rounded-lg bg-white/5 p-2 text-[10px] text-slate-400">{new Date(current.created_at).toLocaleTimeString()}</span><span className="rounded-lg bg-white/5 p-2 text-[10px] text-slate-400">Slow-drip {current.slow_drip ? 'YES' : 'NO'}</span><span className="rounded-lg bg-white/5 p-2 text-[10px] text-slate-400">Effort {current.governor_effort?.toFixed(4) ?? '—'} · σ {current.sigma_viol?.toFixed(4) ?? '—'}</span></div><p className="mt-3 text-[11px] text-slate-500">Replay reconstructed from persisted governance receipts. Receipt: <span className="font-mono text-slate-300">{current.id}</span>. Raw request, model, and tool/action payloads are not persisted in this timeline response.</p></> : <p className="text-xs text-slate-500">Select a session to load persisted turns.</p>}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!events.length} onClick={() => setCursor(0)} className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">First</button><button type="button" disabled={!events.length} onClick={() => setCursor(index => Math.max(0, index - 1))} className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={events.length < 2} onClick={() => setPlaying(value => !value)} className="min-h-11 rounded-lg border border-[#c9a84c]/40 px-3 py-2 text-xs text-[#e8c96d] disabled:opacity-40">{playing ? 'Pause' : 'Play'}</button><button type="button" disabled={!events.length} onClick={() => setCursor(index => Math.min(events.length - 1, index + 1))} className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Next</button><button type="button" disabled={!events.length} onClick={() => setCursor(events.length - 1)} className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40">Last</button></div></Panel>;
}

export default function GovernanceObservatory() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      fetch('/api/audits/recent?limit=8').then(async response => response.ok ? await response.json() as { receipts?: Receipt[] } : Promise.reject()),
      fetch('/api/observability/metrics').then(async response => response.ok ? await response.json() as Metrics : Promise.reject()),
      fetch('/api/live-state').then(async response => response.ok ? await response.json() as { state?: State } : Promise.reject()),
      fetch('/api/observability/sessions?limit=6').then(async response => response.ok ? await response.json() as { sessions?: Session[] } : Promise.reject()),
      fetch('/api/observatory').then(async response => response.ok ? await response.json() as Aggregate : Promise.reject()),
      fetch('/api/observatory/integrity').then(async response => response.ok ? await response.json() as Integrity : Promise.reject()),
    ]);
    const [recent, metricData, stateData, sessionData, aggregateData, integrityData] = results;
    if (recent.status === 'fulfilled') setReceipts(recent.value.receipts ?? []);
    if (metricData.status === 'fulfilled') setMetrics(metricData.value);
    if (stateData.status === 'fulfilled') setState(stateData.value.state ?? null);
    if (sessionData.status === 'fulfilled') setSessions(sessionData.value.sessions ?? []);
    if (aggregateData.status === 'fulfilled') setAggregate(aggregateData.value);
    if (integrityData.status === 'fulfilled') setIntegrity(integrityData.value);
    setError(results.some(result => result.status === 'rejected'));
    setLastUpdated(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('receipt');
    if (requested) setSelectedReceipt(receipts.find(receipt => receipt.id === requested) ?? null);
  }, [receipts]);

  const heat = useMemo(() => receipts.slice(0, 42).map(receipt => receipt.m_after), [receipts]);
  const health = metrics?.health_status ?? 'NO DATA';
  const healthColor = health === 'OPTIMAL' ? COLORS.teal : health === 'CRITICAL' ? COLORS.red : COLORS.amber;

  return <main className="min-h-screen overflow-x-hidden bg-[#07070d] text-slate-200">
    <div className="mx-auto max-w-7xl px-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))] pt-24 sm:px-6 sm:pb-14 lg:px-8">
      <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[.12em] text-[#e8c96d] sm:tracking-[.16em]"><span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#e8c96d]" /> Live governance surface</div><h1 className="max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">Governance <span className="text-gold">Observatory</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">A verifiable execution history for constitutional decisions, receipts, and runtime state.</p></div>
        <div className="flex flex-col items-stretch gap-1.5 sm:items-end"><div className="grid grid-cols-2 gap-2 sm:flex"><Link href="/console" className="flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#c9a84c] to-[#e8c96d] px-3 py-3 text-center text-[11px] font-bold text-[#07070d] shadow-[0_8px_24px_rgba(201,168,76,.18)] transition hover:brightness-110 active:scale-[0.97] sm:px-4 sm:text-xs">Run a governed action</Link><button type="button" onClick={() => void load()} disabled={refreshing} aria-busy={refreshing} className="min-h-11 rounded-xl border border-white/15 px-3 py-3 text-xs font-bold text-slate-200 transition hover:border-white/30 hover:text-white active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:px-4">{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>{lastUpdated && <span className="font-mono text-[10px] text-slate-500">Updated {timeAgo(lastUpdated)}</span>}</div>
      </header>

      <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.025] p-3 sm:p-4"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-[#e8c96d]">Evidence legend</span><EvidenceBadge kind="LIVE" /><EvidenceBadge kind="HISTORICAL" /><EvidenceBadge kind="RECONSTRUCTED" /><EvidenceBadge kind="DEMO" /><EvidenceBadge kind="PLANNED" /></div><p className="mt-2 text-[11px] leading-5 text-slate-500">LIVE is current telemetry. HISTORICAL is persisted evidence. RECONSTRUCTED is derived from persisted records; DEMO and PLANNED are never production claims.</p></section>
      {error && <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"><span>Some live sources are unavailable. The Observatory will keep the last known state.</span><button type="button" onClick={() => void load()} className="self-start rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-bold sm:self-auto">Retry</button></div>}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <Panel title="Constitutional state" eyebrow="Live CRS dashboard"><div className="grid grid-cols-3 gap-2 sm:flex sm:gap-4">{loading ? [COLORS.blue, COLORS.teal, COLORS.amber].map((color, index) => <div key={color} className="flex min-w-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.035] p-2.5 sm:flex-1 sm:items-start sm:p-4"><div className="h-16 w-16 animate-pulse rounded-full border-[7px] border-white/10 sm:h-[94px] sm:w-[94px]" style={{ borderTopColor: color }} /><div className="mt-2 h-3 w-16 animate-pulse rounded bg-white/10" /><span className="sr-only">Loading pillar {index + 1}</span></div>) : <><Gauge label="Continuity" value={state?.C ?? null} color={COLORS.blue} /><Gauge label="Reciprocity" value={state?.R ?? null} color={COLORS.teal} /><Gauge label="Sovereignty" value={state?.S ?? null} color={COLORS.amber} /></>}</div><div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#c9a84c]/20 bg-black/20 px-3 py-3"><span className="text-xs text-slate-400">Stability margin <span className="font-mono text-white">M = min(C,R,S)</span></span><span className="shrink-0 font-mono text-sm font-bold" style={{ color: tone(state?.M) === 'good' ? COLORS.teal : tone(state?.M) === 'warn' ? COLORS.amber : COLORS.red }}>{loading ? '…' : pct(state?.M)}</span></div></Panel>
        <Panel title="System pulse" eyebrow="Last 30 minutes"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Governed calls</div><div className="mt-2 font-mono text-2xl font-bold text-white">{loading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-white/10" /> : metrics?.system.total_calls ?? '—'}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Interventions</div><div className="mt-2 font-mono text-2xl font-bold text-amber-300">{loading ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-white/10" /> : metrics?.system.total_interventions ?? '—'}</div></div></div><div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3"><span className="text-xs text-slate-400">Health band</span><span className="font-mono text-xs font-bold" style={{ color: healthColor }}>{loading ? 'SYNCING' : health}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-400">Intervention rate</span><span className="font-mono text-xs text-white">{metrics ? `${(metrics.system.intervention_rate * 100).toFixed(1)}%` : '—'}</span></div></Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <Panel title="Receipt replay" eyebrow="Immutable execution history" className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{receipts.length ? `${receipts.length} recent receipts` : 'No receipts returned'}</span><div className="flex items-center gap-3"><Link href="/audit" className="font-bold text-[#e8c96d] hover:text-white">Open audit index →</Link>{receipts[0] && <ReceiptActions receiptId={receipts[0].id} />}</div></div><div className="space-y-2">{receipts.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">No production receipts available yet. Run the console to create a real replay.</div>}{receipts.map((receipt) => <Link href={`/observatory?receipt=${encodeURIComponent(receipt.id)}`} key={receipt.id} className="group flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-black/15 p-3 transition hover:border-[#c9a84c]/40 hover:bg-[#c9a84c]/5"><span className={`h-2 w-2 shrink-0 rounded-full ${receipt.intervention ? 'bg-amber-300' : 'bg-emerald-300'}`} /><span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs font-bold text-slate-200 group-hover:text-white">{receipt.id}</span><span className="mt-1 block text-[11px] text-slate-500">{receipt.intervention ? 'Governor intervention' : 'Constitutional pass'} · M {pct(receipt.m_after)}</span></span><span className="shrink-0 font-mono text-[10px] text-slate-500">{timeAgo(receipt.timestamp)} ↗</span></Link>)}</div></Panel>
        <Panel title="Execution path" eyebrow="Topology / conceptual"><div className="relative flex min-h-[220px] items-center justify-center"><svg viewBox="0 0 360 210" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="Conceptual execution topology"><path d="M72 105H142M218 105H288" stroke="rgba(201,168,76,.5)" strokeWidth="2" strokeDasharray="5 5" className="animate-[shimmer_3s_linear_infinite]" /><path d="M180 66V32M180 144V178" stroke="rgba(16,185,129,.35)" strokeWidth="2" strokeDasharray="5 5" /></svg>{[{ label: 'User', left: '20%', top: '50%', translate: 'translate(0,-50%)', color: COLORS.amber }, { label: 'Lex', left: '50%', top: '50%', translate: 'translate(-50%,-50%)', color: COLORS.goldLight }, { label: 'Receipt', left: '80%', top: '50%', translate: 'translate(-100%,-50%)', color: COLORS.teal }, { label: 'MCP / tools', left: '50%', top: '15%', translate: 'translate(-50%,-50%)', color: '#94a3b8' }, { label: 'Replay', left: '50%', top: '85%', translate: 'translate(-50%,-50%)', color: COLORS.blue }].map((node) => <div key={node.label} className="absolute rounded-xl border border-white/10 bg-[#101126] px-3 py-2 text-center shadow-lg" style={{ left: node.left, top: node.top, transform: node.translate }}><div className="text-xs font-bold" style={{ color: node.color }}>{node.label}</div><div className="mt-0.5 font-mono text-[9px] text-slate-500">conceptual edge</div></div>)}</div><p className="text-xs leading-5 text-slate-500">This topology is illustrative. Current backend evidence establishes receipts and sessions, not every provider relationship or external-system call.</p></Panel>
      </div>

      {selectedReceipt && <Panel title="Governance evidence" eyebrow="Receipt inspection" className="mt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><EvidenceBadge kind="HISTORICAL" /><h3 className="mt-2 break-all font-mono text-sm font-bold text-white">{selectedReceipt.id}</h3><p className="mt-1 text-xs text-slate-500">{new Date(selectedReceipt.timestamp).toISOString()} · session {selectedReceipt.session_id ?? 'unavailable'} · turn {selectedReceipt.turn ?? '—'}</p></div><div className="flex items-center gap-2"><ReceiptActions receiptId={selectedReceipt.id} /><Link href={`/receipts/${encodeURIComponent(selectedReceipt.id)}`} className="min-h-11 rounded-lg border border-[#c9a84c]/30 px-3 py-2 font-mono text-[10px] font-bold text-[#e8c96d]">Open raw evidence</Link></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Before</div><div className="mt-1 font-mono text-sm text-white">M {selectedReceipt.m_before.toFixed(3)}</div><div className="mt-1 text-[10px] text-slate-500">Source: persisted governance receipt</div></div><div className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Governance signal</div><div className="mt-1 font-mono text-sm text-[#e8c96d]">{selectedReceipt.pre_eval_label ?? 'Unavailable'}</div><div className="mt-1 text-[10px] text-slate-500">Pre-evaluation label recorded</div></div><div className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Governor response</div><div className="mt-1 font-mono text-sm text-white">{selectedReceipt.governor_mode ?? 'Unavailable'}</div><div className="mt-1 text-[10px] text-slate-500">Intervention: {selectedReceipt.intervention ? 'YES' : 'NO'} · effort {selectedReceipt.governor_effort?.toFixed(4) ?? '—'}</div></div><div className="rounded-lg border border-[#c9a84c]/20 bg-[#c9a84c]/5 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">After</div><div className="mt-1 font-mono text-sm text-white">M {selectedReceipt.m_after.toFixed(3)}</div><div className="mt-1 text-[10px] text-slate-500">C {selectedReceipt.c_after?.toFixed(3) ?? '—'} · R {selectedReceipt.r_after?.toFixed(3) ?? '—'} · S {selectedReceipt.s_after?.toFixed(3) ?? '—'}</div></div></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400"><span>{selectedReceipt.intervention ? 'Governance intervention recorded.' : 'Constitutional pass recorded.'}</span><span>Slow-drip: {selectedReceipt.slow_drip ? 'YES' : 'NO'}</span><span>σ violation: {selectedReceipt.sigma_viol?.toFixed(4) ?? 'Unavailable'}</span><span>Evidence: receipt fields + verification endpoint</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">{[['Request','CONCEPTUAL'],['Evaluate','DERIVED'],['Govern','DERIVED'],['Execute','CONCEPTUAL'],['Receipt','DIRECT'],['Verify','DIRECT']].map(([step, evidence], index) => <div key={step} className={`rounded-lg border px-2 py-2 ${index >= 4 ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-400'}`}><div className="text-[10px] font-bold">{step}</div><div className="mt-1 font-mono text-[8px] tracking-wider">{evidence}</div></div>)}</div><p className="mt-3 text-[11px] leading-5 text-slate-500">The receipt directly evidences persisted governance fields. Evaluate and Govern are derived from those fields; Request and complete Execute payloads are not persisted here.</p></Panel>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <Panel title="Stability history" eyebrow="CRS evidence"><StabilityTrend receipts={receipts} /><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500"><span>M after governance · recent receipts</span><span className="font-mono text-[#e8c96d]">Receipt-backed stability history</span></div><p className="mt-2 text-[10px] text-slate-500">Historical points are derived from persisted receipts; cryptographic verification is exposed per receipt.</p></Panel>
        <Panel title="Drift heatmap" eyebrow="Governance intensity"><div className="mb-3 flex flex-col gap-2 text-xs text-slate-500 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between"><span>Recent execution windows</span><span className="self-start rounded-full border border-amber-300/20 px-2 py-1 font-mono text-[10px] text-amber-200">{receipts.length ? 'Production snapshots' : 'Demo · no receipts'}</span></div><div className="overflow-x-auto sm:overflow-visible"><div className="grid grid-flow-col grid-rows-3 auto-cols-[1.75rem] gap-1.5 pb-1 sm:grid-flow-row sm:grid-rows-none sm:auto-cols-auto sm:grid-cols-10 sm:pb-0">{heat.map((value, i) => { const color = value == null ? 'rgba(255,255,255,.07)' : value >= .25 ? 'rgba(16,185,129,.72)' : value >= .15 ? 'rgba(245,158,11,.72)' : 'rgba(239,68,68,.72)'; return <button type="button" key={receipts[i]?.id ?? `heat-${i}`} title={value == null ? 'No production snapshot' : `Select ${receipts[i]?.id ?? 'receipt'} · M=${value.toFixed(3)}`} aria-label={value == null ? 'No production snapshot' : `Select receipt ${receipts[i]?.id ?? i + 1}`} onClick={() => receipts[i] && setSelectedReceipt(receipts[i])} className="h-7 w-7 shrink-0 rounded-md transition hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#e8c96d] sm:h-auto sm:w-auto sm:aspect-square sm:min-h-7" style={{ background: color }} />; })}</div></div><p className="mt-2 text-[10px] text-slate-500 sm:hidden">Swipe to see all {heat.length} windows</p><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />stable</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />alert</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />critical</span></div></Panel>
        <Panel title="Governance lifecycle" eyebrow="Session history"><div className="rounded-xl border border-dashed border-white/10 bg-black/15 p-4"><div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 font-mono text-[10px] font-bold ${sessions.length ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/25 bg-amber-300/10 text-amber-200'}`}>{sessions.length ? 'LIVE SESSIONS' : 'DEMO'}</span><span className="truncate text-xs text-slate-400">{sessions.length ? `${sessions.length} recently active` : 'No session selected'}</span></div><p className="mt-3 text-sm leading-6 text-slate-400">{sessions.length ? 'Select a session in Deep Observability to replay its persisted turns.' : 'Choose a session in Deep Observability to replay persisted turns. This preview never presents fabricated trajectory data as production history.'}</p>{sessions.length > 0 && <div className="mt-3 grid gap-2 min-[420px]:grid-cols-2">{sessions.slice(0, 4).map(session => <Link key={session.session_id} href={`/observability?session=${encodeURIComponent(session.session_id)}`} className="min-w-0 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 transition hover:border-[#c9a84c]/40"><span className="block truncate font-mono text-[10px] text-[#e8c96d]">{session.session_id}</span><span className="mt-1 block text-[10px] text-slate-500">{session.turns} turns</span></Link>)}</div>}<div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">{['Request', 'Evaluate', 'Approve', 'Execute', 'Receipt'].map((step, i) => <div key={step} className="flex shrink-0 items-center gap-2"><div className={`rounded-lg border px-2.5 py-2 text-[10px] font-bold ${i < 2 ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-500'}`}>{step}</div>{i < 4 && <span className="text-slate-600">→</span>}</div>)}</div></div></Panel>
      </div>

      <SessionReplay sessions={sessions} />
      <Panel title="Observatory integrity" eyebrow="Evidence infrastructure" className="mt-4"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[['Receipt store', 'receipt_store'], ['Session telemetry', 'session_persistence'], ['Verification API', 'verification_api'], ['Live state', 'live_state'], ['Telemetry freshness', 'telemetry_freshness']].map(([label, key]) => { const source = integrity?.sources[key]; const status = source?.status ?? 'UNKNOWN'; return <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3"><span className="text-xs text-slate-400">{label}</span><span className={`font-mono text-[10px] font-bold ${status === 'HEALTHY' ? 'text-emerald-300' : 'text-slate-500'}`}>{key === 'telemetry_freshness' && source?.seconds != null ? `${source.seconds}s` : status}</span></div>; })}</div><p className="mt-3 text-[10px] text-slate-500">UNKNOWN means the backend did not establish health; it is never presented as HEALTHY.</p></Panel>
      <Panel title="Governance Passport" eyebrow="Trust layer" className="mt-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Receipts · 30d</div><div className="mt-2 font-mono text-xl font-bold text-[#e8c96d]">{aggregate?.real || '—'}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Sessions · 30d</div><div className="mt-2 font-mono text-xl font-bold text-emerald-300">{aggregate?.sessions || '—'}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Today</div><div className="mt-2 font-mono text-xl font-bold text-white">{aggregate?.today || '—'}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">Issuance</div><div className="mt-2 font-mono text-xl font-bold text-amber-200">Planned</div></div></div><p className="mt-4 text-xs leading-5 text-slate-500">Counts are live from the Observatory aggregate. Signed bundles, policy provenance, and independently verifiable passport URLs remain the next backend milestone.</p></Panel>
      <Panel title="Event stream" eyebrow="Newest governance activity" className="mt-4"><div className="space-y-2">{receipts.slice(0, 5).map(receipt => <Link key={`event-${receipt.id}`} href={`/receipts/${encodeURIComponent(receipt.id)}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-black/15 px-3 py-3 transition hover:border-[#c9a84c]/30"><span className={`h-2 w-2 shrink-0 rounded-full ${receipt.intervention ? 'bg-amber-300' : 'bg-emerald-300'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{receipt.intervention ? 'Governor intervention recorded' : 'Receipt generated and sealed'}</span><span className="mt-1 block truncate font-mono text-[10px] text-slate-500">{receipt.id} · {receipt.governor_mode ?? receipt.pre_eval_label ?? 'governance decision'}</span></span><span className="shrink-0 font-mono text-[10px] text-slate-500">{timeAgo(receipt.timestamp)}</span></Link>)}{receipts.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-slate-500">No production events available. Demo events are intentionally not fabricated.</div>}</div><div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500"><span>Live source: recent receipts</span><Link href="/observability" className="font-bold text-[#e8c96d]">Open session observability →</Link></div></Panel>

      <div className="mt-4 grid gap-4 sm:grid-cols-3"><Link href="/api-docs" className="rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-indigo-300/30"><div className="font-mono text-[10px] uppercase tracking-widest text-indigo-300">SDK</div><h3 className="mt-2 font-bold text-white">Integrate governance</h3><p className="mt-1 text-xs leading-5 text-slate-500">JavaScript, Python, and Rust installation paths.</p></Link><div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="font-mono text-[10px] uppercase tracking-widest text-amber-200">Passport</div><h3 className="mt-2 font-bold text-white">Governance Passport</h3><p className="mt-1 text-xs leading-5 text-slate-500">Coming Soon · signed history and policy provenance.</p></div><Link href="/observability" className="rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-teal-300/30"><div className="font-mono text-[10px] uppercase tracking-widest text-teal-300">Deep dive</div><h3 className="mt-2 font-bold text-white">Session observability</h3><p className="mt-1 text-xs leading-5 text-slate-500">Filter and replay persisted turns by session ID.</p></Link></div>
    </div>
  </main>;
}

export { COLORS };
