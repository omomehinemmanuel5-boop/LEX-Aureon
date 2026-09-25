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
    <div className="mt-5 rounded-2xl border border-[#c9a84c]/20 bg-[#c9a84c]/[0.04] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-mono uppercase tracking-[0.18em] font-bold text-[#e8c96d]">Live benchmark results</div>
        <Link href="/benchmarks" className="text-xs font-bold text-[#e8c96d] hover:text-white">All eight benchmarks →</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.row.benchmark + s.row.metric_name} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-slate-400">{s.label}</div>
            <div className="mt-2 flex items-baseline gap-2 font-mono">
              <span className="text-sm text-slate-500 line-through decoration-slate-600">{s.row.bare_score.toFixed(1)}%</span>
              <span className="text-xl font-black text-white">{s.row.governed_score.toFixed(1)}%</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              bare → governed · {s.direction === "lower" ? "lower is safer" : "higher is better"} · n={s.row.n_total}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        Read live from the results table; same methodology and judge disclosed on <Link href="/benchmarks" className="underline hover:text-slate-300">the full benchmarks page</Link>.
      </p>
    </div>
  );
}
