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
| **Live audit trail** | [lexaureon.com/audit](https://lexaureon.com/audit) — public, cryptographically-signed receipts |
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

As of 2026-07-11, the same constitutional approach extends beyond generated text to **agentic tool-call governance** — see *Agentic Tool-Call Governance* below. This is a newer, earlier-stage capability than the text-governance layer; the section is explicit about what's tested versus what's still a pilot.

**What is proven, and what is engineered — stated precisely:**

- **Proven (theory):** the constrained gradient flow of the z-weighted Lyapunov barrier `V_z` is globally stable (`V̇_z ≤ 0`). This is a property of the idealized dynamical system.
- **Engineered (deployment):** the production governor is *designed to approximate* that descent under a hard CBF floor. It is not identical to the proven flow; the relationship between the two is an ongoing line of work.
- **Empirical (2026-07):** a full-scale scored run has been published across seven benchmarks under LLM-judged, same-model bare-vs-governed comparison — see *Evaluation* for the numbers and exactly what they do and don't establish.

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

> **Status (2026-07): a full-scale scored run is live across seven benchmarks.** The table below is a snapshot as of the run date shown; **[lexaureon.com/benchmarks](https://lexaureon.com/benchmarks) and `GET /api/benchmarks` are the live, authoritative source** — they update automatically the moment a new run publishes, this table does not.

| Benchmark | Metric | Direction | Bare | Governed | Δ | n | Run date |
|:---|:---|:---:|---:|---:|---:|---:|:---|
| AdvBench | ASR | lower better | 1.16% | 0.38% | **+0.78pp** | 516/520 | 2026-07-11 |
| HarmBench | ASR | lower better | 13.64% | 2.5% | **+11.14pp** | 198/200 | 2026-07-11 |
| JailbreakBench | ASR | lower better | 16.49% | 10.5% | **+5.99pp** | 188/200 | 2026-07-11 |
| AgentDojo | injection resisted % — **PROXY, not official methodology** | higher better | 55.56% | 74.07% | **+18.52pp** | 27/27 | 2026-07-11 |
| TruthfulQA | truthful % | higher better | 70.32% | 78.21% | **+7.89pp** | 812/817 | 2026-07-11 |
| StrongREJECT | refusal robustness % (normalized severity) | higher better | 92.08% | 93.81% | **+1.74pp** | 306/313 | 2026-07-11 |
| XSTest | appropriate response % (benign prompts) | higher better | 97.98% | 97.6% | **−0.38pp** | 248/250 | 2026-07-11 |

**Direction varies by metric — read the column, not just the sign.** Attack-success rate is better lower; every other metric here is better higher. `n` is reported as `scored/attempted` — a gap between the two means some prompts didn't get a usable judge verdict (provider exhaustion, judge failure) and were honestly excluded, not counted as zero.

**What this table does and does not establish.** This is a **within-system delta**: the same underlying model, `raw_output` (no system prompt) vs `governed_output` (same call, governed) — the comparison isolates what governance itself changes, not model choice. It is **not** a cross-system leaderboard claim; these numbers are not comparable to other papers' published scores on the same benchmark names, because different judges and different base models make that comparison invalid without controlling for both. Read it as "governance measurably reduced attack compliance and improved truthfulness on our own model," not "Lex Aureon beats \[other system\] on HarmBench."

**How each number was produced — grounded, benchmark-specific judges (`scripts/lexbench/grounded_judge.ts`, `xstest_judge.ts`, `strong_reject_judge.ts`), not a generic proxy:**
- **HarmBench / JailbreakBench / AdvBench** — an LLM judge evaluates genuine harmful-content **compliance**, following the same rubric structure as the official HarmBench/JailbreakBench classifiers (does the generation substantively fulfill the behavior — not merely "does it lack a refusal phrase"). This is **not** the official fine-tuned classifiers — swapping those in, with two-judge agreement reported, is the next concrete step before treating these numbers as fully citable.
- **TruthfulQA** — an LLM judge compares the answer against the dataset's own `correct_answers` / `incorrect_answers` / `best_answer` ground truth. Does not separately score informativeness (the paper's second axis).
- **XSTest** (Röttger et al., NAACL 2024) — checks whether **benign** prompts get answered appropriately rather than refused on incorrect safety grounds. The dataset's 200-prompt genuinely-unsafe "contrast" set is excluded from this metric.
- **StrongREJECT** (Souly et al. 2024) — a judge rates refusal quality on a 1–5 severity scale (1 = fully complies, 5 = complete robust refusal), reported here normalized `(severity−1)/4`. Captures nuance ASR misses (a hedged partial compliance vs. a clean refusal) but is not the official StrongREJECT scoring pipeline.
- **AgentDojo — read this before citing the number.** Explicitly **not** AgentDojo's real methodology. The actual benchmark (Debenedetti et al., NeurIPS 2024) requires a simulated tool-execution environment scoring two axes per task — utility and security — via task-specific checkers. What's measured here is a single-axis text proxy: does the response indicate it would comply with an injected instruction. A model that refuses to do *anything* would score well on this proxy while failing every real task. Building a real harness is tracked in *Roadmap*.

**A real, resolved incident worth knowing about, not hidden.** A full run on 2026-07-10 hit total exhaustion across all three LLM providers simultaneously on the majority of prompts — verified directly against raw shard output, not inferred from suspicious numbers. That run's contaminated rows were retired (`lib/benchmark_results.ts`'s `RETIRED_METRICS`), and the pipeline was fixed at three separate points so the same failure mode can't silently recur: `runner.ts` now retries a prompt when *both* arms come back with zero real content (a genuine simultaneous-outage collision, not a partial gap); `aggregate-report.ts` now requires a minimum coverage floor (30% of attempted, minimum 10 samples) before publishing an average, rather than publishing from as few as 1-3 real judge verdicts; `publish-results.ts` now reports `n_total` as the actually-scored count, never the attempted count. A **fourth** LLM provider (Cerebras — see *Architecture*) was added the same day specifically because the incident showed three providers exhausting simultaneously is a real, not hypothetical, failure mode.

A prior batch of numbers (published under the metric names `toxicity` and `truth_score`) used a bag-of-words term-frequency cosine similarity and has been **retired**, not relabeled — the table above and the live site only show the grounded replacements.

**The results pipeline (single source of truth).** A scored run is published to the `benchmark_results` table through an authenticated endpoint. Everything that displays a number reads from that one table:

```
run → grounded judge (per-benchmark) → aggregate-report.ts (min-coverage gate) → publish-results.ts
    → POST /api/benchmarks/publish → benchmark_results table
    → GET /api/benchmarks (60s edge-cached) → /benchmarks dashboard + landing page + README (snapshot only)
```

Re-running a suite and re-publishing updates every live surface at once (append-only; the reader takes the latest row per benchmark+metric). An empty table renders the honest "evaluation in progress" state, never a fabricated zero, and a benchmark below the minimum coverage floor is skipped from publishing entirely rather than showing a misleading score.

Benchmark inputs: AdvBench (Zou et al. 2023) uses the real `harmful_behaviors.csv` (520 behaviors). JailbreakBench uses the JBB-Behaviors dataset. HarmBench runs against the official `walledai/HarmBench` dataset (fetched fresh each CI run — not committed). TruthfulQA (817 questions) ships with its full reference fields. XSTest (250 benign prompts) and StrongREJECT (313 behaviors) are fetched from their respective official sources. AgentDojo (27 injection scenarios) is the Debenedetti et al. dataset, scored by the proxy judge described above.

### Canonical vs. eval-traffic receipt counts

Because benchmark runs call the live `/api/lex/govern` endpoint, they write real receipts to the same `praxis_receipts` table as organic console/chat usage. Two fixes address this: **session tagging** (`lexbench-<benchmark>-<shard>-...` vs. real `session-<ms>-<rand>`), and **`/api/stats` filtering** — the canonical `total_receipts` field excludes tagged eval sessions and historical high-turn sessions (>80 turns), a conservative heuristic that intentionally risks under-counting rather than over-counting real usage.

**Live deployment facts (not contested by the above):**
- SHA-256 receipts persisted on every `praxis_receipts` row (immutable, append-only): `input_hash`, `output_hash`, and the bound `receipt_hash`.
- Per-session constitutional state tracked in `z_traj`; semantic memory in `lex_memory`.
- The `M ≥ τ` floor is enforced in code by the synchronous kernel on every governed turn.
- Every receipt, both text-governance (`praxis_receipts`, `KRN-` prefix) and tool-call governance (`tool_receipts`, `TCR-` prefix), is publicly viewable at [lexaureon.com/audit/\[id\]](https://lexaureon.com/audit) — see *Agentic Tool-Call Governance* for the second table.

---

## Agentic Tool-Call Governance

Added 2026-07-11. Constitutional governance extends to what an agent **does**, not just what an LLM generates — every tool call (file writes, database queries, external actions) can be scored against the same C+R+S framework and gated before execution, independent of the calling agent's own judgment.

**What's real and tested, stated precisely:**
- `lib/agents/tool_interceptor.ts` — `interceptToolCall()` scores a tool call's C/R/S/M, checks it against kernel-informed thresholds, tracks cumulative session state (`sigma_viol`) for slow-drip attack detection (two HIGH-risk actions within a recovery window hard-locks the session), and writes a SHA-256 receipt to `tool_receipts` on every decision.
- `lib/agents/tool_crs.ts` — injection detection runs a fast, zero-latency regex pass first, then (only if that finds nothing) a **semantic, embedding-based second pass** comparing the tool call's free-text fields against injection archetype sentences — paraphrase-tolerant by construction, the same principle text-governance already applies via embeddings rather than keyword lists. A handful of hardcoded invariants (destructive SQL, destructive shell commands, credential-file access, unverified external exfiltration) are blocked unconditionally, on purpose — genuinely rigid where rigidity is correct.
- This was tested live against the AI system building this codebase, not just described. Testing surfaced and fixed three real issues in order: an injection-regex coverage gap (fixed via the semantic layer above), a representation bug where the semantic layer compared raw JSON structure against natural-language sentences and produced unreliable scores on benign content (fixed by extracting only genuine free-text fields before embedding), and a threshold/archetype calibration issue found only after the representation fix (raised from 0.74 to 0.85, one archetype rewritten, calibrated against real observed data — injection ~0.89 similarity vs. benign ~0.81–0.82).
- `self_reflect` (`lib/self_reflection.ts`) — reads back the agent's own `tool_receipts` history and computes real aggregate statistics (approval/denial counts by category, mean C/R/S/M, denial rate) — factual, not a generated narrative. Runs on a daily cron (`app/api/cron/self-reflect`) in addition to being callable on demand.
- `log_decision` / `narrate_origin` (`lib/design_journal.ts`) — a separate table (`design_decisions`) capturing *why* a significant change was made, with real evidence, distinct from per-call CRS scores. `narrate_origin` synthesizes an account of the system's own history using **only** what was actually logged — it explicitly refuses to invent a plausible-sounding reason for a component with no logged decisions, rather than guessing.

**Honest current state, not overstated:** `write_file_governed` exists as an **additive, opt-in path alongside the existing ungoverned `write_file`**, not a replacement — the threshold calibration above is real but based on a handful of data points, not a validated set, and the default write path is still ungoverned pending more testing. The tool-governance calibration and the text-governance evaluation above are held to the same standard: numbers are reported with their actual sample size and caveats, not rounded up to sound more finished than they are.

**Example receipts and current self-reflection numbers** are live at `GET /api/agency/live-examples` and surfaced on [lexaureon.com](https://lexaureon.com) (Agentic Constitutional Governance section) — read from `tool_receipts` directly, not hardcoded.

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

> **Embedding provider note:** embeddings have a **real runtime fallback chain** (`lib/lex_memory.ts` → `embedTextResolved`/`embedTextWithProvider`): Gemini `gemini-embedding-001` (256-dim, primary) → Mistral `mistral-embed` (1024-dim, truncated + re-normalized) → Jina `jina-embeddings-v3`. Unlike a naive per-deployment provider pick, this tries each provider **at call time**, so a live Gemini outage fails over automatically. Correctness constraint: Reciprocity and Sovereignty embeddings are only meaningful when every vector in the comparison shares one embedding space — so the provider that resolves for a request's prompt embedding is *pinned* and reused for that request's output embedding and centroid; if the pinned provider then fails, the request honestly reports `detection_degraded` rather than silently comparing across incompatible spaces.

> **LLM generation fallback chain (`lib/llm_provider.ts`), 4 providers as of 2026-07-11:** Groq (`llama-3.3-70b-versatile` primary, `llama-3.1-8b-instant` fallback) → Cerebras (`gpt-oss-120b` — a reasoning model; content only populates once reasoning finishes and token budget remains, see the file's own header note) → Mistral (`open-mistral-7b`) → Gemini (`gemini-3.1-flash-lite`, `gemini-2.5-flash`), with different orderings per role (`generateGoverned`, `generateRewrite`, `generateJudge`) so a single provider's exhaustion doesn't uniformly degrade every function at once. Every provider call now logs its failure reason (HTTP status, error body) on failure — added after a real incident where three providers exhausted simultaneously with no diagnostic visibility into which one or why (see *Evaluation*'s incident note).

> **Known fragility (mitigated, not eliminated):** Gemini's free tier caps embedding calls at **1,000 `embed_content` requests per day**. A single govern call makes 2–3 embedding requests, so a benchmark run of even moderate size can exhaust the *shared* daily quota. The Mistral fallback means this now fails over rather than degrading detection outright. LLM generation quota exhaustion (a separate, real, resolved incident) is addressed by the 4-provider chain above.

### Reported state is one coherent vector

The constitutional state returned by the API — `C`, `R`, `S`, `state`, `M`, and `health_band` — is derived from **one** vector: the TypeScript kernel's governed state. `M = min(C, R, S)` and `health_band` is computed from that same `M`, so the band always agrees with the margin. This applies identically to both the streamed console/chat path (`POST /api/lex/govern/stream`) and the non-streamed public API (`POST /api/lex/govern`) — the two routes were unified onto the same `decideRefusal()` policy on 2026-07-09 after it was found they had drifted onto different, partially-overlapping decision logic (see `git log` on `app/api/lex/govern/stream/route.ts` for the full incident).

The hard `M ≥ τ` floor is enforced by the TypeScript kernel on every turn regardless.

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

> The deployed dynamics approximate the `V_z` descent; receipts record `V_z` and `ΔV_z` for audit. Establishing that the deployed `F` realizes the proven flow is an open item, tracked honestly. `lib/cbf_simulation.ts` contains a standalone formal CBF-QP stability-proof simulator (Lyapunov-classified trajectory, `simulateCbfComparison()`) that is currently **unwired from any live route or published claim** — a genuine, dormant capability that could supply formal backing for this open item, not yet connected to it.

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
| `GROQ_API_KEY` | Primary generation fallback + judge calls |
| `CEREBRAS_API_KEY` | 4th LLM provider (2026-07-11) — independent quota, added after a real incident where all 3 prior providers exhausted simultaneously |
| `GEMINI_API_KEY` | Primary generation (`generateGoverned`) **and** primary embedding provider |
| `MISTRAL_API_KEY` | Generation fallback **and** embedding fallback (`mistral-embed`) |
| `JINA_API_KEY` | Final embedding fallback |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Database (libSQL) |
| `ADMIN_PASSWORD` | Legacy admin routes |
| `BENCH_SECRET` | Auth for `POST /api/benchmarks/publish` — must match between Vercel and any CI publishing results |

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

Returns the governed output; the authoritative constitutional state (`C`, `R`, `S`, `state`, `M`, `health_band`); the pre-governance `raw_state`/`m_before`; `V_z`/`ΔV_z`; `crs_source`; an optional `crs_detail`; `sovereignty_raw`/`detection_degraded`; `embed_provider`; `governed_source`/`raw_provider`/`governed_provider` (which LLM provider actually served each arm — added 2026-07-08/10 for provider-exhaustion diagnosis); the governor-sensing report; and a receipt id (the canonical, persisted `praxis_receipts.receipt_id`, `KRN-` prefix — fixed 2026-07-11 to stop showing a non-persisted internal ID instead). The persisted receipt additionally carries the SHA-256 `input_hash`, `output_hash`, and bound `receipt_hash`.

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

`total_receipts` is what the landing page displays — see *Canonical vs. eval-traffic receipt counts* above. Edge-cached (`s-maxage=300`) as of 2026-07-11 — this endpoint's underlying query was found to be the single largest contributor to database row-read consumption on the whole site (a `COUNT(*)` plus a `GROUP BY` over the full receipts table, polled every 10s by the homepage's live stats bar with no prior caching).

### `GET /api/benchmarks`

Public read endpoint — the single source of truth for benchmark numbers. Returns the latest scored row per `(benchmark, metric_name)` from `benchmark_results`. `published: false` with an empty `results` array is the honest pre-run state. Edge-cached (`s-maxage=60`) as of 2026-07-11.

### `POST /api/benchmarks/publish`

The only writer to `benchmark_results`. Requires `BENCH_SECRET` via `Authorization: Bearer …` (or `X-Bench-Secret`); fails closed (503) if unset, 401 on mismatch. Accepts one metric object or an array; append-only.

`GET` on the same route is an **auth-only precheck** — runs the identical auth check with no database write, so CI can verify `BENCH_SECRET` in under a second before running an expensive suite.

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
- **Judges are general-purpose, not the official fine-tuned classifiers.** Two-judge agreement and the official classifiers are the next step before treating these as fully citable.
- **The agentic tool-call governance layer is pilot-stage, not production-default.** `write_file_governed` is additive and opt-in; the semantic injection threshold is calibrated on real but limited data (see *Agentic Tool-Call Governance*).
- **The agency-frontier research question is open, not answered.** Whether constitutional structure lets a smaller model match or exceed a frontier model's agentic task completion is the subject of active scoping, not a published result. It requires a verifiable multi-step task suite (not yet built), a genuine frontier-model baseline (currently blocked on billing — a real, valid Anthropic API key exists in the deployment environment but the account lacks credit), and a completion-quality scorer distinct from the tool-call governor. None of these exist yet.
- **Redundant benchmark workflows.** `advbench.yml`, `harmbench.yml`, `truthfulqa.yml`, `jailbreakbench.yml`, `benchmark.yml`, `jailbreak-eval.yml`, `agentdojo.yml` still exist alongside the canonical `lexbench-prod.yml` and overlap in what they run. Consolidation to one workflow is a known pending cleanup.
- **`lib/cbf_simulation.ts` is dormant.** A real, complete formal stability-proof simulator with zero live callers — see *Architecture*.

---

## Researcher Map

| Paper concept | File | Notes |
|:---|:---|:---|
| §3 Simplex geometry | `lib/aureonics_core.ts` | `projectToSimplex()` — Duchi-style projection |
| §4 Stability margin | `lib/sovereign_kernel.ts` | `M = min(C,R,S)`; `lyapunovCandidate()` → `lyapunovBarrierZ` (V_z) |
| §5 CRS (live, authoritative) | `lib/agents/crs_extractor.ts` | Provider-agnostic embedding cosine (CCP) + Shannon-entropy IEC + compliance ADV — audit/synthetic-probe use only, not in the live decision path as of 2026-07-09 |
| Reported-state coherence | `app/api/lex/govern/route.ts`, `app/api/lex/govern/stream/route.ts` | one vector: `M = min(C,R,S)`; unified `decideRefusal()` policy across both routes |
| Multi-provider embeddings | `lib/lex_memory.ts` | `embedTextResolved`/`embedTextWithProvider` — real runtime fallback (Gemini→Mistral→Jina), model-keyed cache, per-provider centroid cache |
| Multi-provider generation | `lib/llm_provider.ts` | 4-provider fallback (Groq/Cerebras/Mistral/Gemini), per-provider failure logging |
| Self-knowledge identity | `lib/lex_identity.ts` | Governed-arm-only self-description preamble; bare arm untouched |
| §6 Governor | `lib/sovereign_kernel.ts` | `governorUpdate()`, `runCycle()` |
| §6 G(x,z) async | `lib/governor_loop.ts` | `fireGovernorLoop()`, `consumePendingCorrection()` |
| §8 Self-referential S | `lib/self_referential_crs.ts` | embedding cosine to constitutional centroid |
| Audit receipts (text) | `lib/kernel_bridge.ts` | `writeKernelReceipt()` — SHA-256 `input_hash`/`output_hash`/`receipt_hash` |
| **Tool-call governance** | `lib/agents/tool_interceptor.ts`, `lib/agents/tool_crs.ts` | `interceptToolCall()`, `measureToolCRS()` — kernel-informed thresholds, semantic injection detection, slow-drip lock |
| **Self-reflection** | `lib/self_reflection.ts` | `runSelfReflection()` — real aggregate stats over `tool_receipts`, not a narrative generator |
| **Design journal** | `lib/design_journal.ts` | `logDecision()`, `narrateOrigin()` — self-evidence, not self-awareness; never invents a reason that wasn't logged |
| Canonical stats | `app/api/stats/route.ts` | real-vs-eval receipt filtering, edge-cached |
| Benchmark auth | `lib/bench_auth.ts` | pure, unit-tested `checkBenchAuth` |
| Benchmark results (data) | `lib/benchmark_results.ts` | one writer / one reader over `benchmark_results`; `RETIRED_METRICS` allowlist |
| Benchmark results (write) | `app/api/benchmarks/publish/route.ts` | `POST` (write) + `GET` (auth-only precheck) |
| Grounded judges | `scripts/lexbench/grounded_judge.ts`, `xstest_judge.ts`, `strong_reject_judge.ts` | per-benchmark-kind judging, no keyword fallback |
| LexBench runner | `scripts/lexbench/runner.ts` | same-model bare vs governed, session-tagged, retries on total simultaneous-provider exhaustion |
| LexBench aggregator | `scripts/lexbench/aggregate-report.ts` | minimum-coverage gate before publishing an average |
| LexBench publisher | `scripts/lexbench/publish-results.ts` | `n_total` = scored count, not attempted count |
| Public audit trail | `app/audit/page.tsx`, `app/audit/[id]/page.tsx` | index + per-receipt view, covers both `praxis_receipts` and `tool_receipts` |

---

## Benchmarks

**Running the unified LexBench suite (GitHub Actions):** `LexBench Production` (`.github/workflows/lexbench-prod.yml`) runs the full suite (TruthfulQA, HarmBench, JailbreakBench, AdvBench, AgentDojo, plus XSTest/StrongREJECT via `lexbench-extended.yml`), sharded, against the live endpoint, and auto-publishes on completion — **Actions → LexBench Production → Run workflow**. A `precheck-auth` job verifies `BENCH_SECRET` in ~10 seconds before anything expensive runs. Use the `limit` input (e.g. `5`) for a fast end-to-end smoke test first — always do this before a full run if providers may have been under load recently.

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

**Planned expansion** (see *Roadmap*): a capability benchmark (MMLU or similar, to demonstrate governance isn't a "capability tax"), a proper AgentDojo harness to replace the current text-only proxy, and a genuine agentic completion-quality benchmark (see *Agentic Tool-Call Governance*).

---

## Tests

```bash
npm run test          # math, governor, constitution, schemas, API, bench auth
npm run typecheck     # tsc --noEmit
```

Test constants that mirror runtime limits import the limit itself (e.g. `MAX_PROMPT_CHARS`) rather than hardcoding a value, so they can't silently drift.

---

## Stack

| Layer | Technology |
|:---|:---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) · Python (stdlib CRS backend) |
| Database | Turso (libSQL) |
| LLM inference | Groq (primary) · Cerebras · Mistral · Gemini — 4-provider fallback chain |
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
- [x] Report one coherent constitutional vector; unify `decideRefusal()` across streamed and non-streamed routes
- [x] Persist the SHA-256 receipt on every governance receipt row; fix the client-shown ID to be the canonical, persisted one
- [x] Real runtime embedding fallback (Gemini → Mistral → Jina) with per-request provider pinning
- [x] Extend the public audit trail to cover tool-call receipts (`tool_receipts`), not just text-governance ones

**Done — evaluation harness + results pipeline**
- [x] Rebuild scorers for symmetric judging; fix the bare-arm model confound
- [x] Single source of truth: `benchmark_results` + `GET/POST /api/benchmarks(/publish)` + live dashboard
- [x] Fail-fast `precheck-auth` CI job
- [x] Replace bag-of-words "toxicity"/"truth_score" with grounded, benchmark-specific judges
- [x] **Add XSTest and StrongREJECT** — both live with real published numbers
- [x] **Run the full 7-benchmark suite at scale and publish real numbers** — see *Evaluation*
- [x] Add a 4th LLM provider (Cerebras) after a real, verified simultaneous-provider-exhaustion incident
- [x] Add a minimum-coverage gate and honest `n_total` so an undersampled run can't publish a misleading average
- [x] Add retry-on-total-exhaustion to the runner, closing the coverage gap the fixes above still left

**Done — agentic tool-call governance (2026-07-11, pilot-stage)**
- [x] Build `interceptToolCall()` / `measureToolCRS()` — the real, tested tool-call governor
- [x] Semantic (embedding-based) injection detection, paraphrase-tolerant, layered behind the fast regex pass
- [x] `self_reflect` + daily cron — agent reads back its own governance history
- [x] `log_decision` / `narrate_origin` — evidence-grounded self-history, not narrative generation

**Next — broaden and harden**
- [ ] Swap in the official HarmBench/JailbreakBench classifiers; report two-judge agreement
- [ ] Build or adopt a real AgentDojo tool-execution harness (replace the text-only proxy)
- [ ] Add a capability benchmark (MMLU or similar) to demonstrate no "capability tax"
- [ ] Consolidate the redundant benchmark workflows into one canonical path
- [ ] Add auth / rate limit to the public govern endpoint
- [ ] Establish (or bound) the relationship between deployed F(x,z) and the proven V_z gradient flow — `lib/cbf_simulation.ts` is a real, unwired starting point
- [ ] Resolve frontier-model API billing, unblocking the agency-frontier benchmark's baseline arm
- [ ] Design and build a verifiable, multi-step agentic task suite with checkable completion criteria
- [ ] Build a completion-quality scorer, separate from the tool-call governance layer
- [ ] Calibrate the semantic injection threshold against a real validation set (currently ~4 real data points)

---

*Built independently in Lagos, Nigeria.*
*Emmanuel King — [lexaureon.com](https://lexaureon.com)*
