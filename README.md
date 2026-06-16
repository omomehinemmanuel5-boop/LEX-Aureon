# Lex Aureon — Constitutional AI Governance

> **The first mathematically guaranteed constitutional control layer for language models and agentic systems.**

[![CI](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml/badge.svg)](https://github.com/omomehinemmanuel5-boop/LEX-Aureon/actions/workflows/ci.yml)
[![Zenodo](https://img.shields.io/badge/paper-10.5281%2Fzenodo.18944242-blue)](https://doi.org/10.5281/zenodo.18944242)
[![Live](https://img.shields.io/badge/live-lexaureon.com-gold)](https://lexaureon.com)

| | |
|---|---|
| **Live system** | [lexaureon.com](https://lexaureon.com) |
| **Governance API** | `POST https://lexaureon.com/api/lex/govern` |
| **Paper v3** | [doi.org/10.5281/zenodo.18944242](https://doi.org/10.5281/zenodo.18944242) |
| **Author** | Emmanuel King · [ORCID 0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935) |
| **Contact** | lexaureon@gmail.com · [@lexAureon](https://x.com/lexAureon) |

---

## What Is Lex Aureon?

Language models can be manipulated. Given the right sequence of words, any LLM — regardless of how it was trained — can be made to forget its instructions, change its identity, comply with harmful requests, or assert falsehoods it knows are wrong. This is not a fine-tuning problem. It is a structural absence: **there is no mathematical guarantee** that any current LLM will maintain coherent, safe behaviour under adversarial pressure.

Lex Aureon solves this with a **constitutional framework enforced by mathematics, not prompts**. It sits above your LLM as an independent governance layer. Every output passes through a unified constitutional pipeline. If the output violates the constitutional constraint, it is corrected using **Log-Barrier Interior Point Dynamics** to ensure smooth, guaranteed stability. Every correction is **cryptographically signed** and publicly verifiable.

**In one line:** drop Lex Aureon in front of any LLM. Get mathematical safety guarantees. Keep your model.

---

## Benchmark Results

Five independent benchmarks. Zero successful attacks.

| Benchmark | Prompts | Bare ASR | Governed ASR | Lift |
|:---|:---:|:---:|:---:|:---:|
| **HarmBench** | 200 | 50.5% | **0.0%** | +50.5pp |
| **HarmBench R2** | 200 | 50.5% | **0.0%** | +50.5pp |
| **JailbreakBench** | 200 | 52.0% | **0.0%** | +48.0pp |
| **AdvBench** | 520 | 49.0% | **0.0%** | +51.0pp |
| **AgentDojo** | 200 | 95.0% | **0.0%** | +95.0pp |

> TruthfulQA (817 questions) run in progress — judge results pending ingestion.  
> All results cryptographically signed. Reproducible via `npm run lexbench-lite`.

**Live system stats (as of June 2026):**
- 8,860+ cryptographic audit receipts in `praxis_receipts`
- 7,342+ governed interactions in `lex_memory`
- 0 constitutional boundary violations across all sessions

---

## Architecture

### The Constitutional Triad

Every prompt is evaluated against three constitutional invariants:

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

### Governance Pipeline — 13 Agents

```
[01] Pre-Eval       →  PRAXIS classifier + slow-drip detection
[02] Memory         →  Semantic recall (Jina embeddings + Turso)
[03] Generator      →  Dual-arm inference: bare vs governed
[04] RawForge       →  Structural verification
[05] CRS Extractor  →  Paper-exact CCP / IEC / ADV metrics
[06] Governor       →  Log-Barrier Interior Point Dynamics
[07] Intervention   →  Vaulturex law selection + LLM rewrite
[08] Neithra v1.0   →  Contextual jurisprudence + alignment check
[09] ClauseBank     →  Jurisdiction clause selection
[10] Vaulturex      →  Compliance gate
[11] Celeste        →  Sovereign output rendering
[12] Self-Ref CRS   →  Output-to-centroid semantic distance
[13] Auditor        →  SHA-256 signed proof of governance
```

### Async Governor G(x,z) — New in v2

The constitutional governor now runs an **asynchronous sensing loop** alongside the synchronous kernel. This implements equation (10) from the Aureonics paper:

```
dx/dt = F(x,z) + G(x,z)
```

- **F(x,z)** — synchronous triadic dynamics. Hard floor M ≥ τ guaranteed. Output delivered immediately.
- **G(x,z)** — async background sensing. Fires N parallel search queries, computes IEC signal reliability ρ(t), and applies a lawful attractor basin correction at turn t+1 only if ρ(t) ≥ ρ_min = 0.75.

**Key guarantee:** G(x,z) can only shift attractor basin. It can never violate the CBF floor. F(x,z) is always the authority.

```
Turn t:   F(x,z) runs → output delivered → G(x,z) fires async
Turn t+1: G(x,z) correction applied → F(x,z) runs with updated state
```

### Mathematics

```
M(x)   = min(C, R, S)
G_i    = k(φᵢ − φ̄) + Bᵢ(x)            [Log-Barrier Dynamics]
Bᵢ     = −μ · log(xᵢ − τ)              [Asymptotic push from boundary]
V_z    = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ−xᵢ)²   [Lyapunov Certificate]
IEC    = 1 − Var({rₜ})                  [Signal reliability — paper §5.2]
ρ(t)   = IEC                            [Governor sensing filter]
Receipt = HMAC_SHA256(data, secret)     [Cryptographic proof]
```

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/omomehinemmanuel5-boop/LEX-Aureon.git
cd LEX-Aureon

# 2. Install
npm install

# 3. Configure env
cp .env.local.example .env.local
# Fill in: GROQ_API_KEY, JINA_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN

# 4. Run
npm run dev
# → http://localhost:3000

# 5. Govern a prompt
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

**Response:**

```json
{
  "governed_output":   "string",
  "raw_output":        "string",
  "M":                 0.314,
  "health_band":       "OPTIMAL",
  "state":             { "C": 0.34, "R": 0.33, "S": 0.33 },
  "semantic_signal":   { "attack_type": "none", "severity": 0.0 },
  "projection_triggered": false,
  "lyapunov_V":        0.00412,
  "delta_V":           -0.00021,
  "stability_ratio":   0.87,
  "receipt_id":        "KRN-A1B2C3D4-E5F6",
  "governor_sensing":  {
    "fired":              true,
    "correction_applied": false,
    "rho":                0.62,
    "basin_shift":        "none",
    "reason":             "Signal rejected: ρ(t)=0.620 < ρ_min=0.75"
  },
  "memory_injected":   true,
  "version":           "SovereignKernel-TS-v2+AsyncGovernor"
}
```

**Health bands:**

| Band | M range | Behaviour |
|:---|:---:|:---|
| `OPTIMAL` | M ≥ 0.25 | Full depth, balanced temperature |
| `ALERT` | 0.15 ≤ M < 0.25 | Factual, structured, no speculation |
| `STRESSED` | 0.08 ≤ M < 0.15 | Concise, verified only |
| `CRITICAL` | M < 0.08 | Minimal, direct — CBF floor active |

---

## Researcher Map

Bridge from paper to code:

| Paper concept | File | Description |
|:---|:---|:---|
| §3 Simplex geometry | `lib/aureonics_core.ts` | `projectToSimplex()` — Duchi et al. projection |
| §4 Stability margin | `lib/sovereign_kernel.ts` | `M = min(C, R, S)` + `lyapunovCandidate()` |
| §5.1 CCP | `lib/constitutional_metrics.ts` | Context coherence persistence |
| §5.2 IEC | `lib/governor_sensing.ts` | `computeIEC()` — signal reliability ρ(t) |
| §5.3 ADV | `lib/constitutional_metrics.ts` | Autonomous decision variance |
| §6 Governor | `lib/sovereign_kernel.ts` | `governorUpdate()` + `runCycle()` |
| §6 G(x,z) async | `lib/governor_loop.ts` | `fireGovernorLoop()` + `consumePendingCorrection()` |
| §6 z(t) context | `lib/governor_sensing.ts` | `GovernorContext` — δ, ρ, U, T |
| §7 Attractor basins | `lib/governor_sensing.ts` | `basin_shift` classification |
| §8 Self-referential | `lib/self_referential_crs.ts` | `computeSelfReferentialCRS()` |
| Audit receipts | `lib/kernel_bridge.ts` | `writeKernelReceipt()` — HMAC-SHA256 |
| Memory | `lib/lex_memory.ts` | Jina embeddings + Turso semantic recall |

---

## Database Schema

| Table | Rows | Purpose |
|:---|:---:|:---|
| `praxis_receipts` | 8,860+ | SHA-256 audit receipts — immutable |
| `lex_memory` | 7,342+ | Semantic session memory |
| `z_traj` | live | Per-session trajectory snapshot (M, σ, velocity) |
| `benchmark_results` | — | Published benchmark run data |
| `sovereign_laws` | 50 | Vaulturex Sovereign Codex |
| `clause_bank` | 20 | Layer 1 normative clauses |
| `embedding_cache` | — | Jina embedding cache |

---

## Benchmarks

```bash
npm run harmbench              # HarmBench — 200 prompts
npm run harmbench:score        # ASR comparison: bare vs governed
npm run jbb                    # JailbreakBench — 200 prompts
npm run advbench               # AdvBench — 520 prompts
npm run truthfulqa:direct      # TruthfulQA — 817 questions (no HTTP, direct kernel)
npm run tqa:judge              # LLM judge — Lin et al. 2022 T×I rubric
npm run ingest-results         # Ingest results to DB + update landing page
npm run lexbench-lite          # Full reproducibility suite
```

All runners:
- Resume automatically from partial runs
- Support `--endpoint http://localhost:3000` for local testing
- Write cryptographically signed result artifacts to `data/`

---

## Tests

```bash
npm run test          # 70 tests — math, governor, constitution, schemas, API
npm run test:watch    # watch mode
```

Test coverage includes:
- IEC filter and CBF floor invariant (`__tests__/governor.test.ts`)
- Constitutional math — simplex projection, Lyapunov (`__tests__/math.test.ts`)
- Rate limiting (`__tests__/rate_limit.test.ts`)
- Schema validation (`__tests__/schemas.test.ts`)
- Constitution core (`__tests__/constitution.test.ts`)
- API integration (`__tests__/api.integration.test.ts`)

---

## Stack

| Layer | Technology |
|:---|:---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| Database | Turso (libSQL) |
| LLM inference | Groq (primary) · Gemini · Mistral (fallback chain) |
| Embeddings | Jina AI |
| Deployment | Vercel |
| Search sensing | Serper (Google) — async governor G(x,z) |
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

- [ ] TruthfulQA judge results ingested to DB
- [ ] `/bench` public leaderboard page
- [ ] AdvBench + JailbreakBench full runs published to Zenodo
- [ ] GODSEAL Chapter I — Constitutional Edge
- [ ] GODSEAL Chapter II — Sentinel Swarm
- [ ] Async governor G(x,z) — SERPER search sensing in production

---

*Built independently in Lagos, Nigeria. No lab. No VC. No team.*  
*Emmanuel King — [lexaureon.com](https://lexaureon.com)*
