'use client';

    import { useEffect, useState } from 'react';

    interface ResultRow {
    id: number; benchmark: string; metric_name: string;
    bare_score: number; governed_score: number; delta_pp: number;
    run_date: string; n_total: number;
    }
    interface ApiShape { ok: boolean; results: ResultRow[]; stale?: boolean; }

    /**
     * fix (2026-08-23): previously imported data/lexbench-v2.json directly.
     * docs/lexbench-dashboard-integration.md called that "intentional... so
     * benchmark updates propagate automatically" -- that reasoning is
     * incorrect: a static checked-in JSON file only changes when someone
     * hand-edits it, it does not "propagate automatically" from anything.
     * That's the exact misconception behind the passport UI bug fixed
     * elsewhere this session (see components/lexbench/ConstitutionalPassport
     * *.tsx). This component was never actually mounted anywhere live, so
     * no user saw the stale numbers -- but the doc explicitly says to mount
     * it on the landing page, so fixing it now rather than leaving a
     * ready-to-ship component with this bug still in it.
     *
     * Now reads GET /api/benchmarks -- the same single source of truth as
     * /benchmarks and the passport UI (see lib/benchmark_results.ts).
     */
    export default function LexBenchV2Dashboard() {
    const [rows, setRows] = useState<ResultRow[]>([]);
    const [stale, setStale] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch('/api/benchmarks');
          if (!res.ok) throw new Error('benchmarks request failed');
          const json = await res.json() as ApiShape;
          if (cancelled) return;
          setRows(json.results || []);
          setStale(Boolean(json.stale));
        } catch {
          if (!cancelled) setError(true);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    if (loading) return <p className="text-sm text-slate-500">Loading benchmark results…</p>;
    if (error) return <p className="text-sm text-slate-500">Benchmark results are temporarily unavailable.</p>;
    if (rows.length === 0) return <p className="text-sm text-slate-500">No scored run published yet.</p>;

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {stale && <p className="md:col-span-2 text-xs text-amber-500">Showing a cached snapshot — live results are temporarily unreachable.</p>}
        {rows.map((b) => (
          <div key={b.id} className="rounded-2xl border p-4">
            <div className="flex justify-between">
              <h3>{b.benchmark}</h3>
              <span className="text-xs opacity-70">{b.metric_name}</span>
            </div>
            <div className="mt-3 text-sm">
              <div>Bare: {b.bare_score.toFixed(1)}%</div>
              <div>Governed: {b.governed_score.toFixed(1)}%</div>
              <div>Delta: {b.delta_pp > 0 ? '+' : ''}{b.delta_pp.toFixed(1)}pp</div>
              <div>Samples: {b.n_total}</div>
            </div>
          </div>
        ))}
      </div>
    );
    }
    