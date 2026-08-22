'use client';

import { useEffect, useState } from 'react';
import ConstitutionalPassportGrid from '@/components/lexbench/ConstitutionalPassportGrid';
import { receiptInput, type ReceiptRow } from '@/lib/lexbench/receipt_input';

interface ApiShape {
  ok: boolean;
  published: boolean;
  results: ReceiptRow[];
  stale?: boolean;
}

async function hashRow(row: ReceiptRow): Promise<string> {
  const bytes = new TextEncoder().encode(receiptInput(row));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify page -- looks a receipt hash (or benchmark name) up against the
 * live benchmark_results table via GET /api/benchmarks, the same single
 * source of truth the /benchmarks dashboard reads. No static receipt files.
 *
 * Below the search box, ConstitutionalPassportGrid renders every currently
 * published row as a browsable set of passports.
 */
export default function VerifyPage() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [hashes, setHashes] = useState<Record<number, string>>({});
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/benchmarks');
        const json = (await res.json()) as ApiShape;
        if (cancelled) return;
        const results = json.results || [];
        setRows(results);
        setStale(Boolean(json.stale));
        const pairs = await Promise.all(results.map(async (r) => [r.id, await hashRow(r)] as const));
        if (cancelled) return;
        setHashes(Object.fromEntries(pairs));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = query.trim();
  const match = trimmed
    ? rows.find(
        (r) =>
          hashes[r.id] === trimmed.toLowerCase() ||
          r.benchmark.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : null;

  return (
    <main className="max-w-3xl mx-auto px-5 py-16">
      <h1 className="text-3xl font-black text-slate-900 dark:text-white mb-2">Receipt verification</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        Checks a receipt hash against the live results table -- the same source the{' '}
        <a href="/benchmarks" className="underline">
          /benchmarks
        </a>{' '}
        page reads. Paste a receipt hash, or search by benchmark name.
      </p>

      <input
        className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-3 mb-6 bg-transparent text-sm font-mono"
        placeholder="Receipt hash or benchmark name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {loading && <p className="text-sm text-slate-500 mb-8">Loading...</p>}

      {!loading && trimmed && (
        <div className="mb-10">
          {match ? (
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 p-4 text-sm">
              <div className="font-semibold">
                {match.benchmark} -- {match.metric_name}
              </div>
              <div className="text-slate-500 mt-1">
                {match.run_date} - n={match.n_total}
              </div>
              <div className="mt-2 font-mono text-xs break-all">{hashes[match.id]}</div>
              <div className="mt-2 text-xs">
                {stale ? 'Cached snapshot -- live database temporarily unreachable' : 'Matches the live results table'}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No matching receipt found.</p>
          )}
        </div>
      )}

      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">All published receipts</h2>
      <ConstitutionalPassportGrid />
    </main>
  );
}
