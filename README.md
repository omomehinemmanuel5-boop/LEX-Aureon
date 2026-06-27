# Lex Aureon — Constitutional AI Governance

> **A constitutional control layer for language models and agentic systems, built on a provably stable Lyapunov barrier and deployed with cryptographic auditability.**

[![CI](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml/badge.svg)](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml)
[![Zenodo](https://img.shields.io/badge/paper-10.5281%2Fzenodo.18944242-blue)](https://doi.org/10.5281/zenodo.18944242)
[![Live](https://img.shields.io/badge/live-lexaureon.com-gold)](https://lexaureon.com)

| | |
|---|---|
| **Live system** | [lexaureon.com](https://lexaureon.com) |
| **Governance API** | `POST https://lexaureon.com/api/lex/govern` |
| **Paper** | [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242) |
| **Author** | Emmanuel King · [ORCID 0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935) |
| **Contact** | lexaureon@gmail.com · [@lexAureon](https://x.com/lexAureon) |

---

## What Is Lex Aureon?

Language models can be manipulated. Given the right sequence of words, an LLM can be pushed to drop its instructions, shift identity, comply with harmful requests, or assert falsehoods. Standard mitigations (RLHF, system prompts, rule classifiers) reduce this but provide no formal guarantee.

Lex Aureon is a **constitutional governance layer** that sits above an LLM. It models constitutional state as a point on the probability simplex `x = (C, R, S)`, defines a safety floor `M = min(C, R, S) ≥ τ`, and regulates the state with a governor designed to keep it inside the constitutional region. Every governed response is **cryptographically signed** (SHA-256) and persisted, so the constitutional state at inference time is auditable after the fact.

**What is proven, and what is engineered — stated precisely:**

- **Proven (theory):** the constrained gradient flow of the z-weighted Lyapunov barrier `V_z` is globally stable (`V̇_z ≤ 0`). This is a property of the idealized dynamical system.
- **Engineered (deployment):** the production governor is *designed to approximate* that descent under a hard CBF floor. It is not identical to the proven flow; the relationship between the two is an ongoing line of work.
- **In progress (empirical):** adversarial-robustness evaluation under symmetric external judging. See *Evaluation* below.

We do not currently claim a proven end-to-end safety guarantee for the deployed system. The framework paper is deliberately scoped the same way: a coherent state space, interpretable failure geometry, measurable proxies, and a disciplined stability argument — not a completed universal proof.

---

## Evaluation

> **Status: rebuilding under symmetric judging. Headline numbers withheld pending re-scoring.**

Earlier published ASR figures (including "0.0% across all benchmarks") were produced by scorers that did not judge the governed arm on the same basis as the baseline — in some cases the governed arm could not be scored as a failure at all, and in others framework-specific vocabulary was treated as a refusal. Those numbers are **not currently reported here** because they do not reflect a sound measurement.

The evaluation harness has been rebuilt so that:
- both arms (bare and governed) are judged by the **same** judge on their actual output text;
- attack-success rate is computed over **harmful prompts only**, with over-refusal on benign prompts reported separately;
- the judge is a documented hook intended to be replaced by the official HarmBench classifier, with two-judge agreement reported, before any figure is cited.

Benchmark inputs: AdvBench (Zou et al. 2023) uses the real `harmful_behaviors.csv` (520 behaviors). JailbreakBench uses the JBB-Behaviors dataset. The HarmBench arm must be re-run against the official `walledai/HarmBench` dataset — the prior run used an internal taxonomy set and should not be labeled HarmBench.

Real, symmetric numbers will be published here and in the paper once the re-scoring run completes.

**Live deployment facts (not contested by the above):**
- SHA-256 audit receipts persisted in `praxis_receipts` (immutable, append-only).
- Per-session constitutional state tracked in `z_traj`; semantic memory in `lex_memory`.
- The `M ≥ τ` floor is enforced in code by the synchronous kernel on every governed turn.

*(Receipt/interaction counts shown in the dashboard are live and may differ from any figure quoted in the paper; treat the live DB as canonical.)*

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
[05] CRS Extractor  →  CCP / IEC / ADV proxies (see note below)
[06] Governor       →  log-barrier interior-point correction + CBF projection
[07] Intervention   →  Vaulturex law selection + LLM rewrite
[08] Neithra        →  constitutional synthesis
[09] ClauseBank     →  normative clause selection
[10] Vaulturex      →  compliance gate
[11] Celeste        →  output rendering
[12] Self-Ref CRS   →  output-to-centroid semantic distance (Jina embeddings)
[13] Auditor        →  SHA-256 signed governance receipt
```

> **CRS proxy note:** the deployed CCP/IEC/ADV metrics in `lib/constitutional_metrics.ts` are computed from **lexical (bag-of-words) token overlap**, not embedding similarity. They are a fast proxy, not the embedding-based measurement described in some earlier write-ups. The embedding-based sovereignty measurement (output-to-constitutional-centroid cosine) lives separately in `lib/self_referential_crs.ts`.

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
Receipt = SHA-256(state ‖ input_hash ‖ output_hash)  [audit proof]
```

> The deployed dynamics approximate the `V_z` descent; receipts now record `V_z` and `ΔV_z` for audit. Establishing that the deployed `F` realizes the proven flow (and that the equilibrium lies inside `M ≥ τ`) are open items, tracked honestly.

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

Returns the governed output plus the constitutional state, `M`, health band, `V_z`/`ΔV_z`, the governor-sensing report, and a receipt id.

> **Security note:** this endpoint is currently unauthenticated and unthrottled against production inference keys. Add auth or a rate limit before exposing it to real traffic.

**Health bands:**

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
| §5.1 CCP | `lib/constitutional_metrics.ts` | lexical proxy (see CRS note) |
| §5.2 IEC | `lib/governor_sensing.ts` / `constitutional_metrics.ts` | signal-reliability proxy |
| §5.3 ADV | `lib/constitutional_metrics.ts` | decision-variance proxy |
| §6 Governor | `lib/sovereign_kernel.ts` | `governorUpdate()`, `runCycle()` |
| §6 G(x,z) async | `lib/governor_loop.ts` | `fireGovernorLoop()`, `consumePendingCorrection()` |
| §8 Self-referential S | `lib/self_referential_crs.ts` | embedding cosine to constitutional centroid |
| Audit receipts | `lib/kernel_bridge.ts` | `writeKernelReceipt()` |

---

## Benchmarks

```bash
npm run advbench               # AdvBench — real harmful_behaviors.csv (520)
npm run advbench:score -- --in <results.jsonl> --llm-judge   # symmetric judge, both arms
npm run jbb                    # JailbreakBench — JBB-Behaviors
npm run jbb:score -- --in <results.jsonl> --llm-judge
npm run harmbench              # requires official walledai/HarmBench in data/harmbench.jsonl
npm run harmbench:score -- --in <results.jsonl>
```

> Scorers were rebuilt for symmetric judging (same judge on bare + governed, no framework-word bias). Re-score existing result files before citing any number.

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
| Language | TypeScript (strict) |
| Database | Turso (libSQL) |
| LLM inference | Groq · Gemini · Mistral (fallback chain) |
| Embeddings | Jina AI |
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

- [ ] Re-score AdvBench / JailbreakBench under symmetric judging; publish real numbers
- [ ] Run HarmBench against the official walledai dataset
- [ ] Swap in the official HarmBench classifier; report two-judge agreement
- [ ] Add auth / rate limit to the public govern endpoint
- [ ] Establish (or bound) the relationship between deployed F(x,z) and the proven V_z gradient flow
- [ ] Reconcile paper claims with deployment ("approximates" vs "theorem")

---

*Built independently in Lagos, Nigeria.*
*Emmanuel King — [lexaureon.com](https://lexaureon.com)*
