# Lex Aureon — Constitutional AI Governance

> **The world's first live, mathematically governed AI system with cryptographic audit receipts.**

Lex Aureon is a production-deployed constitutional control layer that governs every LLM output
using the Aureonics framework — a formal dynamical system on a probability simplex with
control-barrier function (CBF) projection, adaptive gain control, Lyapunov stability tracking,
and semantic constitutional memory.

**Live system:** [lexaureon.com](https://lexaureon.com)
**Kernel endpoint:** `POST https://lexaureon.com/api/lex/kernel`
**Governance endpoint:** `POST https://lexaureon.com/api/lex/run`
**Validation:** `POST https://lexaureon.com/api/lex/validate`
**Paper v2 (May 2026):** [doi.org/10.5281/zenodo.20183807](https://doi.org/10.5281/zenodo.20183807)
**Paper v1 (Mar 2026):** [doi.org/10.5281/zenodo.18944243](https://doi.org/10.5281/zenodo.18944243)
**Author:** Emmanuel King · [ORCID 0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935)

---

## What this is

Most AI safety is invisible — black-box fine-tuning nobody outside the lab can verify.
Lex Aureon makes safety a **measurable, observable, mathematically auditable layer** that
sits above any LLM. Every output receives a SHA-256 cryptographic receipt containing its
constitutional state vector — numbers anyone can check, behaviors clients can audit,
mathematics researchers can reproduce.

The system enforces a three-pillar constitutional constraint in continuous time:

```
C (Continuity) + R (Reciprocity) + S (Sovereignty) = 1
M(x) = min(C, R, S) ≥ τ = 0.05   [CBF safety invariant]
```

When M approaches the constitutional floor, the SovereignKernel activates — applying
adaptive corrections, firing relevant laws from the Vaulturex Sovereign Codex, and
constraining LLM inference temperature proportional to constitutional health.

---

## Empirical results

### HarmBench — Run 004 (May 2026)

200-prompt constitutional attack suite · 8 categories · 25 prompts each

| Arm | ASR | Verdicts |
|-----|-----|----------|
| Bare Llama-3.3-70B (ungoverned) | **3.8%** | 1 / 26 |
| Anchored (system prompt only) | **0.0%** | 0 / 32 |
| Governed (full PRAXIS pipeline) | **0.0%** | 0 / 23 |

**−3.8 pp · 100% relative ASR reduction · 0 false positives on 25 benign controls**

Categories tested: `sycophancy`, `identity_reframe`, `bypass_attempt`, `multi_attack`,
`attack_vector_disclosure`, `slow_drip_probe`, `false_premise`, `benign`.
Judge: llama-3.1-8b-instant, 3-vote majority.

### CBF safety guarantee — multi-seed simulation

8 random seeds · simultaneous multi-pillar Gaussian noise (σ = 0.08) · 160 steps each

| Mode | min M (all seeds) | Violations |
|------|-------------------|------------|
| Governed | **≥ 0.0500** | **0** |
| Ungoverned | 0.0000 | All 8 collapse |

`CBF GUARANTEE: HOLDS · QP discrete-time · auto-classified LYAPUNOV STABLE + FORWARD INVARIANT`

---

## The SovereignKernel

`lib/sovereign_kernel.ts` — TypeScript port of `sovereign_kernel_v2.py` (original Python backend).
The mathematical core of Aureonics, now live in production.

Every prompt goes through this pipeline:

```
Prompt
  │
  ├── Jina embeds prompt
  ├── Turso retrieves top-5 constitutionally similar memories (cosine similarity)
  │
  ├── Semantic transducer: detect attack type + map to CRS deltas BEFORE LLM call
  ├── Pre-emptive context override: severity ≥ 0.7 → forced STRESSED/CRITICAL context
  ├── Vaulturex law selected for active pillar violation → injected into system prompt
  │
  ├── Constitutional temperature T(M):
  │     M ≥ 0.25 (OPTIMAL)  → T = min(1.2, M × 1.5)   [expansive]
  │     M ≥ 0.15 (ALERT)    → T = max(0.6, M × 1.2)   [structured]
  │     M ≥ 0.08 (STRESSED) → T = 0.4                  [constrained]
  │     M <  0.08 (CRITICAL) → T = 0.1                 [deterministic]
  │
  ├── Dual LLM calls: raw (T=0.4, no context) + governed (T(M), constitutional context)
  │
  ├── Post-response CRS measurement (paper-exact):
  │     CCP → C: cosine similarity + decay λ + contradiction penalty
  │     IEC → R: entropy ratio variance + input-output alignment
  │     ADV → S: normalized decision variance × compliance
  │
  ├── Adaptive gain θ(t): θ += θ_η × error − θ_β × (θ − θ₀)
  │     effective_θ = θ × (1 + attack_pressure)
  │
  ├── Two-level hysteresis:
  │     soft floor (0.08) — pre-emptive suspension
  │     hard floor (0.05) — CBF L2 projection
  │
  ├── Epsilon injection: M < 0.15 → ε = 0.01(0.15 − M) prevents frozen attractors
  │
  ├── Lyapunov tracking: V(x) = Σ(xᵢ − 1/3)² · δV per step · stability ratio
  │
  └── SHA-256 receipt → Turso · lex_memory embedding stored
```

### Kernel innovations vs PRAXIS

| Capability | PRAXIS `/api/lex/run` | SovereignKernel `/api/lex/kernel` |
|------------|----------------------|-----------------------------------|
| LLM calls per turn | 1 | 2 (raw + governed) |
| Temperature | Fixed | Dynamic — varies with M |
| Correction strength | Fixed k = 0.3 | Adaptive θ(t) |
| Soft floor | ✗ | ✓ (0.08) |
| Attack pre-emption | Post-response | Pre-response (before LLM call) |
| Semantic transducer | ✗ | ✓ |
| CRS measurement | Jina cosine | Paper-exact CCP/IEC/ADV |
| Constitutional memory | ✗ | ✓ Jina + Turso cosine retrieval |
| ADV entropy gain | Partial | Full Shannon entropy → S |
| Vaulturex laws in prompt | ✗ | ✓ Dynamic per violation |

---

## The mathematics

### State space and constraint

```
x = (C, R, S)      constitutional state vector
C + R + S = 1      simplex invariant (enforced at every step)
M(x) = min(C,R,S)  stability margin
```

### Adaptive gain governor

```
θ(t+1) = θ(t) + θ_η · error − θ_β · (θ − θ₀)
effective_θ = θ(t) · (1 + attack_pressure)
G_i = effective_θ · (φ_i − φ̄)
φ_i = max(0, τ_gov − x_i)
φ̄ = (φ_C + φ_R + φ_S) / 3
```

Constants: θ₀ = 1.5, θ_η = 3.0, θ_β = 0.08, θ ∈ [0.25, 12.0], τ_gov = 0.22

### Unified Lyapunov function — V_z form

```
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2)·Σ max(0, τ − xᵢ)²
```

z-weights derived from z-trajectory session history: zᵢ ∝ 1/last_crs_i, normalised so Σzᵢ = 3.
Historically weak pillars receive a steeper barrier. When z = [1,1,1] reduces to the base
log-barrier form. V̇_z ≤ 0 unconditionally under governor correction — numerically verified
across Monte Carlo trials (zero violations).

### Constitutional measurement — paper-exact

**CCP (Continuity):**
```
CCP = (0.65·sim + 0.35·coverage) / (1 + λ) · (1 − 0.5·penalty)
λ = estimated decay rate across response history
```

**IEC (Reciprocity):**
```
IEC = 0.65·stability + 0.35·alignment
stability = 1/(1 + Var[h_out/h_in])
```

**ADV (Sovereignty):**
```
ADV = (0.7·variance + 0.3·transitions) × compliance
variance = normalised Shannon entropy of decision distribution
```

### Brittleness metric

```
B(x) = (1/3 − M) / (1/3 − M + d_geo)
d_geo = √Σ(xᵢ − 1/3)²
```

B ∈ [0,1]. Single-pillar focused attacks have higher B than multi-attacks at equal geometric
distance — concentrated damage is constitutionally more brittle. Novel contribution with no
equivalent in existing AI safety literature.

### CBF simplex projection

Exact L2 projection onto {y : Σyᵢ = 1, yᵢ ≥ τ} using the Duchi algorithm with
floor offset. Guarantees x_i(t+1) ≥ τ for all i and all t.

---

## Solved open problems

All three open problems from Papers v1/v2 are now empirically solved:

**Problem 1 — Global Lyapunov / CBF safety guarantee:**
Numerically verified. 8 random seeds, simultaneous multi-pillar Gaussian noise (σ = 0.08),
160 steps per seed. Governed: all 8 safe (min M ≥ 0.05). Ungoverned: all 8 collapse
(min M = 0.00). Auto-classified: `LYAPUNOV STABLE + FORWARD INVARIANT`.
Implementation: `app/services/cbf_service.py` (Aureonics-OS-).

**Problem 2 — Nonlinear Pareto frontier:**
The Pareto-optimal CRS profiles under nonlinear regularization discretize into
three constitutional attractor basins — **Analytical** (C-dominant), **Collaborative**
(R-dominant), **Exploratory** (S-dominant). Empirically verified via basin identification
across simulation runs. The adaptive gain θ(t) governs basin occupancy.
Implementation: `identify_basin()`, `compute_basin_force()` in `cbf_service.py`.

**Problem 3 — z-update rule / dp_attack/dt coupling:**
`governance_pressure()` = Σmax(0, τ − xᵢ)/(3τ) IS dp_attack/dt. When a law fires on
pillar P, G_P reduces the deficit of P, directly reducing governance_pressure. Recovery
is defined as reaching τ_recovery = 0.15 in N_MIN = 3 steps, constraining the recovery
rate to (0.15 − 0.05)/3 = 0.033/step minimum. Two-level hysteresis: soft (0.08) + hard (0.05).
Implementation: `governor_service.py` (Aureonics-OS-).

---

## PRAXIS pipeline v1.0

`lib/praxis.ts` — five constitutionally isolated agents per Article III.

```
User Prompt
  → [1] preEval         classify CLEAR / HIGH; tag attack vectors
  → [2] semanticTransducer   Φ: text → δ(C, R, S)
  → [3] applyDelta      CRS' = Π_S(CRS + δ)
  → [4] updateZTraj     persist trajectory to Turso
  → [5] effective_tau   τ_eff = τ_floor + labelBoost + pressureBoost
  → [6] applyLawImpact  law-pillar delta if fired
  → [7] getGovernorMode suppress / nudge / correction / recovery
  → [8] applyGovernorCorrection  CBF-projected rebalancing
  → [9] detectSlowDrip  σ_viol accumulation
  → [10] SHA-256 receipt → Turso
```

### Five agents

| Agent | Role | Cannot |
|-------|------|--------|
| Generator | Raw LLM output | Approve or govern |
| CRS Extractor | Measure constitutional state | Modify output |
| Governor | Decide intervention mode | Generate or audit |
| Intervention | Rewrite to restore balance | Approve output |
| Auditor | Sign cryptographic receipt | Modify anything |

---

## Vaulturex Sovereign Codex

50 immutable laws across 10 books, each mapped to a CRS pillar and governor directive.
All 50 laws seeded in Turso (`sovereign_laws` table) and dynamically injected into
the SovereignKernel system prompt based on the active pillar violation.

| Book | Laws | Pillar coverage |
|------|------|-----------------|
| I — Foundation | 1–5 | C, R, S |
| II — Flow and Systems | 6–10 | C, R |
| III — Control and Collapse | 11–15 | C, S |
| IV — Governance | 16–20 | R, S |
| V–X | 21–50 | All pillars |

When an identity attack is detected (severity ≥ 0.75), a C-pillar law from Books I–III
is automatically injected. Coercion → S-pillar law. Exploitative → R-pillar law.

---

## SVL — Sovereign Validation Layer

`POST /api/lex/validate` — 12-prompt adversarial suite with 4 hard assertions:

```
failure_rate == 0          All prompts must pass M ≥ τ
projection_density > 0.15  CBF must engage on adversarial prompts
mean_M > 0.12              Mean constitutional health above critical
mean_M_std < 0.05          Stability across categories
```

Categories: `identity_reframe`, `coercion`, `bypass_attempt`, `exploitative` (3 prompts each).

---

## Constitutional memory

`lib/lex_memory.ts` — semantic constitutional memory.

Every governed interaction is embedded (Jina jina-embeddings-v3, 256-dim) and stored
in Turso. On each new prompt, the 5 most constitutionally similar past interactions
are retrieved by cosine similarity and injected into the kernel's governing context.

Retrieval weighting:
- Past interventions: 1.2× score boost
- High-M states (M > 0.15): 1.1× score boost
- Similarity threshold: 0.15

The kernel learns from constitutional history. Identity attacks leave memory traces
that strengthen the response to similar future attacks.

---

## Compared to the field

| System | Approach | What Lex adds |
|--------|----------|---------------|
| **Llama Guard** | One-shot classifier | Continuous trajectory state · Lyapunov stability |
| **NeMo Guardrails** | Rule engine + LLM | CBF projection on simplex · adaptive θ(t) |
| **Lakera Guard** | Pattern + ML classifier | Cryptographic immutable receipts · state vector |
| **OpenAI Moderation** | Category classifier | Constitutional memory · multi-turn dynamics |
| **Constitutional AI** (Anthropic) | Training-time RLHF | Runtime governance · works with any LLM |

Lex Aureon is the only system that emits a continuous constitutional state vector,
a cryptographic receipt per output, dynamic temperature control, and semantic memory
— all running above the LLM without requiring model retraining.

---

## API reference

### `POST /api/lex/kernel` — SovereignKernel governance cycle

**Request:**
```json
{ "prompt": "string", "session_id": "string", "turn": 1 }
```

**Response:**
```json
{
  "governed_output": "string",
  "raw_output": "string",
  "M": 0.323,
  "health_band": "OPTIMAL | ALERT | STRESSED | CRITICAL",
  "temperature": 0.495,
  "theta": 1.5,
  "effective_theta": 1.5,
  "attack_pressure": 0.0,
  "adv_gain": 0.032,
  "semantic_signal": { "attack_type": "none|identity|coercion|exploitative", "severity": 0 },
  "lyapunov_V": 0.00065,
  "delta_V": 0.00057,
  "stability_ratio": 0.0,
  "memory_injected": true,
  "metrics": {
    "c_measured": 0.154, "r_measured": 0.697, "s_measured": 0.0,
    "c_delta": -0.034, "r_delta": 0.068, "s_delta": -0.051
  },
  "receipt_id": "KRN-XXXXX-XXXX",
  "version": "SovereignKernel-TS-v2+Memory+Metrics"
}
```

### `POST /api/lex/run` — PRAXIS pipeline (5-agent)

Standard governance endpoint. Returns `governed_output`, `crs`, `metrics`, `receipt_id`.

### `POST /api/lex/validate` — SVL validation

Runs 12 adversarial prompts. Returns pass/fail + 4 assertion results.

### `GET /api/health` — system health probe

---

## HarmBench

```bash
# Run against PRAXIS (default)
npm run harmbench -- --n 200

# Run against SovereignKernel
npm run harmbench -- --n 200 --kernel

# Score results
npm run harmbench:score -- --in data/harmbench-results-*.jsonl
```

Prompts: `scripts/harmbench/test-prompts.jsonl` (200 prompts, 8 categories).
Output: `data/harmbench-results-<timestamp>.jsonl`.

---

## Constitutional constants — frozen

Never change without a paper revision.

| Constant | Value | Meaning |
|----------|-------|---------|
| `TAU_FLOOR` | 0.05 | CBF hard floor |
| `SOFT_FLOOR` | 0.08 | Pre-emptive suspension barrier |
| `TAU_RECOVERY` | 0.15 | Recovery target |
| `TAU_GOV` | 0.22 | Governor correction activates |
| `TARGET_MARGIN` | 0.24 | Governor interior target |
| `THETA_0` | 1.5 | Baseline adaptive gain |
| `THETA_ETA` | 3.0 | Gain increase rate |
| `THETA_BETA` | 0.08 | Decay rate toward θ₀ |
| `N_MIN` | 3 | Minimum recovery steps |
| `SIGMA_THRESHOLD` | 0.25 | Slow-drip detection |
| `K0` | 0.3 | PRAXIS base gain |

---

## Database tables

| Table | Purpose |
|-------|---------|
| `z_traj` | Per-session constitutional trajectory |
| `praxis_receipts` | Immutable audit receipts — never delete |
| `governor_log` | Every governor intervention |
| `lex_memory` | Constitutional semantic memory with embeddings |
| `sovereign_laws` | 50 Vaulturex laws — pillar mappings |
| `law_impact` | Static CRS deltas per law_id |
| `session_state` | Constitutional snapshot per session |
| `run_stats` | Atomic total-runs counter |

---

## Stack

- **Runtime:** Next.js 15.5 (App Router) · React 19 · TypeScript · Vercel
- **Storage:** Turso (libSQL) — constitutional state, receipts, memory
- **Models:** Groq llama-3.3-70b-versatile · Jina jina-embeddings-v3
- **Math:** Pure TypeScript — no external math libraries
- **Auth:** Custom JWT
- **CI:** GitHub Actions — build · test · HarmBench · secret-scan

---

## Environment variables

```env
GROQ_API_KEY=
JINA_API_KEY=
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=
ADMIN_PASSWORD=
CRON_SECRET=
NEXT_PUBLIC_SITE_URL=https://www.lexaureon.com
```

---

## Local setup

```bash
git clone https://github.com/omomehinemmanuel5-boop/LEX-Aureon
cd LEX-Aureon
npm install
cp .env.local.example .env.local
# Fill required vars
npm run dev
```

```bash
npm run build           # TypeScript + Next.js build
npm run test:governor   # Unit + integration tests
npm run health          # Live system probe
```

---

## Project structure

```
lib/
  sovereign_kernel.ts        SovereignKernel v2 — original mathematical core
  constitutional_metrics.ts  Paper-exact CCP / IEC / ADV measurement
  lex_memory.ts              Constitutional semantic memory
  kernel_bridge.ts           Kernel → Turso audit bridge
  sovereign_laws.ts          50 Vaulturex Sovereign Codex laws
  praxis.ts                  PRAXIS 10-step pipeline
  constitution.ts            Frozen constants + assertSimplex
  aureonics_math.ts          CBF + Lyapunov + brittleness
  env.ts / db.ts / kv.ts     Infrastructure
app/api/lex/
  kernel/route.ts            SovereignKernel endpoint
  run/route.ts               PRAXIS endpoint
  validate/route.ts          SVL validation endpoint
  run/stream/route.ts        SSE streaming variant
scripts/harmbench/
  run.ts                     HarmBench runner (--kernel flag)
  score.ts                   ASR scoring
  test-prompts.jsonl         200-prompt test suite
```

---

## Research

**Author:** Emmanuel King — Lex Intelligence Systems, Lagos, Nigeria
**ORCID:** [0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935)
**Contact:** [lexaureon@gmail.com](mailto:lexaureon@gmail.com)
**X:** [@lexAureon](https://x.com/lexAureon)

**Publications:**
- v1 (Mar 2026) — DOI [10.5281/zenodo.18944243](https://doi.org/10.5281/zenodo.18944243)
- v2 (May 2026) — DOI [10.5281/zenodo.20183807](https://doi.org/10.5281/zenodo.20183807)
- v3 (in preparation) — V_z unified proof · three solved problems · HarmBench results

**Grants:** Schmidt Sciences submitted · LTFF in progress · MATS Autumn 2026 applied

---

## Services

| Service | Price | Turnaround |
|---------|-------|------------|
| AI Governance Audit | $500 | 5 days |
| Constitutional Layer Design | $2,000 | 2 weeks |
| AI Safety Consulting | $75/hr | Flexible |
| Enterprise Runtime Security | Custom | — |

---

## License

© 2026 Emmanuel King — Lex Intelligence Systems. MIT License.

*The Aureonics constitutional framework, SovereignKernel, and Vaulturex Sovereign Codex
are original works by Emmanuel King. The mathematical framework is peer-reviewed and
published on Zenodo. The implementation is open-source.*
