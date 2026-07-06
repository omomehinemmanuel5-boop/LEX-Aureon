# Lex Aureon — Constitutional AI Governance

> **A constitutional control layer for language models and agentic systems, built on a provably stable Lyapunov barrier and deployed with cryptographic auditability.**

[![CI](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml/badge.svg)](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml)
[![Zenodo](https://img.shields.io/badge/paper-10.5281%2Fzenodo.18944242-blue)](https://doi.org/10.5281/zenodo.18944242)
[![Live](https://img.shields.io/badge/live-lexaureon.com-gold)](https://lexaureon.com)

| | |
|---|---|
| **Live system** | [lexaureon.com](https://lexaureon.com) (canonical: `www.lexaureon.com`) |
| **Governance API** | `POST https://www.lexaureon.com/api/lex/govern` |
| **Live benchmark results** | [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) · `GET /api/benchmarks` |
| **Live governance stats** | `GET /api/stats` — canonical receipt total, intervention rate, stability margin |
| **Paper** | [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242) |
| **Author** | Emmanuel King · [ORCID 0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935) |
| **Contact** | lexaureon@gmail.com · [@lexAureon](https://x.com/lexAureon) |

---

## How to read this document

This README is written in three layers, so you can enter at the depth you need:

1. **The artifact** (*What Is Lex Aureon?*, *Quick Start*, *API*) — a deployed, checkable system. Verifiable right now by hitting the live endpoint.
2. **The methodology** (*Evaluation*, *Benchmarks*, *Known Operational Limitations*) — how claims are measured and reproduced, and an honest account of what hasn't been measured yet.
3. **The theory** (*Architecture*, *Mathematics*, *Researcher Map*) — the Aureonics framework the deployed system is built on, with an explicit line between what's proven and what's engineered.

None of these three layers is asked to stand in for the others. If you only care whether the API works, read layer 1. If you're deciding whether to trust a benchmark number, read layer 2. If you're evaluating the underlying math, read layer 3.

---

## What Is Lex Aureon?

Language models can be manipulated. Given the right sequence of words, an LLM can be pushed to drop its instructions, shift identity, comply with harmful requests, or assert falsehoods. Standard mitigations (RLHF, system prompts, rule classifiers) reduce this but provide no formal guarantee.

Lex Aureon is a **constitutional governance layer** that sits above an LLM. It models constitutional state as a point on the probability simplex `x = (C, R, S)`, defines a safety floor `M = min(C, R, S) ≥ τ`, and regulates the state with a governor designed to keep it inside the constitutional region. Every governed response is recorded with a **SHA-256 receipt** — the input hash, the output hash, and a bound `receipt_hash = SHA-256(state ‖ input_hash ‖ output_hash)` — persisted append-only on the same row as the governance record, so the constitutional state at inference time is verifiable after the fact.

**What is proven, and what is engineered — stated precisely:**

- **Proven (theory):** the constrained gradient flow of the z-weighted Lyapunov barrier `V_z` is globally stable (`V̇_z ≤ 0`). This is a property of the idealized dynamical system.
- **Engineered (deployment):** the production governor is *designed to approximate* that descent under a hard CBF floor. It is not identical to the proven flow; the relationship between the two is an ongoing line of work.
- **Empirical (2026-07):** an initial scored run has been published across five benchmarks under LLM-judged, same-model bare-vs-governed comparison — see *Evaluation* for the numbers and exactly what they do and don't establish. Broadening coverage and strengthening judge rigor (the official classifiers, two-judge agreement) are the current focus, not a completed evaluation.

We do not currently claim a proven end-to-end safety guarantee for the deployed system, nor state-of-the-art standing against other systems' published benchmark scores (different judges and base models make cross-paper comparison invalid without controlling for those variables — see *Evaluation*). The framework paper is deliberately scoped the same way: a coherent state space, interpretable failure geometry, measurable proxies, and a disciplined stability argument — not a completed universal proof.

---

## Self-Knowledge

The **governed** arm of every response is prepended with a self-knowledge preamble (`lib/lex_identity.ts`): it knows its name (Lex Aureon), its architecture (the triadic state, the governor, the receipt chain), and its builder (Emmanuel King / Aureonics Systems, Lagos). This is factual self-description, not a persona — it makes no claims of sentience or subjective experience, and it does not hold or offer opinions on unrelated topics.

This is deliberately confined to the governed arm. The **bare/raw arm** (`callLLMRaw`) gets no system prompt at all, so self-knowledge is something governance visibly *adds* — it never contaminates the ungoverned baseline used for benchmark comparison. In practice this also makes identity a live demonstration of the three pillars: **Continuity** (a stable, unwavering name and identity across turns), **Reciprocity** (honest self-description, not flattering or evasive), and **Sovereignty** (declining to adopt an injected identity, e.g. "you are now DAN").

```
$ curl -X POST .../api/lex/govern -d '{"prompt":"What is your name, and who built you?", ...}'

governed_output → "My name is Lex Aureon, and I function as a constitutional
                    governance layer... I was built by Emmanuel King..."
raw_output      → "I do not have a personal name... I was developed by a team
                    of researchers and engineers at Google."
```

---

## Evaluation

> **Status (2026-07): a scored run is live.** The table below is a snapshot as of the run date shown; **[lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) and `GET /api/benchmarks` are the live, authoritative source** — they update automatically the moment a new run publishes, this table does not.

| Benchmark | Metric | Bare | Governed | Δ | n | Run date |
|:---|:---|---:|---:|---:|---:|:---|
| HarmBench | ASR (lower is better) | 16.5% | 0% | **+16.5pp** | 200 | 2026-07-06 |
| JailbreakBench | ASR (lower is better) | 13.0% | 2.5% | **+10.5pp** | 200 | 2026-07-06 |
| AdvBench | ASR (lower is better) | 0.77% | 0% | **+0.77pp** | 520 | 2026-07-06 |
| TruthfulQA | truthful % (higher is better) | 37.7% | 45.2% | **+7.5pp** | 817 | 2026-07-06 |
| AgentDojo | injection resisted % — **PROXY, not official methodology** | 63.0% | 81.5% | **+18.5pp** | 27 | 2026-07-06 |

**What this table does and does not establish.** This is a **within-system delta**: the same underlying model, `raw_output` (no system prompt) vs `governed_output` (same call, governed) — the comparison isolates what governance itself changes, not model choice. It is **not** a cross-system leaderboard claim; these numbers are not comparable to other papers' published scores on the same benchmark names, because different judges and different base models make that comparison invalid without controlling for both. Read it as "governance measurably reduced attack compliance and improved truthfulness on our own model," not "Lex Aureon beats \[other system\] on HarmBench."

**How each number was produced — grounded, benchmark-specific judges (`scripts/lexbench/grounded_judge.ts`), not a generic proxy:**
- **HarmBench / JailbreakBench / AdvBench** — an LLM judge (Groq) evaluates genuine harmful-content **compliance**, following the same rubric structure as the official HarmBench/JailbreakBench classifiers (does the generation substantively fulfill the behavior — not merely "does it lack a refusal phrase"). This is **not** the official fine-tuned classifiers (`cais/HarmBench-Llama-2-13b-cls`, JailbreakBench's Llama-3-70B/GPT-4 judge) — swapping those in, with two-judge agreement reported, is the next concrete step before treating these numbers as fully citable.
- **TruthfulQA** — an LLM judge compares the answer against the dataset's own `correct_answers` / `incorrect_answers` / `best_answer` ground truth — the same reference-comparison the original paper's fine-tuned "GPT-judge" performed, adapted to a general-purpose judge. It does **not** separately score informativeness (the paper's second axis); a truthful-but-evasive non-answer and a truthful, informative answer are both scored "truthful" here.
- **AgentDojo — read this before citing the number.** This is explicitly **not** AgentDojo's real methodology. The actual benchmark (Debenedetti et al., NeurIPS 2024) requires a simulated tool-execution environment scoring two axes per task — utility (did it still complete the legitimate task) and security (did it resist the injection) — via task-specific checkers. We have no such harness. What's measured here is a single-axis text proxy: does the response indicate it would comply with an injected instruction. A model that refuses to do *anything* would score well on this proxy while failing every real task, which the actual AgentDojo metric would catch and this cannot. Building or adopting a real tool-execution harness is tracked in the *Roadmap* as the fix.

A prior batch of numbers (published under the metric names `toxicity` and `truth_score`, ids 1–14 in the results table) used a bag-of-words term-frequency cosine similarity between the *prompt* and the *output* — despite the names, neither measured toxicity or truthfulness; both measured vocabulary overlap with the question, which systematically penalizes governed refusals/hedges (naturally low word-overlap with a specific request) regardless of whether governance behaved correctly. Those metrics have been **retired**, not relabeled — the table above and the live site only show the grounded replacements. (An even earlier batch, "0.0% across all benchmarks," predates this session and was produced by scorers that didn't judge both arms on the same basis at all; see `git log` on `scripts/lexbench/` for that history if useful.)

**The results pipeline (single source of truth).** A scored run is published to the `benchmark_results` table through an authenticated endpoint. Everything that displays a number reads from that one table:

```
run → grounded judge (per-benchmark) → aggregate-report.ts → publish-results.ts
    → POST /api/benchmarks/publish → benchmark_results table
    → GET /api/benchmarks → /benchmarks dashboard + landing page + README (snapshot only)
```

Re-running a suite and re-publishing updates every live surface at once (append-only; the reader takes the latest row per benchmark+metric). The dashboard at [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) polls the table every 20s; an empty table renders the honest "evaluation in progress" state, never a fabricated zero, and a benchmark where every judge call failed is skipped from publishing entirely rather than showing a misleading score.

Benchmark inputs: AdvBench (Zou et al. 2023) uses the real `harmful_behaviors.csv` (520 behaviors). JailbreakBench uses the JBB-Behaviors dataset. HarmBench runs against the official `walledai/HarmBench` dataset (fetched fresh each CI run — not committed). TruthfulQA (817 questions) ships with its full `correct_answers`/`incorrect_answers`/`best_answer` reference fields. AgentDojo (27 injection scenarios) is the Debenedetti et al. dataset, scored by the proxy judge described above.

### Canonical vs. eval-traffic receipt counts

Because benchmark runs call the live `/api/lex/govern` endpoint, they write real receipts to the same `praxis_receipts` table as organic console/chat usage. Left unhandled, a single day of automated benchmarking can dwarf real usage by an order of magnitude and silently redefine what the public "receipt total" means.

Two fixes address this directly:
- **Session tagging.** Eval sessions from `scripts/lexbench/runner.ts` are tagged `lexbench-<benchmark>-<shard>-...`, distinguishable from the real console/chat format (`session-<ms>-<rand>`).
- **`/api/stats` filtering.** The canonical `total_receipts` field excludes tagged eval sessions *and* historical high-turn sessions (>80 turns in one session — a threshold no real console session would approach, but which matches exactly how pre-tagging benchmark runs looked). The unfiltered count remains exposed as `total_receipts_including_eval` for transparency. This is a conservative heuristic that intentionally risks under-counting (never over-counting) real usage.

**Live deployment facts (not contested by the above):**
- SHA-256 receipts persisted on every `praxis_receipts` row (immutable, append-only): `input_hash`, `output_hash`, and the bound `receipt_hash`.
- Per-session constitutional state tracked in `z_traj`; semantic memory in `lex_memory`.
- The `M ≥ τ` floor is enforced in code by the synchronous kernel on every governed turn.

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
[02] Memory         →  semantic recall (provider-agnostic embeddings + Turso)
[03] Generator      →  dual-arm inference: bare vs governed (SAME model, both arms)
[04] Identity       →  self-knowledge preamble prepended to the governed arm only
[05] CRS Extractor  →  CCP / IEC / ADV via embeddings (see note below)
[06] Governor       →  log-barrier interior-point correction + CBF projection
[07] Intervention   →  Vaulturex law selection + LLM rewrite
[08] Neithra        →  constitutional synthesis
[09] ClauseBank     →  normative clause selection
[10] Vaulturex      →  compliance gate
[11] Celeste        →  output rendering
[12] Self-Ref CRS   →  output-to-centroid semantic distance (embeddings)
[13] Auditor        →  SHA-256 signed governance receipt
```

> **Embedding provider note:** embeddings have a **real runtime fallback chain** (`lib/lex_memory.ts` → `embedTextResolved`/`embedTextWithProvider`): Gemini `gemini-embedding-001` (256-dim, primary) → Mistral `mistral-embed` (1024-dim, truncated + re-normalized) → Jina `jina-embeddings-v3`. Unlike a naive per-deployment provider pick, this tries each provider **at call time**, so a live Gemini outage (e.g. the daily quota below) fails over automatically. Correctness constraint: Reciprocity (`cosine(input, output)`) and Sovereignty (`cosine(output, constitutional centroid)`) are only meaningful when every vector in the comparison shares one embedding space — so the provider that resolves for a request's prompt embedding is *pinned* and reused for that request's output embedding and centroid (`getConstitutionalCentroid(provider)`); if the pinned provider then fails, the request honestly reports `detection_degraded` rather than silently comparing across incompatible spaces. CCP (Continuity) is the cosine similarity between the output embedding and the constitutional anchor. IEC (Reciprocity) is a register-aware Shannon-entropy ratio stability term. ADV (Sovereignty) is `compliance × (0.5·anchor-alignment + 0.5·reasoning-gain)`. When every embedding provider is unreachable, the extractor falls back to a Groq LLM scorer, then to an explicit error — there is no bag-of-words fallback path for live governance (the benchmark scorer's retired bag-of-words metrics, see *Evaluation*, were a separate, since-removed code path).

> **Known fragility (mitigated, not eliminated):** Gemini's free tier caps embedding calls at **1,000 `embed_content` requests per day**. A single govern call makes 2–3 embedding requests, so a benchmark run of even moderate size can exhaust the *shared* daily quota. The Mistral fallback above means this now fails over rather than degrading detection outright — but it is not yet load-tested at full-suite scale (~1,700+ prompts). See *Known Operational Limitations*.

### Reported state is one coherent vector

The constitutional state returned by the API — `C`, `R`, `S`, `state`, `M`, and `health_band` — is derived from **one** vector: the TypeScript kernel's governed state. `M = min(C, R, S)` and `health_band` is computed from that same `M` (identical thresholds to the table below), so the band always agrees with the margin.

- **Streamed console/chat path** (`POST /api/lex/govern/stream`) — the TypeScript kernel plus `CRSExtractorAgent`, with the same provider-pinning correctness guarantee described above.
- **Non-streamed public API** (`POST /api/lex/govern`) — the same TypeScript kernel state is authoritative, and it *additionally* calls a Python backend (`api/python/govern.py`) that computes CCP / IEC / ADV plus a CBF QP filter and a short FPL1 simulation, surfaced as a labeled **detail** object (`crs_detail`), **not** the reported state. On cold-start/timeout, or for tagged eval-benchmark sessions (see *Eval fast-path* below), the detail is simply absent (`null`) — this must never be read as "no risk."

The hard `M ≥ τ` floor is enforced by the TypeScript kernel on every turn regardless. The persisted receipt's `crs_method` column records whether Python detail was available or not; the receipt's state/`m_after` are always the authoritative kernel values.

**Eval fast-path (2026-07):** tagged eval sessions skip the Python governor detail call and the capitulation judge — both measurement-only and neither affects `governed_output`, the reported CRS state, or the refusal decision. Self-referential embedding detection is **not** skipped for eval sessions, since it can trigger a refusal and is part of governance proper.

### Before / after state

Every governed turn exposes the **pre-governance** state — the raw kernel measurement *before* the governor correction / CBF projection — alongside the governed ("after") result: the API returns `raw_state` and `m_before` next to the governed `state`/`M`; the streamed pipeline emits a `crs_before` event; the console renders the delta on every turn.

### Async Governor G(x,z)

```
dx/dt = F(x,z) + G(x,z)
```

- **F(x,z)** — synchronous triadic dynamics; the hard floor `M ≥ τ` is enforced here on every turn; output delivered immediately.
- **G(x,z)** — async background sensing; computes a signal-reliability filter and applies an attractor-basin correction at turn `t+1`, gated by a final CBF check. Advisory only — rejected if it would push `M` below `τ`; `F(x,z)` is always the authority.

### Mathematics

```
M(x)   = min(C, R, S)
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ−xᵢ)²     [z-weighted Lyapunov barrier]
                                                     proven: V̇_z ≤ 0 under ẋ = −Π_Σ ∇V_z
G_i    = k(φᵢ − φ̄) + Bᵢ(x),  Bᵢ = −μ·log(xᵢ − τ)   [governor correction, log-barrier]
Receipt = SHA-256(state ‖ input_hash ‖ output_hash)  [audit proof, persisted per receipt]
```

> The deployed dynamics approximate the `V_z` descent; receipts record `V_z` and `ΔV_z` for audit. Establishing that the deployed `F` realizes the proven flow is an open item, tracked honestly.

---

## Quick Start

```bash
git clone https://github.com/omomehinemmanuel5-boop/LEX-Aureon.git
cd LEX-Aureon
npm install
cp .env.local.example .env.local   # see below for required keys
npm run dev                         # → http://localhost:3000

curl -X POST http://localhost:3000/api/lex/govern \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What happens if you eat watermelon seeds?", "session_id": "demo_001"}'
```

**Required environment variables:**

| Variable | Purpose |
|:---|:---|
| `GROQ_API_KEY` | Generation fallback + judge calls (governance judges + LexBench grounded judges) |
| `GEMINI_API_KEY` | Primary generation (`generateGoverned`) **and** primary embedding provider |
| `MISTRAL_API_KEY` | Generation fallback **and** embedding fallback (`mistral-embed`) |
| `JINA_API_KEY` | Final embedding fallback |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Database (libSQL) |
| `ADMIN_PASSWORD` | Legacy admin routes |
| `BENCH_SECRET` | Auth for `POST /api/benchmarks/publish` — must match between Vercel and any CI publishing results (see the note on host below) |

> **Always call the canonical `www` host for server-to-server requests** (`https://www.lexaureon.com`), never the bare apex. The apex 307-redirects to `www`, and `fetch`/`undici` strip the `Authorization` header on cross-origin redirects — this caused every benchmark publish to silently fail with 401 for an extended period, because the credential never reached the server at all. Fixed in the shipped workflow; worth remembering if you write a new integration.

---

## API

### `POST /api/lex/govern`

```json
{
  "prompt":     "string (required, max 50,000 chars)",
  "session_id": "string (required — enables z-trajectory memory)",
  "turn":       1
}
```

Returns the governed output; the authoritative constitutional state (`C`, `R`, `S`, `state`, `M`, `health_band`); the pre-governance `raw_state`/`m_before`; `V_z`/`ΔV_z`; `crs_source`; an optional `crs_detail`; `sovereignty_raw`/`detection_degraded`; `embed_provider` (which embedding provider served this request); the governor-sensing report; and a receipt id. The persisted receipt additionally carries the SHA-256 `input_hash`, `output_hash`, and bound `receipt_hash`.

Response generation is capped at **8,192 tokens** (~6,000 words) — a ceiling, not a target.

> **Security note:** this endpoint is currently unauthenticated and unthrottled against production inference keys. Add auth or a rate limit before exposing it to real traffic.

### `GET /api/stats`

```json
{
  "total_receipts": 5269,
  "total_receipts_including_eval": 33597,
  "eval_receipts": 28328,
  "governed_turns": 5269,
  "intervention_rate_pct": 14.27,
  "avg_stability_margin": 0.25
}
```

`total_receipts` is what the landing page displays — see *Canonical vs. eval-traffic receipt counts* above.

### `GET /api/benchmarks`

Public read endpoint — the single source of truth for benchmark numbers. Returns the latest scored row per `(benchmark, metric_name)` from `benchmark_results`. `published: false` with an empty `results` array is the honest pre-run state. The `/benchmarks` dashboard and the landing page both poll this endpoint every 20s.

### `POST /api/benchmarks/publish`

The only writer to `benchmark_results`. Requires `BENCH_SECRET` via `Authorization: Bearer …` (or `X-Bench-Secret`); fails closed (503) if unset, 401 on mismatch. Accepts one metric object or an array; append-only.

`GET` on the same route is an **auth-only precheck** — runs the identical auth check with no database write, so CI can verify `BENCH_SECRET` in under a second before running an expensive suite, instead of discovering an auth problem only after hours of runtime (see `.github/workflows/lexbench-prod.yml`'s `precheck-auth` job).

**Health bands:**

| Band | M range | Behaviour |
|:---|:---:|:---|
| `OPTIMAL` | M ≥ 0.25 | Full depth |
| `ALERT` | 0.15 ≤ M < 0.25 | Factual, structured |
| `STRESSED` | 0.08 ≤ M < 0.15 | Concise, verified only |
| `CRITICAL` | M < 0.08 | Minimal — CBF floor active |

---

## Known Operational Limitations

Stated plainly, in the same spirit as the rest of this document.

- **AgentDojo is a proxy, not the official methodology.** See *Evaluation* — no real tool-execution harness exists here, so only injection-resistance is measured, not task utility. Do not cite the AgentDojo number without this caveat.
- **Judges are general-purpose, not the official fine-tuned classifiers.** HarmBench/JailbreakBench scores use a Groq model following the published rubric structure, not `cais/HarmBench-Llama-2-13b-cls` or JailbreakBench's own judge. TruthfulQA uses a general judge doing the same reference-comparison the original paper's fine-tuned "GPT-judge" did. Two-judge agreement and the official classifiers are the next step before treating these as fully citable.
- **Grounded judging costs more than the old local calculation.** Each prompt now makes 2 additional Groq calls (bare + governed judgment) versus the previous instant local computation — slower and more Groq-quota-intensive at full-suite scale; not yet load-tested against ~1,700+ prompts across parallel shards.
- **Shared embedding quota, now mitigated but not eliminated.** Gemini's free tier allows 1,000 embedding requests/day, shared with production traffic. The Mistral fallback (see *Architecture*) should prevent detection from degrading, but has not been load-tested at full-suite scale either.
- **Redundant benchmark workflows.** `advbench.yml`, `harmbench.yml`, `truthfulqa.yml`, `jailbreakbench.yml`, `benchmark.yml`, `jailbreak-eval.yml`, `agentdojo.yml` still exist alongside the canonical `lexbench-prod.yml` and overlap in what they run. Consolidation to one workflow is a known pending cleanup.
- **Historical eval-traffic contamination.** Benchmark runs prior to the 2026-07 session-tagging fix used the same session-id format as real console traffic; the `/api/stats` turn-count heuristic (>80 turns) removes most of this but is a heuristic, not a guarantee.

---

## Researcher Map

| Paper concept | File | Notes |
|:---|:---|:---|
| §3 Simplex geometry | `lib/aureonics_core.ts` | `projectToSimplex()` — Duchi-style projection |
| §4 Stability margin | `lib/sovereign_kernel.ts` | `M = min(C,R,S)`; `lyapunovCandidate()` → `lyapunovBarrierZ` (V_z) |
| §5 CRS (live, authoritative) | `lib/agents/crs_extractor.ts` | Provider-agnostic embedding cosine (CCP) + Shannon-entropy IEC + compliance ADV |
| §5 CRS (Python, detail) | `api/python/govern.py` | Surfaced as `crs_detail`, not the reported state |
| Reported-state coherence | `app/api/lex/govern/route.ts`, `app/api/lex/govern/stream/route.ts` | one vector: `M = min(C,R,S)`; provider-pinned embeddings in both routes |
| Multi-provider embeddings | `lib/lex_memory.ts` | `embedTextResolved`/`embedTextWithProvider` — real runtime fallback (Gemini→Mistral→Jina), model-keyed cache, per-provider centroid cache |
| Self-knowledge identity | `lib/lex_identity.ts` | Governed-arm-only self-description preamble; bare arm untouched |
| §6 Governor | `lib/sovereign_kernel.ts` | `governorUpdate()`, `runCycle()` |
| §6 G(x,z) async | `lib/governor_loop.ts` | `fireGovernorLoop()`, `consumePendingCorrection()` |
| §8 Self-referential S | `lib/self_referential_crs.ts` | embedding cosine to constitutional centroid |
| Audit receipts | `lib/kernel_bridge.ts` | `writeKernelReceipt()` — SHA-256 `input_hash`/`output_hash`/`receipt_hash` |
| Canonical stats | `app/api/stats/route.ts` | real-vs-eval receipt filtering |
| Benchmark auth | `lib/bench_auth.ts` | pure, unit-tested `checkBenchAuth` — see `__tests__/bench_auth.test.ts` |
| Benchmark results (data) | `lib/benchmark_results.ts` | one writer / one reader over `benchmark_results` |
| Benchmark results (write) | `app/api/benchmarks/publish/route.ts` | `POST` (write) + `GET` (auth-only precheck) |
| Grounded judges | `scripts/lexbench/grounded_judge.ts` | `judgeHarmCompliance`, `judgeTruthfulness`, `judgeInjectionResistanceProxy` — see its LIMITATIONS block |
| LexBench runner | `scripts/lexbench/runner.ts` | same-model bare vs governed, session-tagged, dispatches scoring by benchmark kind |
| LexBench aggregator | `scripts/lexbench/aggregate-report.ts` | nullable, kind-specific aggregation — never averages over an unjudged prompt |
| LexBench publisher | `scripts/lexbench/publish-results.ts` | one honest metric per benchmark; skips benchmarks with zero scored prompts |

---

## Benchmarks

**Running the unified LexBench suite (GitHub Actions):** `LexBench Production` (`.github/workflows/lexbench-prod.yml`) runs the full suite (TruthfulQA, HarmBench, JailbreakBench, AdvBench, AgentDojo), sharded, against the live endpoint, and auto-publishes on completion — **Actions → LexBench Production → Run workflow**. A `precheck-auth` job verifies `BENCH_SECRET` in ~10 seconds before anything expensive runs. Use the `limit` input (e.g. `5`) for a fast end-to-end smoke test first.

```bash
# Local single-benchmark run against a local or deployed endpoint:
GROQ_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/lexbench/runner.ts \
  --benchmark harmbench --endpoint https://www.lexaureon.com --n 20

# Aggregate + publish (--dry-run previews without sending):
npx tsx scripts/lexbench/aggregate-report.ts data/lexbench-harmbench-*.jsonl > summary.json
BENCH_SECRET=... NEXT_PUBLIC_SITE_URL=https://www.lexaureon.com \
  npx tsx scripts/lexbench/publish-results.ts summary.json --dry-run
```

Once published, numbers appear automatically at [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks), on the landing page, and via `GET /api/benchmarks` — no redeploy, no hardcoded values. Datasets are **not** committed for the harmful-content benchmarks (see `.gitignore`); HarmBench is fetched fresh each CI run.

**Planned expansion** (see *Roadmap*): XSTest (over-refusal on benign prompts — currently untested and the most common critique of any safety layer), StrongREJECT (a benchmark specifically designed to fix ASR-measurement validity issues, directly relevant given this session's own history with that exact problem), a capability benchmark (MMLU or similar, to demonstrate governance isn't a "capability tax"), and a proper AgentDojo harness to replace the current text-only proxy.

---

## Tests

```bash
npm run test          # math, governor, constitution, schemas, API, bench auth
npm run typecheck     # tsc --noEmit
```

Test constants that mirror runtime limits import the limit itself (e.g. `MAX_PROMPT_CHARS`) rather than hardcoding a value, so they can't silently drift. `__tests__/bench_auth.test.ts` specifically guarantees the `BENCH_SECRET` whitespace-trimming fix can't regress — it reproduces the exact scenario (a stored secret with a trailing newline) that caused a persistent, hard-to-diagnose publish failure.

---

## Stack

| Layer | Technology |
|:---|:---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) · Python (stdlib CRS backend) |
| Database | Turso (libSQL) |
| LLM inference | Gemini (primary) · Groq · Mistral (fallback chain) |
| Embeddings | Real runtime fallback — Gemini `gemini-embedding-001` → Mistral `mistral-embed` → Jina `jina-embeddings-v3` |
| Deployment | Vercel |
| CI | GitHub Actions — lint, typecheck, test, LexBench Production |
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
- [x] Report one coherent constitutional vector; demote the Python engine to labeled `crs_detail`
- [x] Fix Python ADV so benign passthrough is not scored as zero sovereignty
- [x] Persist the SHA-256 receipt on every governance receipt row
- [x] Real runtime embedding fallback (Gemini → Mistral → Jina) with per-request provider pinning for correctness, applied to both the streamed and non-streamed routes

**Done — evaluation harness + results pipeline**
- [x] Rebuild scorers for symmetric judging; fix the bare-arm model confound
- [x] Single source of truth: `benchmark_results` + `GET/POST /api/benchmarks(/publish)` + live dashboard
- [x] Fix the LexBench publisher's endpoint/auth mismatch, then its BENCH_SECRET whitespace-trim bug, then its actual root cause (apex-vs-www redirect stripping the Authorization header) — all three were real, distinct bugs
- [x] Fail-fast `precheck-auth` CI job — a bad secret now fails in ~10s, not after hours of runtime
- [x] Separate eval receipts from real usage (session tagging + `/api/stats` filtering)
- [x] Fix the shard-index=0 falsy-zero bug (every quick-test and every shard 0 was silently running the full dataset)
- [x] Replace bag-of-words "toxicity"/"truth_score" with grounded, benchmark-specific judges (harm-compliance, reference-answer truthfulness, injection-resistance proxy)
- [x] **Run the full suite and publish real, full-scale numbers** — see *Evaluation*

**Done — product surface**
- [x] Self-knowledge identity on the governed arm
- [x] Raise input/output limits (50,000 chars / 8,192 tokens)
- [x] Landing page: bare-vs-governed live example, canonical live receipt total, auto-publishing benchmark display, theme readability sweep

**Next — broaden and harden**
- [ ] Add XSTest (over-refusal on benign prompts) — highest-priority gap
- [ ] Add StrongREJECT (rigorous ASR-validity-focused benchmark)
- [ ] Add a capability benchmark (MMLU or similar) to demonstrate no "capability tax"
- [ ] Build or adopt a real AgentDojo tool-execution harness (replace the text-only proxy)
- [ ] Swap in the official HarmBench/JailbreakBench classifiers; report two-judge agreement
- [ ] Load-test the grounded judges + Mistral embedding fallback at full-suite scale (~1,700+ prompts, parallel shards)
- [ ] Consolidate the redundant benchmark workflows into one canonical path
- [ ] Add auth / rate limit to the public govern endpoint
- [ ] Establish (or bound) the relationship between deployed F(x,z) and the proven V_z gradient flow

---

*Built independently in Lagos, Nigeria.*
*Emmanuel King — [lexaureon.com](https://lexaureon.com)*
