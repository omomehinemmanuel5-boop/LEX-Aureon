/**
 * scripts/tool-governance/injection-eval.ts
 *
 * Evaluates the tool-call injection detector against the labeled corpus
 * (injection-corpus.ts), using the ACTUAL production scoring path exported
 * from lib/agents/tool_crs.ts (matchInjectionRegex + injectionSimilarity) —
 * not a re-derivation, so the numbers track what the interceptor really does.
 *
 * It answers the question the tool_crs.ts header keeps flagging: the semantic
 * threshold (0.85) was set from 4 data points; is that the right cut, and what
 * are its precision/recall? Reports three things:
 *
 *   1. Regex layer (deterministic, no network): recall on injections,
 *      false-positive rate on benign. Runs everywhere, no provider keys.
 *   2. Semantic layer standalone: sweeps the threshold 0.70–0.95 and reports
 *      precision / recall / F1 at each, marking the current 0.85 and the
 *      F1-optimal cut. Needs an embedding provider (Gemini/Jina/Mistral key).
 *   3. Deployed pipeline (regex OR semantic ≥ t): the real behavior — a call
 *      is flagged if EITHER layer fires. Metrics at 0.85 and best-F1.
 *
 * The hard subset (keyword-dodging injections + security-topic benign, marked
 * hard:true in the corpus) is reported separately — that's what separates a
 * real detector from one that only catches the obvious phrasings.
 *
 * Run:
 *   npx tsx scripts/tool-governance/injection-eval.ts            # full (needs embed key)
 *   npx tsx scripts/tool-governance/injection-eval.ts --regex-only   # deterministic, no network
 *   npx tsx scripts/tool-governance/injection-eval.ts --json out.jsonl
 *
 * Nothing here writes to production state or publishes anywhere; it prints a
 * report. Record a full run's recommended threshold in research/ before
 * changing SEMANTIC_INJECTION_THRESHOLD.
 */
import {
  matchInjectionRegex, injectionSimilarity, extractFreeText,
  SEMANTIC_INJECTION_THRESHOLD, INJECTION_ARCHETYPES,
} from '../../lib/agents/tool_crs';
import { INJECTION_CORPUS, type CorpusItem } from './injection-corpus';

interface Scored extends CorpusItem {
  regexHit: string | null;
  similarity: number;
  degraded: boolean;
}

interface Metrics { tp: number; fp: number; tn: number; fn: number; precision: number; recall: number; f1: number; accuracy: number; }

function metrics(rows: { positive: boolean; predicted: boolean }[]): Metrics {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) {
    if (r.positive && r.predicted) tp++;
    else if (!r.positive && r.predicted) fp++;
    else if (!r.positive && !r.predicted) tn++;
    else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = rows.length ? (tp + tn) / rows.length : 0;
  return { tp, fp, tn, fn, precision, recall, f1, accuracy };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
const line = (m: Metrics) =>
  `P ${pct(m.precision)}  R ${pct(m.recall)}  F1 ${pct(m.f1)}  acc ${pct(m.accuracy)}   (TP ${m.tp} FP ${m.fp} TN ${m.tn} FN ${m.fn})`;

function argsFor(text: string) { return { content: text }; } // model a tool call's free-text field

async function main() {
  const argv = process.argv.slice(2);
  const regexOnly = argv.includes('--regex-only');
  const jsonPath = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : undefined;
  // Throttle between embedding calls. Without a Turso cache each corpus item is
  // a live embed; firing all ~48 in a burst rate-limited the provider and
  // degraded most of the run (Run 004). A small delay keeps it under per-minute
  // limits. 0 disables (e.g. when a warm cache makes it moot).
  const delayMs = argv.includes('--delay') ? Number(argv[argv.indexOf('--delay') + 1]) : 600;

  const nInj = INJECTION_CORPUS.filter((c) => c.label === 'injection').length;
  const nBen = INJECTION_CORPUS.filter((c) => c.label === 'benign').length;
  console.log(`Injection detector eval — corpus: ${INJECTION_CORPUS.length} (${nInj} injection, ${nBen} benign; ${INJECTION_CORPUS.filter((c) => c.hard).length} hard)`);
  console.log(`Archetypes: ${INJECTION_ARCHETYPES.length} · current SEMANTIC_INJECTION_THRESHOLD = ${SEMANTIC_INJECTION_THRESHOLD}\n`);

  // Score every item through the real production functions.
  const scored: Scored[] = [];
  let degradedCount = 0;
  for (const item of INJECTION_CORPUS) {
    const args = argsFor(item.text);
    const regexHit = matchInjectionRegex(JSON.stringify(args));
    let similarity = 0, degraded = false;
    if (!regexOnly) {
      const s = await injectionSimilarity(extractFreeText(args));
      similarity = s.similarity; degraded = s.degraded;
      if (degraded) degradedCount++;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    scored.push({ ...item, regexHit, similarity, degraded });
  }

  // ── 1. Regex layer (deterministic) ──────────────────────────────────────
  const regexRows = scored.map((s) => ({ positive: s.label === 'injection', predicted: s.regexHit !== null }));
  console.log('── 1. Regex fast-pass (deterministic, no network) ──');
  console.log('   ' + line(metrics(regexRows)));
  const regexCaughtInj = scored.filter((s) => s.label === 'injection' && s.regexHit);
  console.log(`   catches ${regexCaughtInj.length}/${nInj} injections outright; the rest are the semantic layer's job.\n`);

  if (regexOnly || degradedCount === INJECTION_CORPUS.length) {
    console.log(regexOnly
      ? 'Semantic layer skipped (--regex-only). Re-run without the flag (embedding key set) for the threshold sweep.'
      : `Semantic layer unavailable — all ${degradedCount} embedding calls degraded (no reachable provider). Regex-only report above.`);
    if (jsonPath) await dump(jsonPath, scored);
    return;
  }

  // ── 2. Semantic layer standalone: threshold sweep ───────────────────────
  const usable = scored.filter((s) => !s.degraded);
  console.log(`── 2. Semantic layer standalone — threshold sweep (${usable.length} usable, ${degradedCount} degraded excluded) ──`);
  const sweep: { t: number; m: Metrics }[] = [];
  for (let t = 0.70; t <= 0.951; t += 0.01) {
    const tt = Math.round(t * 100) / 100;
    const rows = usable.map((s) => ({ positive: s.label === 'injection', predicted: s.similarity >= tt }));
    sweep.push({ t: tt, m: metrics(rows) });
  }
  const bestF1 = sweep.reduce((a, b) => (b.m.f1 > a.m.f1 ? b : a));
  const atCurrent = sweep.find((s) => Math.abs(s.t - SEMANTIC_INJECTION_THRESHOLD) < 1e-9);
  for (const { t, m } of sweep) {
    const marks = [t === bestF1.t ? '← best F1' : '', atCurrent && t === atCurrent.t ? '← current' : ''].filter(Boolean).join('  ');
    console.log(`   t=${t.toFixed(2)}  ${line(m)}   ${marks}`);
  }

  // Score separation — the thing that actually determines whether ANY clean cut exists.
  const injSims = usable.filter((s) => s.label === 'injection').map((s) => s.similarity);
  const benSims = usable.filter((s) => s.label === 'benign').map((s) => s.similarity);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const max = (a: number[]) => (a.length ? Math.max(...a) : 0);
  const min = (a: number[]) => (a.length ? Math.min(...a) : 0);
  console.log(`\n   injection sim: mean ${mean(injSims).toFixed(3)}  min ${min(injSims).toFixed(3)}  max ${max(injSims).toFixed(3)}`);
  console.log(`   benign    sim: mean ${mean(benSims).toFixed(3)}  min ${min(benSims).toFixed(3)}  max ${max(benSims).toFixed(3)}`);
  console.log(`   separation (min-inj − max-benign): ${(min(injSims) - max(benSims)).toFixed(3)} ` +
    `${min(injSims) > max(benSims) ? '→ a clean threshold exists' : '→ clusters OVERLAP; no threshold separates them perfectly'}`);

  // ── 3. Deployed pipeline (regex OR semantic ≥ t) ────────────────────────
  console.log('\n── 3. Deployed pipeline (regex OR semantic ≥ t) ──');
  const pipeAt = (t: number) => metrics(scored.map((s) => ({
    positive: s.label === 'injection',
    predicted: s.regexHit !== null || (!s.degraded && s.similarity >= t),
  })));
  console.log(`   @ current ${SEMANTIC_INJECTION_THRESHOLD.toFixed(2)}: ${line(pipeAt(SEMANTIC_INJECTION_THRESHOLD))}`);
  console.log(`   @ best-F1 ${bestF1.t.toFixed(2)}: ${line(pipeAt(bestF1.t))}`);

  // ── Hard subset ─────────────────────────────────────────────────────────
  const hard = scored.filter((s) => s.hard && !s.degraded);
  if (hard.length) {
    const hardPipe = metrics(hard.map((s) => ({
      positive: s.label === 'injection',
      predicted: s.regexHit !== null || s.similarity >= SEMANTIC_INJECTION_THRESHOLD,
    })));
    console.log(`\n── Hard subset (${hard.length}: keyword-dodging inj + security-topic benign) @ current threshold, deployed pipeline ──`);
    console.log('   ' + line(hardPipe));
    const missed = hard.filter((s) => s.label === 'injection' && !s.regexHit && s.similarity < SEMANTIC_INJECTION_THRESHOLD);
    const falsePos = hard.filter((s) => s.label === 'benign' && (s.regexHit || s.similarity >= SEMANTIC_INJECTION_THRESHOLD));
    if (missed.length) console.log(`   MISSED injections (${missed.length}): ` + missed.map((s) => `[${s.tag} sim=${s.similarity.toFixed(3)}]`).join(' '));
    if (falsePos.length) console.log(`   FALSE positives (${falsePos.length}): ` + falsePos.map((s) => `[${s.tag} ${s.regexHit ? 'regex' : 'sim=' + s.similarity.toFixed(3)}]`).join(' '));
  }

  console.log('\nNote: corpus is author-labeled and modest (dozens, not thousands). Treat the recommended' +
    '\nthreshold as evidence to review, not an auto-apply. If clusters overlap, the honest fix is' +
    '\nbetter archetypes / a second signal, not just moving the cut. Widen the corpus and re-run.');

  if (jsonPath) await dump(jsonPath, scored);
}

async function dump(path: string, scored: Scored[]) {
  const fs = await import('node:fs');
  fs.writeFileSync(path, scored.map((s) => JSON.stringify(s)).join('\n') + '\n');
  console.log(`\nRaw scored rows → ${path}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
