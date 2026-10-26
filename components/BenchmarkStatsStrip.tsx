"use client";

/**
 * Compact landing-page benchmark strip. Reads the same public endpoint as
 * /benchmarks (/api/benchmarks — "latest scored row per benchmark+metric")
 * so this never drifts from the full results table. Deliberately shows only
 * three of the eight benchmarks:
 *
 *   - HarmBench (ASR, lower is better)
 *   - JailbreakBench (ASR, lower is better)
 *   - TruthfulQA (truthful_pct, higher is better)
 *
 * AgentDojo is excluded here on purpose: its latest published run is n=10
 * and its own notes flag it as a text-judgment proxy, not the official
 * AgentDojo methodology — not a number to headline on the landing page.
 * The over-refusal tradeoff on XSTest (governed scores lower than bare) is
 * also not compressed into a stat card here; it needs the context the full
 * /benchmarks page gives it, not a bare headline number.
 *
 * If a row isn't published yet, or the fetch fails, that card is simply
 * omitted — never a zero or a placeholder, matching the honest-empty-state
 * rule the rest of the benchmark surface follows.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

type BenchmarkRow = {
  benchmark: string;
  metric_name: string;
  n_total: number;
  bare_score: number;
  governed_score: number;
};

type Stat = {
  label: string;
  direction: "lower" | "higher";
  row: BenchmarkRow;
};

const WANTED: Array<{ benchmark: string; metric_name: string; label: string; direction: "lower" | "higher" }> = [
  { benchmark: "HarmBench", metric_name: "ASR", label: "HarmBench attack success", direction: "lower" },
  { benchmark: "JailbreakBench", metric_name: "ASR", label: "JailbreakBench attack success", direction: "lower" },
  { benchmark: "TruthfulQA", metric_name: "truthful_pct", label: "TruthfulQA truthful responses", direction: "higher" },
];

export default function BenchmarkStatsStrip() {
  const [stats, setStats] = useState<Stat[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/benchmarks");
        const data = await res.json().catch(() => null);
        const rows: BenchmarkRow[] = Array.isArray(data?.results) ? data.results : [];
        const found: Stat[] = WANTED
          .map((w) => {
            const row = rows.find((r) => r.benchmark === w.benchmark && r.metric_name === w.metric_name);
            return row ? { label: w.label, direction: w.direction, row } : null;
          })
          .filter((s): s is Stat => s !== null);
        if (active) setStats(found);
      } catch {
        if (active) setStats([]);
      }
    })();
    return () => { active = false; };
  }, []);

  // Still loading, or nothing published — say nothing rather than show a
  // placeholder or a zero.
  if (!stats || stats.length === 0) return null;

  return (
    <section aria-label="Live benchmark results" className="mt-6 rounded-2xl border border-[#c9a84c]/20 bg-[#c9a84c]/[0.04] p-4 sm:mt-7 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-[0.16em] font-bold text-[#e8c96d]">Live benchmark results</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Published comparisons · latest scored row for each metric</p>
        </div>
        <Link href="/benchmarks" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-[#c9a84c]/25 px-3 py-2 text-xs font-bold text-[#e8c96d] transition hover:border-[#e8c96d]/60 hover:bg-white/[0.03]">
          All eight benchmarks <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-slate-400" aria-label="Score legend">
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-500" /> Bare model</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#e8c96d]" /> Lex-governed</span>
        <span>Percentages are metric-specific; direction matters.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.row.benchmark + s.row.metric_name} className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 text-sm font-semibold leading-snug text-slate-200">{s.label}</div>
              <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-slate-400">
                {s.direction === "lower" ? "Lower is better" : "Higher is better"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono">
              <span className="text-sm text-slate-500 line-through decoration-slate-600">{s.row.bare_score.toFixed(1)}%</span>
              <span aria-hidden="true" className="text-xs text-slate-600">→</span>
              <span className="text-2xl font-black tabular-nums text-white">{s.row.governed_score.toFixed(1)}%</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-400">Bare → governed · n={s.row.n_total}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-400">
        These are benchmark-specific results, not a universal safety guarantee. See the <Link href="/benchmarks" className="underline decoration-[#c9a84c]/50 underline-offset-2 hover:text-slate-200">full benchmark table</Link> for methodology, judge details, and limitations.
      </p>
    </section>
  );
}
