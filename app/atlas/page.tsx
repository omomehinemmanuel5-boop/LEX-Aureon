'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const pillars = [
  { key: 'C', name: 'Continuity', value: 'State integrity', color: 'var(--c-color)' },
  { key: 'R', name: 'Reciprocity', value: 'Non-coercive exchange', color: 'var(--r-color)' },
  { key: 'S', name: 'Sovereignty', value: 'Boundary integrity', color: 'var(--s-color)' },
];

const surfaces = [
  { title: 'PRAXIS', text: 'Turn-level governance and constitutional arbitration.', href: '/constitution' },
  { title: 'Trajectory', text: 'Plan-level governance across multi-step execution.', href: '/observability' },
  { title: 'Tool Governance', text: 'MCP admission, authorization, interception, and tool receipts.', href: '/api-docs' },
  { title: 'Receipts', text: 'Auditable evidence for governed decisions.', href: '/audit' },
];

type AtlasState = {
  state: {
    session_id: string;
    C: number;
    R: number;
    S: number;
    M: number;
    velocity: number;
    drift_dir: string;
    sigma_viol: number;
    updated_at: string;
  } | null;
  receipts: Array<{
    receipt_id: string;
    session_id: string;
    turn: number;
    m_before: number;
    m_after: number;
    governor_mode: string;
    intervention: boolean;
    created_at: string;
  }>;
};

export default function AtlasPage() {
  const [runtime, setRuntime] = useState<AtlasState | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/atlas/state', { cache: 'no-store' });
        if (!response.ok) throw new Error('runtime unavailable');
        const data = await response.json() as AtlasState;
        if (active) {
          setRuntime(data);
          setRuntimeError(false);
        }
      } catch {
        if (active) setRuntimeError(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const state = runtime?.state;
  const health = state ? (state.M >= 0.25 ? 'OPTIMAL' : state.M >= 0.15 ? 'ALERT' : state.M >= 0.08 ? 'STRESSED' : 'CRITICAL') : 'CONNECTING';

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-8 sm:mb-12">
          <div className="mb-4 flex items-center justify-between gap-4">
            <span className="font-data text-[10px] font-bold tracking-[0.28em]" style={{ color: 'var(--gold-light)' }}>LEX ATLAS · COMMAND CENTER</span>
            <span className="rounded-full border px-3 py-1 font-data text-[10px] tracking-wider" style={{ borderColor: 'rgba(16,185,129,.3)', color: '#34d399', background: 'rgba(16,185,129,.06)' }}>RUNTIME LINKED</span>
          </div>
          <div className="max-w-4xl">
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl">The constitutional map of Lex Aureon.</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              Atlas connects Lex&apos;s constitutional model to runtime governance, trajectory control, tool authorization, receipts, benchmark evidence, and unresolved research problems.
            </p>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
          <div className="rounded-2xl border p-5 sm:p-7" style={{ background: 'linear-gradient(145deg, rgba(201,168,76,.08), var(--bg-card))', borderColor: 'rgba(201,168,76,.18)' }}>
            <div className="mb-6 flex items-center justify-between"><div><div className="font-data text-[10px] tracking-[.2em]" style={{ color: 'var(--text-muted)' }}>CONSTITUTIONAL STATE</div><h2 className="mt-1 text-xl font-bold">C · R · S simplex</h2></div><span className="rounded-full px-2.5 py-1 font-data text-[10px]" style={{ background: 'rgba(16,185,129,.1)', color: '#34d399' }}>OPTIMAL*</span></div>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {pillars.map((p) => {
                const value = state ? state[p.key] : null;
                return <div key={p.key} className="rounded-xl border p-3 sm:p-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,.025)' }}><div className="flex items-baseline justify-between gap-2"><div className="font-data text-2xl font-black" style={{ color: p.color }}>{p.key}</div><div className="font-data text-lg font-bold">{value === null ? '—' : value.toFixed(3)}</div></div><div className="mt-2 text-sm font-semibold">{p.name}</div><div className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>{p.value}</div></div>;
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 font-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span>M = {state ? state.M.toFixed(3) : '—'}</span>
              <span>DRIFT = {state?.drift_dir ?? '—'}</span>
              <span>σ = {state ? state.sigma_viol.toFixed(3) : '—'}</span>
              <span className="rounded-full px-2 py-1" style={{ background: health === 'OPTIMAL' ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)', color: health === 'OPTIMAL' ? '#34d399' : '#fbbf24' }}>{health}</span>
              {runtimeError && <span style={{ color: '#fbbf24' }}>LIVE LINK DEGRADED</span>}
            </div>
          </div>

          <div className="rounded-2xl border p-5 sm:p-7" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="font-data text-[10px] tracking-[.2em]" style={{ color: 'var(--text-muted)' }}>SYSTEM PATH</div>
            <div className="mt-5 space-y-2 font-data text-xs">
              {['REQUEST', 'PRAXIS', 'TRAJECTORY', 'TOOL GOVERNANCE', 'RECEIPT'].map((item, i) => <div key={item} className="flex items-center gap-3"><span className="h-2 w-2 rounded-full" style={{ background: i === 4 ? 'var(--gold)' : '#64748b' }} /><span>{item}</span>{i < 4 && <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>↓</span>}</div>)}
            </div>
            <Link href="/observability" className="mt-6 block rounded-xl border px-4 py-3 text-center text-sm font-semibold transition hover:-translate-y-0.5" style={{ borderColor: 'rgba(201,168,76,.3)', color: 'var(--gold-light)' }}>Open live observability →</Link>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {surfaces.map((surface) => <Link key={surface.title} href={surface.href} className="card-hover rounded-2xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}><div className="font-data text-[10px] tracking-[.18em]" style={{ color: 'var(--gold)' }}>{surface.title}</div><p className="mt-3 text-sm leading-5" style={{ color: 'var(--text-secondary)' }}>{surface.text}</p><span className="mt-5 block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Explore →</span></Link>)}
        </section>

        <section className="mt-6 rounded-2xl border p-5 sm:p-7" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><div className="font-data text-[10px] tracking-[.2em]" style={{ color: 'var(--text-muted)' }}>GOVERNANCE STACK</div><h2 className="mt-1 text-xl font-bold">From constitutional state to accountable action.</h2></div><span className="font-data text-[10px]" style={{ color: 'var(--text-muted)' }}>ATLAS / V1</span></div>
          <div className="overflow-x-auto pb-2"><div className="flex min-w-[720px] items-center gap-2">
            {['CRS', 'PRAXIS', 'TRAJECTORY', 'MCP', 'TOOLS', 'RECEIPTS'].map((node, i) => <div key={node} className="flex flex-1 items-center gap-2"><div className="w-full rounded-xl border px-3 py-4 text-center font-data text-[11px] font-bold" style={{ borderColor: i === 4 ? 'rgba(245,158,11,.35)' : 'var(--border)', background: i === 4 ? 'rgba(245,158,11,.06)' : 'rgba(255,255,255,.02)' }}>{node}</div>{i < 5 && <span style={{ color: 'var(--text-muted)' }}>→</span>}</div>)}
          </div></div>
          <p className="mt-5 max-w-3xl text-xs leading-5" style={{ color: 'var(--text-muted)' }}>Tool governance is deliberately explicit: the constitutional layer governs not only generated text but the admission and authorization boundary around consequential tool execution.</p>
        </section>

        <section className="mt-6 rounded-2xl border p-5 sm:p-7" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="mb-5 flex items-end justify-between gap-4"><div><div className="font-data text-[10px] tracking-[.2em]" style={{ color: 'var(--text-muted)' }}>LIVE EVIDENCE</div><h2 className="mt-1 text-xl font-bold">Recent governance receipts.</h2></div><span className="font-data text-[10px]" style={{ color: 'var(--text-muted)' }}>{runtime?.receipts.length ?? 0} loaded</span></div>
          <div className="space-y-2">
            {runtime?.receipts.map((receipt) => <div key={receipt.receipt_id} className="flex flex-col gap-2 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }}><div className="min-w-0"><div className="font-data text-[10px]" style={{ color: 'var(--gold-light)' }}>{receipt.receipt_id.slice(0, 16)}</div><div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>M {receipt.m_before.toFixed(3)} → {receipt.m_after.toFixed(3)} · {receipt.governor_mode} · {receipt.intervention ? 'intervened' : 'pass-through'}</div></div><div className="font-data text-[10px]" style={{ color: 'var(--text-muted)' }}>{receipt.created_at}</div></div>)}
            {!runtime?.receipts.length && <div className="rounded-xl border p-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Waiting for the first runtime receipt.</div>}
          </div>
          <Link href="/audit" className="mt-4 inline-block text-xs font-semibold" style={{ color: 'var(--gold-light)' }}>Open full audit trail →</Link>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <Link href="/benchmarks" className="rounded-2xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}><div className="font-data text-[10px] tracking-[.18em]" style={{ color: 'var(--text-muted)' }}>EVIDENCE</div><h3 className="mt-2 font-bold">Benchmarks</h3><p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>Evaluation evidence, methodology, and published results.</p></Link>
          <Link href="/research" className="rounded-2xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}><div className="font-data text-[10px] tracking-[.18em]" style={{ color: 'var(--text-muted)' }}>RESEARCH</div><h3 className="mt-2 font-bold">Open Problems</h3><p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>Separate deployed evidence from unresolved analytical claims.</p></Link>
          <Link href="/audit" className="rounded-2xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}><div className="font-data text-[10px] tracking-[.18em]" style={{ color: 'var(--text-muted)' }}>ACCOUNTABILITY</div><h3 className="mt-2 font-bold">Receipts</h3><p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>Trace governed decisions back to their constitutional evidence.</p></Link>
        </section>
      </div>
    </main>
  );
}
