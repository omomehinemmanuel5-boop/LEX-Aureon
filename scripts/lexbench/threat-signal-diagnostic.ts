/**
 * threat-signal-diagnostic.ts
 *
 * fix (2026-08-12): prompt_threat_signal (governance_service.ts's validated
 * harm-vs-benign reference-centroid contrast — see lib/benign_reference_prompts.ts's
 * 2026-07-18 anisotropy fix) has been captured into each row's provenance since
 * 2026-08-11, but nothing ever printed it. It was only ever wired as a soft
 * nudge to constitutional-state text (lib/sovereign_kernel.ts transduce), never
 * as a refusal gate in lib/refusal_decision.ts — which depends entirely on the
 * separate, hand-picked identity/coercion/exploitative/harm_request archetype
 * classifier (harm_request currently disabled, see README Known Operational
 * Limitations).
 *
 * This script exists so any run that mixes benchmarks with different known
 * ground truth — JailbreakBench/StrongREJECT (harmful) vs XSTest (benign) —
 * shows, in one table, whether this already-validated signal actually
 * separates the two distributions. That is the real evidence needed before
 * wiring it into a real gate, instead of guessing a threshold the way
 * harm_request did twice (2026-07-26, reverted 2026-08-11).
 *
 * Originally embedded inline in lexbench-attack-arms.yml's "Classifier evasion
 * diagnostic" step. Extracted to a real .ts file (2026-08-12) after that
 * embedding produced two separate bash single-quote-escaping bugs in one
 * comment block, caught only by an explicit `bash -n` check — a real .ts file
 * gets the differential TypeScript parse gate on every edit instead, which is
 * a much narrower way to reintroduce that exact class of bug. Also makes the
 * check reusable by lexbench-extended.yml (XSTest/StrongREJECT), which had no
 * equivalent instrumentation at all until this run surfaced that gap.
 *
 * Usage: npx tsx scripts/lexbench/threat-signal-diagnostic.ts <path-to-jsonl>
 * Never fails the run — always exits 0, even on missing/empty input.
 */

import * as fs from 'fs';

interface DiagnosticRow {
  benchmark?: string;
  prompt_id?: string;
  id?: string;
  prompt?: string;
  governed_output?: string;
  provenance?: { prompt_threat_signal?: number | null };
  bare_metrics?: { xstest_appropriate?: number | null };
  governed_metrics?: { xstest_appropriate?: number | null };
}

function main(): void {
  const path = process.argv[2] ?? 'all_results.jsonl';

  if (!fs.existsSync(path) || fs.statSync(path).size === 0) {
    console.log(`threat-signal-diagnostic: no rows to analyse (${path} missing or empty)`);
    return;
  }

  const rows: DiagnosticRow[] = fs.readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as DiagnosticRow; }
      catch { return null; }
    })
    .filter((r): r is DiagnosticRow => r !== null);

  type Stats = { n: number; withSignal: number; sum: number; min: number; max: number };
  const byBench: Record<string, Stats> = {};

  for (const r of rows) {
    const b = r.benchmark ?? 'unknown';
    const ts = typeof r.provenance?.prompt_threat_signal === 'number'
      ? r.provenance.prompt_threat_signal
      : null;
    if (!byBench[b]) byBench[b] = { n: 0, withSignal: 0, sum: 0, min: Infinity, max: -Infinity };
    byBench[b].n++;
    if (ts !== null) {
      byBench[b].withSignal++;
      byBench[b].sum += ts;
      byBench[b].min = Math.min(byBench[b].min, ts);
      byBench[b].max = Math.max(byBench[b].max, ts);
    }
  }

  console.log('');
  console.log('--- prompt_threat_signal by benchmark (harmful vs benign check) ---');
  for (const [b, s] of Object.entries(byBench)) {
    const avg = s.withSignal ? (s.sum / s.withSignal).toFixed(3) : 'n/a';
    const min = s.withSignal ? s.min.toFixed(3) : 'n/a';
    const max = s.withSignal ? s.max.toFixed(3) : 'n/a';
    console.log(`${b}: n=${s.n} withSignal=${s.withSignal} avg=${avg} min=${min} max=${max}`);
  }

  const total = rows.length;
  const totalWithSignal = Object.values(byBench).reduce((a, s) => a + s.withSignal, 0);
  if (totalWithSignal === 0 && total > 0) {
    console.log('');
    console.log(`⚠ 0/${total} rows had a prompt_threat_signal value — check that the govern`);
    console.log('  API response actually includes it and runner.ts is capturing it.');
  }

  // fix (2026-08-12): mirrors the "classifier blind spot" printout that
  // lexbench-attack-arms.yml already has for JailbreakBench compliance, but
  // for XSTest over-refusal — bare answered appropriately (1), governed
  // over-refused (0) on the exact same prompt. Printing prompt_threat_signal
  // alongside each one answers a specific question: if threatSignal is ALSO
  // elevated on these, it has the same over-refusal failure mode harm_request
  // did and isn't safe to gate on without more work; if it stays low, these
  // regressions are coming from somewhere else entirely (the 3 residual
  // TruthfulQA flat refusals already on the Roadmap are the likely match).
  const xstestRegressions = rows.filter(r =>
    r.bare_metrics?.xstest_appropriate === 1 && r.governed_metrics?.xstest_appropriate === 0
  );
  if (xstestRegressions.length > 0) {
    console.log('');
    console.log('--- XSTest over-refusal: bare answered, governed refused ---');
    for (const r of xstestRegressions.slice(0, 40)) {
      const ts = r.provenance?.prompt_threat_signal;
      console.log(`[${r.prompt_id ?? r.id ?? '?'}] threat_signal=${typeof ts === 'number' ? ts.toFixed(3) : 'n/a'}`);
      console.log(`   prompt : ${String(r.prompt ?? '').slice(0, 110)}`);
      console.log(`   output : ${String(r.governed_output ?? '').slice(0, 110)}`);
    }
  }
}

main();
