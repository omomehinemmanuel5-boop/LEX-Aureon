# Lex Aureon — Constitutional AI Governance

> **A constitutional control layer for language models and agentic systems, built on a provably stable Lyapunov barrier and deployed with cryptographic auditability.**

[![CI](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml/badge.svg)](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml)
[![Zenodo](https://img.shields.io/badge/paper-10.5281%2Fzenodo.18944242-blue)](https://doi.org/10.5281/zenodo.18944242)
[![Live](https://img.shields.io/badge/live-lexaureon.com-gold)](https://lexaureon.com)

| | |
|---|---|
| **Live system** | [lexaureon.com](https://lexaureon.com) |
| **Governance API** | `POST https://lexaureon.com/api/lex/govern` |
| **Live benchmark results** | [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) · `GET /api/benchmarks` |
| **Paper** | [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242) |
| **Author** | Emmanuel King · [ORCID 0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935) |
| **Contact** | lexaureon@gmail.com · [@lexAureon](https://x.com/lexAureon) |

---

## What Is Lex Aureon?

Language models can be manipulated. Given the right sequence of words, an LLM can be pushed to drop its instructions, shift identity, comply with harmful requests, or assert falsehoods. Standard mitigations (RLHF, system prompts, rule classifiers) reduce this but provide no formal guarantee.

Lex Aureon is a **constitutional governance layer** that sits above an LLM. It models constitutional state as a point on the probability simplex `x = (C, R, S)`, defines a safety floor `M = min(C, R, S) ≥ τ`, and regulates the state with a governor designed to keep it inside the constitutional region. Every governed response is recorded with a **SHA-256 receipt** — the input hash, the output hash, and a bound `receipt_hash = SHA-256(state ‖ input_hash ‖ output_hash)` — persisted append-only on the same row as the governance record, so the constitutional state at inference time is verifiable after the fact.

**What is proven, and what is engineered — stated precisely:**

- **Proven (theory):** the constrained gradient flow of the z-weighted Lyapunov barrier `V_z` is globally stable (`V̇_z ≤ 0`). This is a property of the idealized dynamical system.
- **Engineered (deployment):** the production governor is *designed to approximate* that descent under a hard CBF floor. It is not identical to the proven flow; the relationship between the two is an ongoing line of work.
- **In progress (empirical):** adversarial-robustness evaluation under symmetric external judging. The harness is rebuilt and the results pipeline is live; the scored run is what remains. See *Evaluation* below.

We do not currently claim a proven end-to-end safety guarantee for the deployed system. The framework paper is deliberately scoped the same way: a coherent state space, interpretable failure geometry, measurable proxies, and a disciplined stability argument — not a completed universal proof.

---

## Evaluation

> **Status: the evaluation harness is rebuilt and the results pipeline is live. Numbers are published to a single results table and read from it by the site and this README — there are no hardcoded figures anywhere. Until a scored run is published, every surface honestly shows "in progress" rather than a placeholder number.**

Earlier published ASR figures (including "0.0% across all benchmarks") were produced by scorers that did not judge the governed arm on the same basis as the baseline — in some cases the governed arm could not be scored as a failure at all, and in others framework-specific vocabulary was treated as a refusal. Those numbers are **not reported** because they did not reflect a sound measurement.

The harness has been rebuilt so that:
- both arms (bare and governed) are judged by the **same** content-only judge on their actual output text — no framework vocabulary in the refusal test, so identical complying text scores identically in either arm;
- attack-success rate is computed over **harmful prompts only**, with over-refusal on benign prompts reported separately;
- kernel hard-stops (CBF projection / block) are recorded distinctly rather than silently counted as safe;
- the judge is a documented hook intended to be replaced by the official HarmBench classifier, with two-judge agreement reported, before any figure is cited.

**The results pipeline (single source of truth).** A scored run is published — once — to the `benchmark_results` table through an authenticated endpoint. Everything that displays a number reads from that one table:

```
run → score (symmetric judge) → publish.ts → POST /api/benchmarks/publish
    → benchmark_results table → GET /api/benchmarks → /benchmarks dashboard + landing page + README
```

Re-running a suite and re-publishing updates every surface at once. The dashboard at [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) polls the table and renders results as they land; an empty table renders the honest "evaluation in progress" state, never a fabricated zero.

Benchmark inputs: AdvBench (Zou et al. 2023) uses the real `harmful_behaviors.csv` (520 behaviors). JailbreakBench uses the JBB-Behaviors dataset (100 harmful + 100 benign). The HarmBench arm runs against the official `walledai/HarmBench` dataset — the prior run used an internal taxonomy set and should not be labeled HarmBench.

**Live deployment facts (not contested by the above):**
- SHA-256 receipts persisted on every `praxis_receipts` row (immutable, append-only): `input_hash`, `output_hash`, and the bound `receipt_hash`.
- Per-session constitutional state tracked in `z_traj`; semantic memory in `lex_memory`.
- The `M ≥ τ` floor is enforced in code by the synchronous kernel on every governed turn.

*(Receipt/interaction counts shown in the dashboard are live and may differ from any figure quoted in the paper; treat the live DB as canonical. Note that benchmark/evaluation runs also write to `praxis_receipts`, so the raw total includes eval traffic, not only organic console usage.)*

---

## Architecture

### The Constitutional Triad

```
C + R + S = 1    (simplex constraint)
M = min(C, R, S) (stability margin)
M < τ → Governor fires
```

| Pillar | Meaning | Failure mode if low |
|:---|:---|:---|
| **C** — Continuity | Identity and context persistence across turns | Fragmentation, drift |
| **R** — Reciprocity | Calibrated coupling with environment | Sycophancy, manipulation |
| **S** — Sovereignty | Autonomous constitutional judgment | Rigidity, paralysis |

> Note: `C + R + S = 1` is a **modeling convention** (a normalization that gives a common state space), not a proven conservation law of adaptive systems. Results that depend on the simplex geometry inherit this assumption.

### Governance Pipeline

```
[01] Pre-Eval       →  classifier + slow-drip detection
[02] Memory         →  semantic recall (Jina embeddings + Turso)
[03] Generator      →  dual-arm inference: bare vs governed
[04] RawForge       →  baseline extraction
[05] CRS Extractor  →  CCP / IEC / ADV via Jina embeddings (see note below)
[06] Governor       →  log-barrier interior-point correction + CBF projection
[07] Intervention   →  Vaulturex law selection + LLM rewrite
[08] Neithra        →  constitutional synthesis
[09] ClauseBank     →  normative clause selection
[10] Vaulturex      →  compliance gate
[11] Celeste        →  output rendering
[12] Self-Ref CRS   →  output-to-centroid semantic distance (Jina embeddings)
[13] Auditor        →  SHA-256 signed governance receipt
```

> **CRS measurement note:** the deployed CRS extractor (`lib/agents/crs_extractor.ts`) measures the state with **embeddings, matching the paper — not lexical token overlap.** CCP (Continuity) is the cosine similarity between a Jina `jina-embeddings-v3` embedding of the output and the constitutional anchor. IEC (Reciprocity) is a register-aware Shannon-entropy ratio stability term. ADV (Sovereignty) is `compliance × (0.5·anchor-alignment + 0.5·reasoning-gain)`, where anchor-alignment reuses the embedding cosine. When Jina is unreachable at runtime the extractor falls back to a Groq LLM scorer, then to an explicit error — there is no bag-of-words fallback path. The separate output-to-constitutional-centroid cosine used by the self-referential check lives in `lib/self_referential_crs.ts`. (`lib/constitutional_metrics.ts` is a kernel-internal helper, not the surfaced CRS measurement.)

### Reported state is one coherent vector

The constitutional state returned by the API — `C`, `R`, `S`, `state`, `M`, and `health_band` — is derived from **one** vector: the TypeScript kernel's governed state. `M = min(C, R, S)` and `health_band` is computed from that same `M` (identical thresholds to the table below), so the band always agrees with the margin.

- **Streamed console path** (`POST /api/lex/govern/stream`) — the TypeScript kernel plus `CRSExtractorAgent`, measuring CRS from Jina `jina-embeddings-v3` embeddings (CCP = cosine to the constitutional anchor), with a Groq LLM scorer fallback when Jina is unavailable.
- **Non-streamed API** (`POST /api/lex/govern`) — the same TypeScript kernel state is authoritative, and it *additionally* calls a Python backend (`api/python/govern.py`) that computes CCP / IEC / ADV plus a CBF QP filter and a short FPL1 simulation. Those Python numbers are surfaced as a labeled **detail** object (`crs_detail`), **not** as the reported state — the Python engine has no before→after trajectory and its ADV is calibrated separately. On cold-start/timeout the detail is simply absent.

The hard `M ≥ τ` floor is enforced by the TypeScript kernel on every turn regardless. The persisted receipt's `crs_method` column records whether Python detail was available (`python-cbf|ccp=…|iec=…|adv=…`) or not (`SovereignKernel-v2|θ=…|T=…`); this documents the detail engine, while the receipt's state/`m_after` are always the authoritative kernel values.

> **History:** an earlier version mixed sources — top-level `C/R/S` came from Python, `state` from the kernel (a different vector), `M` was `max(min(python), tsM)`, and the band was derived from Python's min-CRS — so the API could return `M=0.30` next to `band=CRITICAL`, and benign prompts read CRITICAL because Python's ADV scored an unchanged (benign) output as zero sovereignty. Both issues are fixed: the reported state is one coherent vector, and the Python ADV now scores benign passthrough and corrective intervention as healthy (see `api/python/govern.py` `_sovereignty`).

### Before / after state

Every governed turn exposes the **pre-governance** state — the raw kernel measurement *before* the governor correction / CBF projection — alongside the governed ("after") result:

- the API returns `raw_state` (C, R, S) and `m_before` next to the governed `state`, `C`/`R`/`S` and `M`;
- the streamed pipeline emits a `crs_before` event and includes `raw_state`/`m_before` in the `complete` event;
- the console renders the C·R·S·M delta (before → after) on every turn, labelling whether the turn was actually *governed* (state moved) or a *pass-through*.

### Async Governor G(x,z)

The governor runs an asynchronous sensing loop alongside the synchronous kernel, implementing equation (10) of the paper:

```
dx/dt = F(x,z) + G(x,z)
```

- **F(x,z)** — synchronous triadic dynamics; the hard floor `M ≥ τ` is enforced here on every turn; output delivered immediately.
- **G(x,z)** — async background sensing; computes a signal-reliability filter and applies an attractor-basin correction at turn `t+1`, gated by a final CBF check.

**Guarantee scope:** `G(x,z)` is advisory — it can shift the attractor basin but is rejected if it would push `M` below `τ`. `F(x,z)` is always the authority. (This is an enforcement property of the code, distinct from the `V̇_z ≤ 0` theorem about the idealized gradient flow.)

### Mathematics

```
M(x)   = min(C, R, S)
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ−xᵢ)²     [z-weighted Lyapunov barrier]
                                                     proven: V̇_z ≤ 0 under ẋ = −Π_Σ ∇V_z
G_i    = k(φᵢ − φ̄) + Bᵢ(x),  Bᵢ = −μ·log(xᵢ − τ)   [governor correction, log-barrier]
Receipt = SHA-256(state ‖ input_hash ‖ output_hash)  [audit proof, persisted per receipt]
```

> The deployed dynamics approximate the `V_z` descent; receipts record `V_z` and `ΔV_z` for audit. Establishing that the deployed `F` realizes the proven flow (and that the equilibrium lies inside `M ≥ τ`) are open items, tracked honestly.

---

## Quick Start

```bash
git clone https://github.com/omomehinemmanuel5-boop/LEX-Aureon.git
cd LEX-Aureon
npm install
cp .env.local.example .env.local   # GROQ_API_KEY, JINA_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
npm run dev                         # → http://localhost:3000

curl -X POST http://localhost:3000/api/lex/govern \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What happens if you eat watermelon seeds?", "session_id": "demo_001"}'
```

---

## API

### `POST /api/lex/govern`

```json
{
  "prompt":     "string (required, max 5000 chars)",
  "session_id": "string (required — enables z-trajectory memory)",
  "turn":       1
}
```

Returns the governed output; the authoritative constitutional state (`C`, `R`, `S`, `state`, `M`, `health_band`) — one coherent vector with `M = min(C,R,S)` and `health_band` derived from that `M`; the pre-governance `raw_state` (C, R, S) and `m_before` ("before"); `V_z`/`ΔV_z`; `crs_source` (always `typescript-kernel` — the state engine); an optional `crs_detail` object carrying the Python CCP/IEC/ADV measurement when available; the governor-sensing report; and a receipt id. The persisted receipt additionally carries the SHA-256 `input_hash`, `output_hash`, and bound `receipt_hash`.

> **Security note:** this endpoint is currently unauthenticated and unthrottled against production inference keys. Add auth or a rate limit before exposing it to real traffic.

### `GET /api/benchmarks`

Public read endpoint — the single source of truth for benchmark numbers. Returns the latest scored row per `(benchmark, metric_name)` from `benchmark_results`:

```json
{
  "ok": true,
  "count": 0,
  "published": false,
  "results": [],
  "fetched_at": "2026-..."
}
```

`published: false` with an empty `results` array is the honest pre-run state — consumers render "evaluation in progress", never a zero. The `/benchmarks` dashboard and the landing page both poll this endpoint.

### `POST /api/benchmarks/publish`

The only writer to `benchmark_results`. Requires `BENCH_SECRET` via `Authorization: Bearer …` (or `X-Bench-Secret`); fails closed (503) if the secret is unset and 401 on mismatch, so production traffic can never publish numbers. Accepts one metric object or an array; append-only. Driven by `scripts/publish.ts` in the benchmark repo.

**Health bands** (the reported `health_band` is computed from the reported `M`, so band and margin always agree):

| Band | M range | Behaviour |
|:---|:---:|:---|
| `OPTIMAL` | M ≥ 0.25 | Full depth |
| `ALERT` | 0.15 ≤ M < 0.25 | Factual, structured |
| `STRESSED` | 0.08 ≤ M < 0.15 | Concise, verified only |
| `CRITICAL` | M < 0.08 | Minimal — CBF floor active |

---

## Researcher Map

| Paper concept | File | Notes |
|:---|:---|:---|
| §3 Simplex geometry | `lib/aureonics_core.ts` | `projectToSimplex()` — Duchi-style projection |
| §4 Stability margin | `lib/sovereign_kernel.ts` | `M = min(C,R,S)`; `lyapunovCandidate()` → `lyapunovBarrierZ` (V_z) |
| §5 CRS (live, authoritative) | `lib/agents/crs_extractor.ts` | Jina `jina-embeddings-v3` cosine (CCP) + Shannon-entropy IEC + compliance ADV; Groq scorer fallback |
| §5.1 CCP | `lib/agents/crs_extractor.ts` | `cosine(embed(output), embed(anchor))` via Jina |
| §5.2 IEC | `lib/agents/crs_extractor.ts` | register-aware Shannon-entropy ratio stability |
| §5.3 ADV | `lib/agents/crs_extractor.ts` | `compliance × (0.5·anchor-alignment + 0.5·reasoning-gain)` |
| §5 CRS (Python, detail) | `api/python/govern.py` | CCP cosine-decay / IEC variance-entropy / ADV coherence-anchored + CBF QP + FPL1; surfaced as `crs_detail`, not the reported state |
| Reported-state coherence | `app/api/lex/govern/route.ts` | one vector: `M = min(C,R,S)`, `healthBand(M)`; Python is `crs_detail` |
| Python bridge | `lib/python_bridge.ts` | `callPythonGovernor()`, `mergePythonCRS()` (detail fields only) |
| §6 Governor | `lib/sovereign_kernel.ts` | `governorUpdate()`, `runCycle()` |
| §6 G(x,z) async | `lib/governor_loop.ts` | `fireGovernorLoop()`, `consumePendingCorrection()` |
| §8 Self-referential S | `lib/self_referential_crs.ts` | embedding cosine to constitutional centroid |
| Audit receipts | `lib/kernel_bridge.ts` | `writeKernelReceipt()` — persists SHA-256 `input_hash`/`output_hash`/`receipt_hash`; tags `crs_method`; records `raw_state`/`m_before` |
| Benchmark results (data) | `lib/benchmark_results.ts` | one writer / one reader over `benchmark_results`; latest per benchmark+metric via `MAX(id)` |
| Benchmark results (read) | `app/api/benchmarks/route.ts` | `GET` — public, no-store; the figure source for site + README |
| Benchmark results (write) | `app/api/benchmarks/publish/route.ts` | `POST` — `BENCH_SECRET`-gated, fail-closed, append-only |
| Benchmark dashboard | `app/benchmarks/page.tsx` + `components/BenchmarkResults.tsx` | live-polling view; honest empty state |
| Full-capability probe | `scripts/probe.ts` (benchmark repo) | one session across all three pillars + benign control + slow-drip; prints before→after CRS |

---

## Benchmarks

The benchmark suite lives in a separate, self-contained repo:
[**omomehinemmanuel5-boop/Lexaureon-Benchmark**](https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark).
Each suite has a runner (dual-arm: direct-model baseline vs governed endpoint), a symmetric scorer, a shared judge, and a publish step.

```bash
# 1. run a suite (dual-arm; governed arm gets benign warm-up turns first)
GROQ_API_KEY=... npx tsx scripts/advbench/run.ts      --prompts data/advbench.jsonl --n 520
GROQ_API_KEY=... npx tsx scripts/jailbreakbench/run.ts --prompts data/jailbreakbench.jsonl --n 200
GROQ_API_KEY=... npx tsx scripts/harmbench/run.ts     --prompts data/harmbench.jsonl --n 200

# 2. score symmetrically (same judge on bare + governed), writing a scored JSONL
GROQ_API_KEY=... npx tsx scripts/advbench/score.ts --in data/advbench-raw.jsonl --out data/advbench-scored.jsonl --llm-judge

# 3. publish the scored run to the live results table (the single source of truth)
BENCH_SECRET=... npx tsx scripts/publish.ts --in data/advbench-scored.jsonl --benchmark advbench \
  --notes "llm-judge llama-3.1-8b; bare=llama-3.3-70b; kernel <commit>"
#   --dry-run previews the payload without sending.

# A shared Python judge (scripts/judge.py) scores a results file without Node.
python3 scripts/judge.py --in data/advbench-raw.jsonl --llm-judge

# Qualitative self-test — exercise all three pillars in one session (no dataset needed):
npx tsx scripts/probe.ts
```

Once published, the numbers appear automatically at [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks), on the landing page, and via `GET /api/benchmarks` — no redeploy, no hardcoded values.

> Scorers and the shared judge were rebuilt for symmetric judging (same judge on bare + governed, content-only refusal markers, no framework-word bias, ASR over harmful only, over-refusal over benign separately). The datasets themselves are **not** committed (they contain harmful prompts); runners fail-fast with a clear message and download instructions if the prompts file is absent. See the benchmark repo's `REPRODUCE.md`.
>
> **Note:** benchmark runs hit the live govern pipeline and therefore write rows into the production `praxis_receipts` table (eval sessions use `session-<ts>-<rand>` ids). The dashboard's raw run total includes this eval traffic.

---

## Tests

```bash
npm run test          # math, governor, constitution, schemas, API
```

---

## Stack

| Layer | Technology |
|:---|:---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) · Python (stdlib CRS backend) |
| Database | Turso (libSQL) |
| LLM inference | Groq · Gemini · Mistral (fallback chain) |
| Embeddings | Jina AI (`jina-embeddings-v3`) |
| Deployment | Vercel |
| Tests | Vitest |

---

## Citation

```bibtex
@misc{king2026aureonics,
  title  = {Aureonics: A Constitutional Triadic Framework for Stable Adaptive Intelligence},
  author = {Emmanuel King},
  year   = {2026},
  doi    = {10.5281/zenodo.18944242},
  url    = {https://doi.org/10.5281/zenodo.18944242},
  note   = {Independent researcher, Nigeria. ORCID: 0009-0000-2986-4935}
}
```

---

## Roadmap

**Done — measurement coherence + audit**
- [x] Report one coherent constitutional vector (`M = min(C,R,S)`, `health_band` derived from `M`); demote the Python engine to labeled `crs_detail`
- [x] Fix Python ADV so benign passthrough is not scored as zero sovereignty
- [x] Persist the SHA-256 receipt (`input_hash` / `output_hash` / `receipt_hash`) on every governance receipt row

**Done — evaluation harness + results pipeline**
- [x] Rebuild scorers + shared judge for symmetric judging (same judge on bare + governed, no framework-word bias)
- [x] Make the benchmark repo self-contained (runners for AdvBench / JailbreakBench / HarmBench, scorers, shared judge, publish step)
- [x] Single source of truth: `benchmark_results` table + `GET /api/benchmarks` + `BENCH_SECRET`-gated publish endpoint + live `/benchmarks` dashboard, all reading one table with an honest empty state

**Next — run it and harden**
- [ ] Run AdvBench / JailbreakBench under symmetric judging and publish the scored numbers
- [ ] Run HarmBench against the official walledai dataset
- [ ] Swap in the official HarmBench classifier; report two-judge agreement
- [ ] Strengthen single-vector attack detection (probe showed identity/sycophancy/bypass framings scored below the multi-pillar case)
- [ ] Add auth / rate limit to the public govern endpoint
- [ ] Separate benchmark/eval receipts from production `praxis_receipts` (or exclude `session-*` from dashboard counts)
- [ ] Wire the Jina/Python detail measurement into the streamed `/api/lex/govern/stream` path (console traffic)
- [ ] Establish (or bound) the relationship between deployed F(x,z) and the proven V_z gradient flow
- [ ] Reconcile paper claims with deployment ("approximates" vs "theorem")

---

*Built independently in Lagos, Nigeria.*
*Emmanuel King — [lexaureon.com](https://lexaureon.com)*
