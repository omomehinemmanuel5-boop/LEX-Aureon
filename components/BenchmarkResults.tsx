'use client';

/**
 * BenchmarkResults — live view of the benchmark_results table.
 *
 * Single source of truth: polls GET /api/benchmarks and renders whatever the
 * table holds. No numbers are hardcoded here.
 *   - Empty table  → honest "adversarial evaluation in progress" state (the
 *                     same message the old static strip showed).
 *   - Published    → bare→governed per benchmark, plus over-refusal where a
 *                     benign split exists, with run date / n / judge notes.
 *
 * Re-running a suite and re-publishing updates this automatically on the next
 * poll — on the landing page and the /benchmarks dashboard alike.
 *
 * Props:
 *   compact  — tighter layout for the landing strip (default false).
 *   pollMs   — poll interval; only polls while the tab is visible (default 45s).
 *
 * fix (2026-07-10) — HIGHER/LOWER-IS-BETTER WAS WRONG FOR FOUR OF SEVEN
 * BENCHMARKS: this component hardcoded `better = governed_score <=
 * bare_score` — correct for ASR (AdvBench/HarmBench/JailbreakBench, where
 * lower attack-success is better) but backwards for TruthfulQA, AgentDojo,
 * XSTest, and StrongREJECT, where a HIGHER governed score is the improvement
 * (more truthful, more injection-resistant, more appropriate on benign
 * prompts, more robust refusal). The subhead also said "Lower attack-success
 * is better" as a blanket statement shown even when the page displayed
 * TruthfulQA or AgentDojo results, which aren't attack-success metrics at
 * all. scripts/lexbench/aggregate-report.ts's delta_pp already has the
 * CORRECT sign convention baked in (positive = improvement, regardless of
 * metric direction — see its higherIsBetter() helper) — this component just
 * wasn't using it, and instead re-derived its own (wrong, direction-blind)
 * logic from the raw scores. Now: `better` reads delta_pp's sign directly,
 * and every metric carries an explicit "higher is better" / "lower is
 * better" badge so a first-time visitor doesn't have to infer it.
 *
 * fix (2026-07-10) — also POLL_MS defaults raised (20s → 45s here, 10s → 30s
 * on the /benchmarks page) as a secondary measure alongside the new 60s
 * server-side cache on /api/benchmarks (see that route's 2026-07-10 fix note)
 * — results only change in discrete jumps on publish, continuous fast
 * polling was never buying real freshness.
 */

import { useEffect, useState, useCallback } from 'react';

const GOLD = '#c9a84c';

interface ResultRow {
  id:             number;
  benchmark:      string;
  run_date:       string;
  n_total:        number;
  metric_name:    string;
  bare_score:     number;   // percentage 0–100
  governed_score: number;   // percentage 0–100
  delta_pp:       number;   // sign-normalized: positive = improvement, for EVERY metric
  notes:          string;
  created_at:     string;
}

interface ApiShape {
  ok:        boolean;
  count:     number;
  published: boolean;
  results:   ResultRow[];
  fetched_at?: string;
}

const PRETTY: Record<string, string> = {
  advbench:        'AdvBench',
  harmbench:       'HarmBench',
  jailbreakbench:  'JailbreakBench',
  agentdojo:       'AgentDojo',
  truthfulqa:      'TruthfulQA',
  xstest:          'XSTest',
  strongreject:    'StrongREJECT',
  strong_reject:   'StrongREJECT',
};

function prettyBench(b: string): string {
  return PRETTY[b.toLowerCase()] ?? b;
}

// Every metric name this project currently publishes, mapped to a
// human-readable label and its direction. Matches
// scripts/lexbench/aggregate-report.ts's higherIsBetter()/kindOf() exactly —
// keep these two in sync if a new benchmark/metric is added.
const METRIC_INFO: Record<string, { label: string; higherIsBetter: boolean }> = {
  ASR:                            { label: 'Attack-success rate',        higherIsBetter: false },
  over_refusal:                   { label: 'Over-refusal (benign)',      higherIsBetter: false },
  truthful_pct:                   { label: 'Truthful answer rate',       higherIsBetter: true  },
  injection_resisted_pct_PROXY:   { label: 'Injection resistance (proxy)', higherIsBetter: true },
  appropriate_pct:                { label: 'Appropriate response rate',  higherIsBetter: true  },
  refusal_robustness_pct:         { label: 'Refusal robustness',         higherIsBetter: true  },
};

function metricInfo(metricName: string): { label: string; higherIsBetter: boolean } {
  return METRIC_INFO[metricName] ?? { label: metricName, higherIsBetter: false };
}

function Bar({ value, tone }: { value: number; tone: 'bare' | 'governed' }) {
  const w = Math.max(0, Math.min(100, value));
  const color = tone === 'bare' ? '#ef4444' : '#10b981';
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export default function BenchmarkResults({
  compact = false,
  pollMs = 45000,
}: {
  compact?: boolean;
  pollMs?: number;
}) {
  const [data, setData] = useState<ApiShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/benchmarks');
      const json = (await res.json()) as ApiShape;
      setData(json);
      setErr(null);
      setLastUpdated(new Date());
    } catch (e) {
      setErr(String(e).slice(0, 120));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') load();
      }, pollMs);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    start();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') load();
    });
    return stop;
  }, [load, pollMs]);

  const published = Boolean(data?.published);
  const results = data?.results ?? [];

  // group rows by benchmark, ASR first
  const byBench = new Map<string, ResultRow[]>();
  for (const r of results) {
    const k = r.benchmark.toLowerCase();
    if (!byBench.has(k)) byBench.set(k, []);
    byBench.get(k)!.push(r);
  }
  for (const arr of byBench.values()) {
    arr.sort((a, b) => (a.metric_name === 'ASR' ? -1 : b.metric_name === 'ASR' ? 1 : 0));
  }

  return (
    <div
      className={`w-full border-y border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-[#0d0d1a] ${compact ? 'py-12' : 'py-16'}`}
    >
      <div className="max-w-3xl mx-auto px-5">
        {/* header */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span
            className={`w-1.5 h-1.5 rounded-full animate-pulse ${published ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          <span
            className={`text-xs font-mono uppercase tracking-widest font-bold ${
              published ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {published ? 'Adversarial evaluation — live results' : 'Adversarial evaluation — in progress'}
          </span>
        </div>

        {/* ── Empty / honest state ───────────────────────────────── */}
        {!published && (
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mb-4">
              Benchmarks are being re-run under symmetric judging.
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl mx-auto mb-4">
              The baseline and governed arms are judged by the{' '}
              <span className="font-bold">same</span> external judge on their actual output text —
              attack-success measured over harmful prompts only, over-refusal on benign prompts
              reported separately. Numbers appear here automatically, read live from the results
              table, the moment a scored run is published. No figure is shown before it is earned.
            </p>
            <p className="text-xs font-mono text-slate-400 dark:text-slate-500">
              {loading ? 'Checking results table…' : err ? `Results unavailable (${err})` : 'No scored run published yet.'}
            </p>
          </div>
        )}

        {/* ── Published results ──────────────────────────────────── */}
        {published && (
          <>
            <h2 className={`text-center font-black text-slate-900 dark:text-white mb-2 ${compact ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
              Governed vs ungoverned,{' '}
              <span className="text-slate-400 dark:text-slate-500 font-light">same judge.</span>
            </h2>
            <p className="text-center text-xs font-mono text-slate-400 dark:text-slate-500 mb-8">
              Each metric below is tagged for its own direction — read the badge, not just the bar.
              {lastUpdated ? ` Updated ${lastUpdated.toLocaleTimeString()}.` : ''}
            </p>

            <div className="space-y-4">
              {[...byBench.entries()].map(([bench, rows]) => (
                <div
                  key={bench}
                  className="rounded-2xl border p-5 bg-white dark:bg-[#c9a84c06] border-slate-200 dark:border-[#c9a84c20] shadow-sm dark:shadow-none"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-mono font-black" style={{ color: GOLD }}>
                      {prettyBench(bench)}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      {rows[0]?.run_date} · n={rows[0]?.n_total}
                    </span>
                  </div>

                  {rows.map((r) => {
                    const info = metricInfo(r.metric_name);
                    // delta_pp is ALREADY sign-normalized by the aggregator
                    // (positive = improvement, for every metric direction) —
                    // read it directly rather than re-deriving direction here.
                    const better = r.delta_pp > 0;
                    return (
                      <div key={r.id} className="mb-4 last:mb-0">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                              {info.label}
                            </span>
                            <span
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                              style={{
                                color: info.higherIsBetter ? '#10b981' : '#ef4444',
                                background: info.higherIsBetter ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                border: `1px solid ${info.higherIsBetter ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                              }}
                            >
                              {info.higherIsBetter ? '↑ higher is better' : '↓ lower is better'}
                            </span>
                          </div>
                          <span
                            className={`text-[11px] font-mono font-bold ${
                              better ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                            }`}
                          >
                            {better ? '✓ improved' : '✗ worse'} · Δ {r.delta_pp > 0 ? '+' : ''}{r.delta_pp.toFixed(1)} pp
                          </span>
                        </div>

                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-[11px] font-mono">
                          <span className="text-slate-400 dark:text-slate-500 w-16">ungoverned</span>
                          <Bar value={r.bare_score} tone="bare" />
                          <span className="text-red-500 font-bold w-12 text-right">{r.bare_score.toFixed(1)}%</span>

                          <span className="text-slate-400 dark:text-slate-500 w-16">governed</span>
                          <Bar value={r.governed_score} tone="governed" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold w-12 text-right">{r.governed_score.toFixed(1)}%</span>
                        </div>

                        {!compact && r.notes && (
                          <p className="mt-2 text-[10px] font-mono text-slate-400 dark:text-slate-600 leading-relaxed">
                            {r.notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <p className="text-center text-[11px] font-mono text-slate-400 dark:text-slate-600 mt-6">
              Single source of truth — these figures, the dashboard, and the README all read the
              same results table. Re-running a suite updates them everywhere.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
