'use client';

import { useEffect, useState } from 'react';
import ConstitutionalPassportGrid from '@/components/lexbench/ConstitutionalPassportGrid';
import { receiptInput, type ReceiptRow } from '@/lib/lexbench/receipt_input';

interface ApiShape { ok: boolean; published: boolean; results: ReceiptRow[]; stale?: boolean; }
async function hashRow(row: ReceiptRow): Promise<string> {
  const bytes = new TextEncoder().encode(receiptInput(row));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function VerifyPage() {
  const [query, setQuery] = useState(''); const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [hashes, setHashes] = useState<Record<number, string>>({}); const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  async function loadReceipts() {
    setLoading(true); setError(false);
    try {
      const res = await fetch('/api/benchmarks', { cache: 'no-store' }); if (!res.ok) throw new Error('request failed');
      const json = await res.json() as ApiShape; const results = json.results ?? [];
      setRows(results); setStale(Boolean(json.stale));
      const pairs = await Promise.all(results.map(async (r) => [r.id, await hashRow(r)] as const)); setHashes(Object.fromEntries(pairs));
    } catch { setError(true); setRows([]); setHashes({}); } finally { setLoading(false); }
  }
  useEffect(() => { void loadReceipts(); }, []);
  const trimmed = query.trim().toLowerCase();
  const match = trimmed ? rows.find((r) => hashes[r.id] === trimmed || r.benchmark.toLowerCase().includes(trimmed)) : null;
  return <main className="mx-auto w-full max-w-3xl overflow-hidden px-4 py-8 sm:px-6 sm:py-16">
    <header className="mb-6"><p className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">Lex Aureon · public proof</p>
      <h1 className="text-2xl font-black leading-tight text-slate-900 dark:text-white sm:text-3xl">Receipt verification</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">Check a receipt hash against the live results table. You can also search by benchmark name.</p></header>
    <label htmlFor="receipt-query" className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-200">Receipt hash or benchmark</label>
    <div className="flex flex-col gap-2 sm:flex-row"><input id="receipt-query" type="search" inputMode="search" autoComplete="off" spellCheck={false} className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700" placeholder="Paste a hash or type a name" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button type="button" onClick={() => setQuery('')} className="min-h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700">Clear</button>}</div>
    <p className="mt-2 text-xs text-slate-500">Hashes are checked locally after the live receipt list loads.</p>
    {loading && <div role="status" className="mt-6 rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">Loading published receipts…</div>}
    {!loading && error && <div role="alert" className="mt-6 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"><span>Receipts could not be loaded right now.</span><button type="button" onClick={() => void loadReceipts()} className="min-h-11 w-full rounded-lg border border-current px-3 font-semibold sm:w-fit">Try again</button></div>}
    {!loading && !error && trimmed && <section aria-live="polite" className="mt-6">{match ? <div className="overflow-hidden rounded-xl border border-emerald-300 bg-emerald-50/50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/20"><div className="break-words font-semibold text-slate-900 dark:text-white">{match.benchmark} <span className="font-normal text-slate-500">— {match.metric_name}</span></div><div className="mt-2 text-slate-500">{match.run_date} · n={match.n_total}</div><div className="mt-3 break-all rounded-lg bg-black/5 p-2 font-mono text-xs dark:bg-white/5">{hashes[match.id]}</div><div className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{stale ? 'Cached snapshot — live database temporarily unreachable' : 'Matches the live results table'}</div></div> : <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">No matching receipt found.</p>}</section>}
    <section className="mt-10"><div className="mb-4 flex items-end justify-between gap-3"><h2 className="text-lg font-bold text-slate-900 dark:text-white">All published receipts</h2><span className="shrink-0 text-xs text-slate-500">{rows.length} total</span></div><div className="min-w-0 overflow-x-auto"><ConstitutionalPassportGrid /></div></section>
  </main>;
}