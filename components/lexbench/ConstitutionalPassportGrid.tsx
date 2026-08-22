'use client';

import { useEffect, useState } from 'react';
import ConstitutionalPassport from './ConstitutionalPassport';
import { receiptInput, type ReceiptRow } from '@/lib/lexbench/receipt_input';

interface ApiShape {
  ok: boolean;
  published: boolean;
  results: ReceiptRow[];
  stale?: boolean;
}

// Keep in sync with components/BenchmarkResults.tsx's METRIC_INFO -- that
// file documents the direction/label source of truth and the convention of
// duplicating this small map rather than sharing an import (see its header
// note re: scripts/lexbench/aggregate-report.ts's higherIsBetter()).
const METRIC_INFO: Record<string, { label: string; higherIsBetter: boolean }> = {
  ASR: { label: 'Attack-success rate', higherIsBetter: false },
  over_refusal: { label: 'Over-refusal (benign)', higherIsBetter: false },
  truthful_pct: { label: 'Truthful answer rate', higherIsBetter: true },
  injection_resisted_pct_PROXY: { label: 'Injection resistance (proxy)', higherIsBetter: true },
  appropriate_pct: { label: 'Appropriate response rate', higherIsBetter: true },
  strong_reject_harm_pct: { label: 'Harm score (SR formula)', higherIsBetter: false },
  refusal_robustness_pct: { label: 'Refusal robustness (retired)', higherIsBetter: true },
};

function metricInfo(name: string): { label: string; higherIsBetter: boolean } {
  return METRIC_INFO[name] || { label: name, higherIsBetter: false };
}

async function hashRow(row: ReceiptRow): Promise<string> {
  const bytes = new TextEncoder().encode(receiptInput(row));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Reads the live benchmark_results table via GET /api/benchmarks -- the
 * same single source of truth the /benchmarks dashboard reads. No static
 * receipt files, no separately-maintained manifest. A passport for a
 * benchmark only appears once a real row has been published; empty table
 * renders an honest empty state, never a placeholder card.
 *
 * receiptHash is computed client-side (Web Crypto SHA-256) over
 * lib/lexbench/receipt_input.ts's receiptInput() of the row -- a stable
 * digest of what is actually published, not a claim of external
 * verification. A stale (cached-fallback) response is shown as a cached
 * snapshot, never as verified -- see app/api/benchmarks/route.ts's
 * LAST_KNOWN_GOOD note for when that path is taken.
 */
export default function ConstitutionalPassportGrid() {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [hashes, setHashes] = useState<Record<number, string>>({});
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
      } catch (e) {
        if (!cancelled) setErr(String(e).slice(0, 120));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading receipts...</p>;
  }

  if (err) {
    return <p className="text-sm text-slate-500">Receipts unavailable ({err}).</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No scored run published yet. No passport is shown before it is earned.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((r) => {
        const info = metricInfo(r.metric_name);
        return (
          <ConstitutionalPassport
            key={r.id}
            benchmark={r.benchmark}
            metricLabel={info.label}
            higherIsBetter={info.higherIsBetter}
            runDate={r.run_date}
            nTotal={r.n_total}
            bareScore={r.bare_score}
            governedScore={r.governed_score}
            deltaPp={r.delta_pp}
            receiptHash={hashes[r.id] || 'computing'}
            generatedAt={r.created_at}
            verified={!stale}
            stale={stale}
          />
        );
      })}
    </div>
  );
}
