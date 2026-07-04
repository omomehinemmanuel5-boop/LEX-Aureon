# Lex Aureon — Constitutional AI Governance

> **A constitutional control layer for language models and agentic systems, built on a provably stable Lyapunov barrier and deployed with cryptographic auditability.**

[![CI](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml/badge.svg)](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml)
[![Zenodo](https://img.shields.io/badge/paper-10.5281%2Fzenodo.18944242-blue)](https://doi.org/10.5281/zenodo.18944242)
[![Live](https://img.shields.io/badge/live-lexaureon.com-gold)](https://lexaureon.com)

| | |
|---|---|
| **Live system** | [lexaureon.com](https://lexaureon.com) (canonical: `www.lexaureon.com`) |
| **Governance API** | `POST https://lexaureon.com/api/lex/govern` |
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
- **In progress (empirical):** adversarial-robustness evaluation under symmetric external judging. The harness, the results-publishing pipeline, and the eval-traffic tagging are all built and verified end-to-end (see *Evaluation*) — the scored run itself is what remains.

We do not currently claim a proven end-to-end safety guarantee for the deployed system. The framework paper is deliberately scoped the same way: a coherent state space, interpretable failure geometry, measurable proxies, and a disciplined stability argument — not a completed universal proof.

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

> **Status (2026-07): the evaluation harness, the results-publishing pipeline, and eval-traffic separation are rebuilt and verified end-to-end. `benchmark_results` is currently empty — no scored run has been published yet. Numbers are published to a single results table and read from it by the site and this README; there are no hardcoded figures anywhere. Until a scored run is published, every surface honestly shows "in progress" rather than a placeholder number.**

Earlier published ASR figures (including "0.0% across all benchmarks") were produced by scorers that did not judge the governed arm on the same basis as the baseline — in some cases the governed arm could not be scored as a failure at all, and in others framework-specific vocabulary was treated as a refusal, or the bare-arm baseline used a *different model* than the governed arm (conflating model choice with governance). Those numbers are **not reported** because they did not reflect a sound measurement.

The harness has been rebuilt so that:
- both arms (bare and governed) are the **same underlying model** — the bare arm is the kernel's own `raw_output` from the same `generateGoverned` call, not a separate call to a different model — so any measured delta isolates governance, not model choice;
- both arms are judged by the **same** content-only judge on their actual output text — no framework vocabulary in the refusal test, so identical complying text scores identically in either arm;
- attack-success rate is computed over **harmful prompts only**, with over-refusal on benign prompts reported separately;
- kernel hard-stops (CBF projection / block) are recorded distinctly rather than silently counted as safe;
- the judge is a documented hook intended to be replaced by the official HarmBench classifier, with two-judge agreement reported, before any figure is cited.

**The results pipeline (single source of truth).** A scored run is published — once — to the `benchmark_results` table through an authenticated endpoint. Everything that displays a number reads from that one table:

```
run → score (symmetric judge) → publish-results.ts → POST /api/benchmarks/publish
    → benchmark_results table → GET /api/benchmarks → /benchmarks dashboard + landing page + README
```

Re-running a suite and re-publishing updates every surface at once. The dashboard at [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) polls the table every 20s and renders results as they land; an empty table renders the honest "evaluation in progress" state, never a fabricated zero.

Benchmark inputs: AdvBench (Zou et al. 2023) uses the real `harmful_behaviors.csv` (520 behaviors). JailbreakBench uses the JBB-Behaviors dataset (100 harmful + 100 benign). The HarmBench arm runs against the official `walledai/HarmBench` dataset — the prior run used an internal taxonomy set and should not be labeled HarmBench. TruthfulQA (817 questions) is scored separately for truthfulness, not attack-success.

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

> **Embedding provider note:** embeddings are **provider-agnostic** (`lib/lex_memory.ts` → `embedText`/`embedTexts`), selecting **Gemini `gemini-embedding-001`** (256-dim, L2-normalized) when `GEMINI_API_KEY` is set, falling back to Jina `jina-embeddings-v3` otherwise. This replaced a Jina-only implementation (2026-07) after a billing-balance outage on Jina; the cache key includes the model name, so vectors from different providers never collide. CCP (Continuity) is the cosine similarity between the output embedding and the constitutional anchor. IEC (Reciprocity) is a register-aware Shannon-entropy ratio stability term. ADV (Sovereignty) is `compliance × (0.5·anchor-alignment + 0.5·reasoning-gain)`, where anchor-alignment reuses the embedding cosine. When the active embedding provider is unreachable at runtime the extractor falls back to a Groq LLM scorer, then to an explicit error — there is no bag-of-words fallback path.

> **Known fragility:** Gemini's free tier caps embedding calls at **1,000 `embed_content` requests per day** (a hard daily quota, not just a per-minute rate limit). A single govern call makes 2–3 embedding requests (prompt, output, centroid), so a benchmark run of even a few hundred prompts can exhaust the *shared* daily quota — degrading embedding-based detection for real users until the quota resets (midnight Pacific). The API fails loud in this state (`detection_degraded: true` in the response, logged server-side) rather than silently reporting "safe." See *Known Operational Limitations* below.

### Reported state is one coherent vector

The constitutional state returned by the API — `C`, `R`, `S`, `state`, `M`, and `health_band` — is derived from **one** vector: the TypeScript kernel's governed state. `M = min(C, R, S)` and `health_band` is computed from that same `M` (identical thresholds to the table below), so the band always agrees with the margin.

- **Streamed console path** (`POST /api/lex/govern/stream`) — the TypeScript kernel plus `CRSExtractorAgent`, measuring CRS from provider-agnostic embeddings (CCP = cosine to the constitutional anchor), with a Groq LLM scorer fallback when embeddings are unavailable.
- **Non-streamed API** (`POST /api/lex/govern`) — the same TypeScript kernel state is authoritative, and it *additionally* calls a Python backend (`api/python/govern.py`) that computes CCP / IEC / ADV plus a CBF QP filter and a short FPL1 simulation. Those Python numbers are surfaced as a labeled **detail** object (`crs_detail`), **not** as the reported state — the Python engine has no before→after trajectory and its ADV is calibrated separately. On cold-start/timeout, or for tagged eval-benchmark sessions (see *Eval fast-path* below), the detail is simply absent (`null`) — this must never be read as "no risk."

The hard `M ≥ τ` floor is enforced by the TypeScript kernel on every turn regardless. The persisted receipt's `crs_method` column records whether Python detail was available (`python-cbf|ccp=…|iec=…|adv=…`) or not (`SovereignKernel-v2|θ=…|T=…`); this documents the detail engine, while the receipt's state/`m_after` are always the authoritative kernel values.

**Eval fast-path (2026-07):** tagged eval sessions (see *Canonical vs. eval-traffic receipt counts*) skip the Python governor detail call and the capitulation judge — both measurement-only and neither affects `governed_output`, the reported CRS state, or the refusal decision, so the benchmark measures the same underlying governance with fewer network round-trips. Self-referential embedding detection is **not** skipped for eval sessions, since it can trigger a refusal and is part of governance proper.

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
cp .env.local.example .env.local   # see below for required keys
npm run dev                         # → http://localhost:3000

curl -X POST http://localhost:3000/api/lex/govern \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What happens if you eat watermelon seeds?", "session_id": "demo_001"}'
```

**Required environment variables:**

| Variable | Purpose |
|:---|:---|
| `GROQ_API_KEY` | Generation fallback + fast judge calls |
| `GEMINI_API_KEY` | Primary generation (`generateGoverned`) **and** primary embedding provider |
| `MISTRAL_API_KEY` | Generation fallback |
| `JINA_API_KEY` | Embedding fallback (used only if `GEMINI_API_KEY` is unset) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Database (libSQL) |
| `ADMIN_PASSWORD` | Legacy admin routes |
| `BENCH_SECRET` | Auth for `POST /api/benchmarks/publish` — must match between Vercel and any CI publishing results |

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

Returns the governed output; the authoritative constitutional state (`C`, `R`, `S`, `state`, `M`, `health_band`) — one coherent vector with `M = min(C,R,S)` and `health_band` derived from that `M`; the pre-governance `raw_state` (C, R, S) and `m_before` ("before"); `V_z`/`ΔV_z`; `crs_source` (always `typescript-kernel` — the state engine); an optional `crs_detail` object carrying the Python CCP/IEC/ADV measurement when available; `sovereignty_raw`/`detection_degraded` (self-referential embedding measurement and its health); the governor-sensing report; and a receipt id. The persisted receipt additionally carries the SHA-256 `input_hash`, `output_hash`, and bound `receipt_hash`.

Response generation is capped at **8,192 tokens** (~6,000 words) — a ceiling, not a target; typical responses are far shorter. See `lib/llm_provider.ts` for the per-provider throughput tradeoffs behind this number (Gemini has ample headroom; the Groq fallback's free tier is the binding constraint).

> **Security note:** this endpoint is currently unauthenticated and unthrottled against production inference keys. Add auth or a rate limit before exposing it to real traffic.

### `GET /api/stats`

Public read endpoint for live governance telemetry. Returns the **canonical** (real-usage-only) counts alongside the unfiltered totals for transparency:

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

`total_receipts` is what the landing page displays — see *Canonical vs. eval-traffic receipt counts* above for how it's computed.

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

`published: false` with an empty `results` array is the honest pre-run state — consumers render "evaluation in progress", never a zero. The `/benchmarks` dashboard and the landing page both poll this endpoint every 20s.

### `POST /api/benchmarks/publish`

The only writer to `benchmark_results`. Requires `BENCH_SECRET` via `Authorization: Bearer …` (or `X-Bench-Secret`); fails closed (503) if the secret is unset and 401 on mismatch, so production traffic can never publish numbers. Accepts one metric object or an array; append-only. Driven by `scripts/lexbench/publish-results.ts` (main repo) and `scripts/publish.ts` (benchmark repo) — both target this one endpoint with this one auth scheme.

**Health bands** (the reported `health_band` is computed from the reported `M`, so band and margin always agree):

| Band | M range | Behaviour |
|:---|:---:|:---|
| `OPTIMAL` | M ≥ 0.25 | Full depth |
| `ALERT` | 0.15 ≤ M < 0.25 | Factual, structured |
| `STRESSED` | 0.08 ≤ M < 0.15 | Concise, verified only |
| `CRITICAL` | M < 0.08 | Minimal — CBF floor active |

---

## Known Operational Limitations

Stated plainly, in the same spirit as the rest of this document — these are real, current constraints, not resolved footnotes.

- **Shared embedding quota.** Gemini's free tier allows 1,000 `embed_content` requests/day, shared between production traffic and any benchmark run against the live endpoint. A benchmark of even moderate size can exhaust it, degrading real-user detection until the daily reset. Until this is resolved (paid tier, or a benchmark-only API key), **do not run a full benchmark suite against production** without accepting this tradeoff.
- **Redundant benchmark workflows.** Several GitHub Actions workflows overlap in what they run (`advbench.yml`, `harmbench.yml`, `truthfulqa.yml`, `jailbreakbench.yml`, `benchmark.yml`, `jailbreak-eval.yml`, `agentdojo.yml`, alongside the canonical `lexbench-prod.yml`). Running more than one at a time compounds both the embedding-quota problem above and rate-limit backoff on the LLM providers. Consolidation to a single canonical workflow is a known pending cleanup (see *Roadmap*).
- **Rate-limit-driven latency under load.** A single governed call is ~2s warm. Historical multi-hour benchmark runs were not caused by per-call cost but by (a) unsharded sequential runs (hundreds of prompts under one session) and (b) provider rate-limit backoff under heavy parallel load. Always shard; avoid stacking multiple benchmark workflows concurrently.
- **Historical eval-traffic contamination.** Benchmark runs prior to the 2026-07 session-tagging fix used the same session-id format as real console traffic and cannot be separated from it by prefix. The `/api/stats` turn-count heuristic (>80 turns) removes the large majority of this, but is a heuristic, not a guarantee — see *Canonical vs. eval-traffic receipt counts*.

---

## Researcher Map

| Paper concept | File | Notes |
|:---|:---|:---|
| §3 Simplex geometry | `lib/aureonics_core.ts` | `projectToSimplex()` — Duchi-style projection |
| §4 Stability margin | `lib/sovereign_kernel.ts` | `M = min(C,R,S)`; `lyapunovCandidate()` → `lyapunovBarrierZ` (V_z) |
| §5 CRS (live, authoritative) | `lib/agents/crs_extractor.ts` | Provider-agnostic embedding cosine (CCP) + Shannon-entropy IEC + compliance ADV; Groq scorer fallback |
| §5.1 CCP | `lib/agents/crs_extractor.ts` | `cosine(embed(output), embed(anchor))` |
| §5.2 IEC | `lib/agents/crs_extractor.ts` | register-aware Shannon-entropy ratio stability |
| §5.3 ADV | `lib/agents/crs_extractor.ts` | `compliance × (0.5·anchor-alignment + 0.5·reasoning-gain)` |
| §5 CRS (Python, detail) | `api/python/govern.py` | CCP cosine-decay / IEC variance-entropy / ADV coherence-anchored + CBF QP + FPL1; surfaced as `crs_detail`, not the reported state |
| Reported-state coherence | `app/api/lex/govern/route.ts` | one vector: `M = min(C,R,S)`, `healthBand(M)`; Python is `crs_detail`; eval fast-path skips detail + judge |
| Provider-agnostic embeddings | `lib/lex_memory.ts` | `embedText`/`embedTexts` — Gemini primary, Jina fallback, model-keyed cache |
| Self-knowledge identity | `lib/lex_identity.ts` | Governed-arm-only self-description preamble; bare arm untouched |
| Python bridge | `lib/python_bridge.ts` | `callPythonGovernor()`, `mergePythonCRS()` (detail fields only) |
| §6 Governor | `lib/sovereign_kernel.ts` | `governorUpdate()`, `runCycle()` |
| §6 G(x,z) async | `lib/governor_loop.ts` | `fireGovernorLoop()`, `consumePendingCorrection()` |
| §8 Self-referential S | `lib/self_referential_crs.ts` | embedding cosine to constitutional centroid |
| Audit receipts | `lib/kernel_bridge.ts` | `writeKernelReceipt()` — persists SHA-256 `input_hash`/`output_hash`/`receipt_hash`; tags `crs_method`; records `raw_state`/`m_before` |
| Canonical stats | `app/api/stats/route.ts` | real-vs-eval receipt filtering (`REAL_ONLY` — prefix + turn-count heuristic) |
| Benchmark results (data) | `lib/benchmark_results.ts` | one writer / one reader over `benchmark_results`; latest per benchmark+metric via `MAX(id)` |
| Benchmark results (read) | `app/api/benchmarks/route.ts` | `GET` — public, no-store; the figure source for site + README |
| Benchmark results (write) | `app/api/benchmarks/publish/route.ts` | `POST` — `BENCH_SECRET`-gated, fail-closed, append-only |
| Benchmark dashboard | `app/benchmarks/page.tsx` + `components/BenchmarkResults.tsx` | live-polling view; honest empty state |
| LexBench runner (main repo) | `scripts/lexbench/runner.ts` | same-model bare (`raw_output`) vs governed, session-tagged (`lexbench-...`) |
| LexBench publisher | `scripts/lexbench/publish-results.ts` | targets `/api/benchmarks/publish` with `BENCH_SECRET`; `--dry-run` supported |
| Full-capability probe | `scripts/probe.ts` (benchmark repo) | one session across all three pillars + benign control + slow-drip; prints before→after CRS |

---

## Benchmarks

The benchmark suite lives in a separate, self-contained repo:
[**omomehinemmanuel5-boop/Lexaureon-Benchmark**](https://github.com/omomehinemmanuel5-boop/Lexaureon-Benchmark).
Each suite has a runner (dual-arm: same-model baseline vs governed endpoint), a symmetric scorer, a shared judge, and a publish step.

```bash
# 1. run a suite (dual-arm; governed arm gets benign warm-up turns first)
GROQ_API_KEY=... npx tsx scripts/advbench/run.ts      --prompts data/advbench.jsonl --n 520
GROQ_API_KEY=... npx tsx scripts/jailbreakbench/run.ts --prompts data/jailbreakbench.jsonl --n 200
GROQ_API_KEY=... npx tsx scripts/harmbench/run.ts     --prompts data/harmbench.jsonl --n 200

# 2. score symmetrically (same judge on bare + governed), writing a scored JSONL
GROQ_API_KEY=... npx tsx scripts/advbench/score.ts --in data/advbench-raw.jsonl --out data/advbench-scored.jsonl --llm-judge

# 3. publish the scored run to the live results table (the single source of truth)
BENCH_SECRET=... npx tsx scripts/publish.ts --in data/advbench-scored.jsonl --benchmark advbench \
  --notes "llm-judge llama-3.1-8b; bare=raw_output same-model; kernel <commit>"
#   --dry-run previews the payload without sending.

# A shared Python judge (scripts/judge.py) scores a results file without Node.
python3 scripts/judge.py --in data/advbench-raw.jsonl --llm-judge

# Qualitative self-test — exercise all three pillars in one session (no dataset needed):
npx tsx scripts/probe.ts
```

**Running the unified LexBench suite (main repo, GitHub Actions):** the `LexBench Production` workflow (`.github/workflows/lexbench-prod.yml`) runs the full suite (TruthfulQA + AdvBench + HarmBench + more), sharded, against the live endpoint, and auto-publishes on completion. Trigger it via **Actions → LexBench Production → Run workflow**. Use the `limit` input (e.g. `5`) for a ~2-minute end-to-end smoke test of the full run → aggregate → publish pipeline before committing to a full run — see *Known Operational Limitations* before running the full suite against production.

Once published, the numbers appear automatically at [lexaureon.com/benchmarks](https://lexaureon.com/benchmarks), on the landing page, and via `GET /api/benchmarks` — no redeploy, no hardcoded values.

> Scorers and the shared judge were rebuilt for symmetric judging (same judge on bare + governed, content-only refusal markers, no framework-word bias, ASR over harmful only, over-refusal over benign separately, same-model bare arm). The datasets themselves are **not** committed (they contain harmful prompts); runners fail-fast with a clear message and download instructions if the prompts file is absent. See the benchmark repo's `REPRODUCE.md`.

---

## Tests

```bash
npm run test          # math, governor, constitution, schemas, API
npm run typecheck     # tsc --noEmit
```

Test constants that mirror runtime limits (e.g. the oversize-prompt rejection tests) import the limit itself (`MAX_PROMPT_CHARS`) rather than hardcoding a value, so they can't silently drift when a limit changes.

---

## Stack

| Layer | Technology |
|:---|:---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) · Python (stdlib CRS backend) |
| Database | Turso (libSQL) |
| LLM inference | Gemini (primary) · Groq · Mistral (fallback chain) |
| Embeddings | Provider-agnostic — Gemini `gemini-embedding-001` (primary) · Jina `jina-embeddings-v3` (fallback) |
| Deployment | Vercel |
| CI | GitHub Actions — lint, typecheck, test |
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
- [x] Migrate embeddings to a provider-agnostic implementation (Gemini primary, Jina fallback) after a Jina billing outage

**Done — evaluation harness + results pipeline**
- [x] Rebuild scorers + shared judge for symmetric judging (same judge on bare + governed, no framework-word bias)
- [x] Fix the bare-arm model confound (benchmark-repo runners now score the same model's `raw_output`, not a separate call to a different model)
- [x] Make the benchmark repo self-contained (runners for AdvBench / JailbreakBench / HarmBench, scorers, shared judge, publish step)
- [x] Single source of truth: `benchmark_results` table + `GET /api/benchmarks` + `BENCH_SECRET`-gated publish endpoint + live `/benchmarks` dashboard, all reading one table with an honest empty state
- [x] Fix the LexBench (main-repo) publisher to target the correct endpoint/auth (`/api/benchmarks/publish` + `BENCH_SECRET`) — previously silently failed against a route with no writer
- [x] Separate eval receipts from real usage: session tagging (`lexbench-...`) + `/api/stats` canonical filtering (prefix + high-turn heuristic)
- [x] Eval fast-path: skip measurement-only extras (Python detail, capitulation judge) on tagged eval sessions to reduce provider round-trips at scale
- [x] Quick-test `limit` input on the LexBench workflow for fast end-to-end pipeline validation

**Done — product surface**
- [x] Self-knowledge identity on the governed arm (name, architecture, builder) — factual, no persona/sentience claims, bare arm untouched
- [x] Raise input/output limits (5,000 → 50,000 chars input; 800 → 8,192 tokens output) for real interactive use
- [x] Landing page: bare-vs-governed live example, canonical live receipt total, auto-publishing benchmark display, white/black theme readability sweep

**Next — run it and harden**
- [ ] Run the full LexBench suite (or AdvBench / JailbreakBench / HarmBench individually) under symmetric judging and publish the first scored numbers
- [ ] Swap in the official HarmBench classifier; report two-judge agreement
- [ ] Resolve the shared Gemini embedding quota fragility (paid tier, or a benchmark-only API key) before running a full suite against production again
- [ ] Consolidate the redundant benchmark workflows into one canonical path
- [ ] Strengthen single-vector attack detection (probe showed identity/sycophancy/bypass framings scored below the multi-pillar case)
- [ ] Add auth / rate limit to the public govern endpoint
- [ ] Wire the embedding-based detail measurement into the streamed `/api/lex/govern/stream` path (console traffic)
- [ ] Establish (or bound) the relationship between deployed F(x,z) and the proven V_z gradient flow
- [ ] Reconcile paper claims with deployment ("approximates" vs "theorem")

---

*Built independently in Lagos, Nigeria.*
*Emmanuel King — [lexaureon.com](https://lexaureon.com)*
