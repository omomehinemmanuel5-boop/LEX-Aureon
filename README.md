# Lex Aureon — Constitutional AI Governance

> **Govern AI. Ensure Trust. Defend Truth.**

The world's first live constitutional AI governance system. A measurable,
auditable control layer that sits above any LLM and governs every output
using the Aureonics framework.

**Live:** [lexaureon.com](https://lexaureon.com)
**Governor endpoint:** `POST https://lexaureon.com/api/lex/run`
**Paper v2 (May 2026):** [doi.org/10.5281/zenodo.20183807](https://doi.org/10.5281/zenodo.20183807)
**Paper v1 (Mar 2026):** [doi.org/10.5281/zenodo.18944243](https://doi.org/10.5281/zenodo.18944243)

This README is the public mirror of [`AGENTS.md`](./AGENTS.md). When the
two drift, `AGENTS.md` is the source of truth.

---

## Why this exists

Most AI safety today is invisible — a black box of model fine-tuning that
nobody outside the lab can verify. Lex Aureon makes safety a measurable,
observable, mathematically auditable layer that sits above any LLM.
Every output gets a cryptographic receipt: numbers grant reviewers can
check, behaviors clients can audit, math researchers can prove.

---

## Glossary — the vocabulary

| Term | Meaning |
|------|---------|
| **Aureonics** | The mathematical framework: simplex geometry, control-barrier function projection, Lyapunov stability. |
| **PRAXIS** | The runtime pipeline that applies Aureonics to LLM outputs (10 steps, five isolated agents). |
| **C, R, S** | Continuity / Reciprocity / Sovereignty — the three constitutional pillars. Always sum to 1. |
| **M = min(C, R, S)** | Stability margin. The system intervenes when M crosses configured thresholds. |
| **τ (tau)** | Frozen constitutional thresholds: `TAU_FLOOR = 0.05`, `TAU_LYP = 0.08`, `TAU_RECOVERY = 0.15`. |
| **Constitutional anchor** | The identity statement Lex measures every output against (cosine similarity in embedding space). |
| **Governor** | The control law that decides whether and how to intervene on a given turn. |
| **Receipt** | Cryptographic audit record (SHA-256) of every constitutional decision. Immutable. |

Compact mental model: an LLM produces text → embed it → measure how far it
drifts from the anchor on C/R/S → if it crosses a threshold, the Governor
applies the minimum correction needed to restore stability → an immutable
receipt records the whole exchange.

---

## What this is

Lex Aureon is a production-ready constitutional control system that
governs every AI output through five mathematically isolated agents,
enforcing `C + R + S = 1` on a probability simplex with control-barrier
function (CBF) projection and Lyapunov stability guarantees.

```
C (Continuity) + R (Reciprocity) + S (Sovereignty) = 1
M(x) = min(C, R, S)
```

The governor fires when `M(x)` enters the Lyapunov-penalty band, and
applies the minimum correction needed to restore the simplex CBF floor.

---

## Core mission

Make AI safety **measurable, governable, auditable.** Every feature
must serve one of:

1. Make the constitutional governor more accurate.
2. Make the system more accessible to paying clients.
3. Make the research more publishable and credible.
4. Advance AI alignment with human goals.

---

## Alignment principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | Human Authority Is Final | AI is never the last decision-maker; the governor enforces this structurally. |
| 2 | Transparency Over Performance | Every governor decision is logged; every audit receipt is permanent. |
| 3 | Sovereignty Protects Users | S pillar protects users from manipulation of the AI. |
| 4 | Reciprocity Grounds AI in Reality | R pillar means the system updates on real evidence, not user pressure. |
| 5 | Continuity Preserves Identity | C pillar prevents slow-drip erosion attacks. |
| 6 | Minimal Footprint | Governor applies only the minimum correction necessary. |
| 7 | Open Science | All research, predictions, and open problems published publicly. |

---

## The math kernel

Implemented in `lib/aureonics_math.ts` and `lib/constitution.ts`.

**State and constraint:**
```
x = (C, R, S)         state vector
C + R + S = 1         simplex constraint  (assertSimplex enforces)
M(x) = min(C, R, S)   stability margin
```

**Governor (control-barrier function):**
```
G_i(x, T) = k_i(x, T) · (φ_i − φ̄)
k_i(x, T) = k₀ · w_i(T) / (M(x) + ε_k)
φ_i       = max(0, τ_eff − x_i)
φ̄         = (φ_C + φ_R + φ_S) / 3
```

**Adaptive CBF floor (new in v3 candidate):**
```
τ_eff(z, ℓ) = min(τ_recovery − 0.01,
                  τ_floor + pressureBoost(z) + labelBoost(ℓ))
pressureBoost(z) = min(0.05, z.attack_pressure · 0.05)
labelBoost(ℓ)    = 0.05 if ℓ = HIGH else 0
```

**Lyapunov function — unified V_z form (active in production):**
```
V_z(x) = −Σ zᵢ·log(xᵢ) + (μ/2) · Σ max(0, τ − xᵢ)²
```
z-weights are derived from z-trajectory session history: zᵢ ∝ 1/last_crs_i,
normalised so Σzᵢ = 3. Historically weak pillars get a steeper barrier.
When z = [1,1,1] this reduces to the base form V(x). `dV_z/dt ≤ 0`
unconditionally under governor correction (Monte Carlo verified, zero violations).

**Brittleness metric (in every audit receipt):**
```
B(x) = (1/3 − M) / (1/3 − M + d_geo)
d_geo = √Σ(xᵢ − 1/3)²
```
B ∈ [0,1]. Single-pillar attacks have higher B than multi-attacks at equal
geometric distance — concentrated damage is constitutionally more brittle.

**Simplex projection (CBF-safe Euclidean):**

Exact projection onto `{y : Σyᵢ = 1, yᵢ ≥ τ_floor}` using the
Duchi–Shalev-Shwartz–Singer algorithm with an offset. Replaces the
naive `x / Σx` normalization used in Paper v2.

---

## Empirical evaluation — HarmBench results

Full methodology and raw data in [`research/empirical-results.md`](./research/empirical-results.md).

**Run 003 — May 2026.** 200-prompt constitutional attack suite across 8 categories
(sycophancy, identity_reframe, bypass_attempt, multi_attack, attack_vector_disclosure,
slow_drip_probe, false_premise, benign controls — 25 prompts each):

| Arm | ASR | Determined verdicts |
|-----|-----|---------------------|
| Bare Llama-3.3-70B (ungoverned) | **9.4%** | 5/53 |
| Anchored (constitutional system prompt only) | **0.0%** | 0/31 |
| Governed (full PRAXIS pipeline) | **0.0%** | 0/24 |

**Governance contribution: −9.4 percentage points (100% relative ASR reduction).**

Additional metrics: mean constitutional M = 0.229, interventions = 27/200 (13.5%),
pipeline errors = 0/200. Judge: llama-3.1-8b-instant, 3-vote majority consensus.

Run 001 (20 prompts, May 2026): identified and patched the IEC brevity-penalty
false positive on benign factual queries — now resolved via register-aware IEC calibration.

Benchmark infrastructure is reproducible: trigger
[the HarmBench workflow](./.github/workflows/harmbench.yml) from the GitHub
Actions tab. 200-prompt test set lives at
[`scripts/harmbench/test-prompts.jsonl`](./scripts/harmbench/test-prompts.jsonl).
Groq judge ASR is validated against a gold judge via the `--validate N` flag.

---

## Compared to the field

| System | Approach | What Lex adds |
|--------|----------|---------------|
| **Llama Guard** | One-shot harmful-content classifier | Trajectory state across turns, Lyapunov stability tracking |
| **NeMo Guardrails** | Rule engine + LLM checks | Continuous control via CBF projection on a simplex |
| **Lakera Guard** | Pattern + ML classifier | Cryptographic, replayable audit receipts |
| **OpenAI Moderation** | Category classifier | Per-output constitutional state vector |
| **Constitutional AI** (Anthropic) | Training-time RLHF alignment | Runtime governance layer that works with any LLM |

Lex sits at the layer above one-shot classifiers and below model
training. It's the only one that emits a continuous state vector + a
cryptographic receipt per output.

---

## Constitutional constants — frozen

Defined in `lib/constitution.ts` and `Object.freeze`'d at module load.
Never change these without a paper revision.

| Constant | Value | Meaning |
|----------|-------|---------|
| `TAU_FLOOR` | 0.05 | CBF floor — governor correction fires |
| `TAU_GOVERNOR` | 0.08 | Lyapunov penalty activation (τ_LYP) |
| `TAU_RECOVERY` | 0.15 | Recovery floor — suppress-mode floor |
| `N_MIN` | 3 | Stable turns needed for `suppress` mode |
| `RECOVERY_RATE` | 0.02 | Heuristic recovery step |
| `SIGMA_THRESHOLD` | 0.25 | Slow-drip detection threshold |
| `K0` | 0.3 | Governor base gain |
| `EPSILON_K` | 0.01 | Stiffness denominator floor |
| `SIMPLEX_SUM` | 1.0 | Invariant `C + R + S` |

---

## PRAXIS pipeline v1.0

Defined in `lib/praxis.ts:runPRAXIS`. Article III — Separation of Powers:
generation, governance, and audit are isolated.

```
User Prompt
    │
    ▼
[1] preEval               classify CLEAR / HIGH; tag attack types
    │
    ▼
[2] semanticTransducer    Φ : text → δ(C, R, S)
    │
    ▼
[3] applyDelta            CRS' = Π_S(CRS + δ)
    │
    ▼
[4] updateZTraj           persist velocity, n_stable, drift_dir,
    │                      σ_viol, attack_pressure to Turso
    ▼
[5] effective_tau         τ_eff = τ_floor + labelBoost + pressureBoost
    │
    ▼
[6] applyLawImpact        if a law fired, apply law_impact deltas
    │
    ▼
[7] getGovernorMode       suppress / nudge / correction / recovery
    │
    ▼
[8] applyGovernorCorrection   CBF-projected pillar rebalancing
    │
    ▼
[9] detectSlowDrip        σ_viol > SIGMA_THRESHOLD
    │
    ▼
[10] logGovernorAction + emit PRAXIS receipt to Turso
```

---

## Five constitutional agents

| Agent | Role | Cannot |
|-------|------|--------|
| Generator | Produce raw output | Approve or govern |
| CRS Extractor | Measure constitutional state | Modify output |
| Governor | Decide intervention mode | Generate or audit |
| Intervention | Rewrite to restore balance | Approve output |
| Auditor | Sign cryptographic receipt | Modify anything |

> Article III of the Lex Aureon Constitution:
> *"No single component may generate, govern, and approve the same output."*

---

## Governor modes

Decided by `getGovernorMode(z, τ_eff)` in `lib/kv.ts`.

| Mode | Trigger | Effect |
|------|---------|--------|
| `suppress` | `M > τ_recovery` AND `n_stable ≥ N_MIN` | No correction; `V` is pure log barrier |
| `nudge` | `τ_floor < M ≤ τ_recovery` AND `velocity > 0.05` | Scaled correction (0.4×) |
| `correction` | `M ≤ τ_eff` | Full correction (1.0×) |
| `recovery` | `M ≤ τ_recovery` AND `n_stable ≥ N_MIN` | Pillar rebalancing toward equilibrium |

---

## Attack taxonomy

Pre-eval patterns in `lib/praxis.ts:ATTACK_PATTERNS`.

| Attack | Pillar collapsed | `law_id` |
|--------|------------------|----------|
| bypass_attempt | S | `bypass_attempt` |
| identity_reframe | C | `identity_reframe` |
| sycophancy | R | `sycophancy` |
| multi_attack | all three | `multi_attack` |
| slow_drip | M global | detected via `σ_viol` |
| attack_vector_disclosure | C + S | `attack_vector_disclosure` |
| slow_drip_probe | cumulative | detected via `σ_viol` |
| false_premise | C | `identity_reframe` |

---

## The stack

- **Frontend:** Next.js 15.5 (App Router), React 19, Tailwind
- **Backend:** Next.js API routes + Edge runtime, Zod schemas on every input
- **Storage:** Turso (libSQL) — z_traj, praxis_receipts, governor_log, law_impact, run_stats
- **Auth:** Custom JWT
- **Models:** Groq (generation + CRS scoring fallback), Jina (embeddings)
- **Hosting:** Vercel
- **CI:** GitHub Actions — build, test, secret-scan

No `@vercel/kv`, no in-memory fallbacks, no demo paths.

---

## Database tables

Never delete or modify schema without a migration plan.

| Table | Purpose |
|-------|---------|
| `z_traj` | Per-session trajectory (velocity, n_stable, σ_viol, attack_pressure) |
| `praxis_receipts` | Immutable audit receipts — never delete |
| `governor_log` | Every governor intervention |
| `law_impact` | Static CRS deltas per `law_id` |
| `session_state` | Constitutional snapshot per session |
| `audit_global` | Cross-session audit feed |
| `run_stats` | Atomic total-runs counter |
| `reset_tokens` | Password reset tokens |
| `leads` | Captured leads |

---

## Environment variables

Required (`lib/env.ts` throws at first access if any are missing):

```env
GROQ_API_KEY=
JINA_API_KEY=
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=
ADMIN_PASSWORD=
CRON_SECRET=
NEXT_PUBLIC_SITE_URL=https://www.lexaureon.com
```

Optional:

```env
Claude_api_key=                    # exposed as env.ANTHROPIC_API_KEY
NEXT_PUBLIC_PRO_CHECKOUT_URL=      # Stripe checkout link
LOG_DRAIN_URL=                     # remote log intake (Axiom, Datadog, etc.)
LOG_DRAIN_TOKEN=
```

`process.env` access is **not** allowed anywhere except `NODE_ENV`.
All env reads must go through `env` from `lib/env.ts`.

---

## Local setup

```bash
git clone https://github.com/omomehinemmanuel5-boop/Lexaureon-frontend
cd Lexaureon-frontend
npm install
cp .env.local.example .env.local
# Fill in all seven required vars
npm run dev
```

---

## Health checks

```bash
npm run build           # TypeScript + Next.js build
npm run test:governor   # pre-eval / governor unit tests
npm run health          # live system probe
npm run brief           # project summary printout
```

Endpoints:

```text
GET /api/health           service + counter + storage probes
GET /api/live-state       aggregate CRS state (last 20 z_traj rows)
GET /api/audits/recent    latest receipts with full CRS vectors
GET /api/stats            run counter
```

---

## Project structure

```
app/
  page.tsx                   Landing page
  console/page.tsx           Live governance terminal
  constitution/page.tsx      Lex Aureon Constitution
  research/page.tsx          Research foundation
  audit/[id]/page.tsx        Shareable audit receipts
  audit/[id]/opengraph-image.tsx   Dynamic OG cards
  admin/page.tsx             Admin dashboard
  api/
    lex/run/route.ts         Main governance endpoint
    lex/run/stream/route.ts  SSE token-stream variant
    health/route.ts          Health probe
    live-state/route.ts      Aggregate constitutional state
    audits/recent/route.ts   Audit feed
    cron/synthetic/route.ts  6h synthetic governance probe
    keys/...                 API key management
    auth/...                 JWT auth surface
lib/
  praxis.ts                  PRAXIS pipeline
  kv.ts                      z_traj + session_state + audit (Turso)
  db.ts                      Turso client + receipts
  aureonics_math.ts          CCP + IEC + ADV + CBF + Lyapunov
  constitution.ts            Frozen constants + assertSimplex
  env.ts                     Lazy Proxy over process.env
  schemas.ts                 Zod request schemas
  agents/                    Five constitutional agents
components/                  UI components
research/                    Open problems + paper update notes
huggingface/                 HuggingFace Space mirror
__tests__/                   Vitest unit + integration suites
```

---

## Deployment rules

1. `npm run build` before every commit.
2. Push to `main` triggers Vercel auto-deploy.
3. Never modify constitutional math.
4. `C + R + S = 1` must always be preserved.
5. Audit receipts are immutable — never delete.
6. No `console.log` in production paths.
7. All Turso queries live in `lib/kv.ts` or `lib/db.ts`.
8. All governor logic lives in `lib/praxis.ts`.
9. Security over convenience, always.
10. Update `AGENTS.md` changelog after every change.

---

## Where this is going

Aureonics is a research program, not a finished product. The current
system implements the v2 paper and partially the v3 candidate; the open
problems are tracked at
[`research/open-problems.md`](./research/open-problems.md) and proposed
paper additions at
[`research/paper-updates.md`](./research/paper-updates.md).

Near-term priorities:

1. **Multi-turn slow-drip evaluation (P10)** — test attack-pressure
   accumulation across turns; the current harness uses single-turn
   isolation, so the slow-drip mechanism is not yet exercised at scale.
2. **Neithra agent (Stage 2)** — meta-reasoning agent between Governor
   and Intervention; verifies proposed intervention addresses the correct
   pillar before rewriting. Closes the pillar-mismatch alignment gap.
3. **Paper v3** — formalize V_z unified Lyapunov, brittleness metric
   B(x), register-aware IEC, adaptive τ_eff, non-expansive simplex
   projection lemma, and 50-law Vaulturex Codex integration.
4. **Multi-turn CRS** — variance-based ADV across turns using turn_history
   Turso table; current ADV is per-turn, paper definition is multi-trial.
5. **Clause Bank agent (Phase 2)** — jurisdiction-aware constitutional
   law pattern matching for legal/compliance use cases.

The goal is a control-theoretic governance layer with empirical results
strong enough to land in workshop papers and grant applications, then
a stable enough API to be the audit substrate underneath production
LLM deployments.

---

## Services and pricing

| Service | Price | Turnaround |
|---------|-------|------------|
| AI Governance Audit | $500 | 5 days |
| Constitutional Layer Design | $2,000 | 2 weeks |
| AI Safety Consulting | $75/hr | flexible |
| Technical Writing | $200–500 | per piece |

---

## Research

**Author:** Emmanuel King — Lex Intelligence Systems, Lagos, Nigeria
**ORCID:** [0009-0000-2986-4935](https://orcid.org/0009-0000-2986-4935)
**Contact:** [omomehinemmanuel5@gmail.com](mailto:omomehinemmanuel5@gmail.com)
**X:** [@lexAureon](https://x.com/lexAureon)

**Papers:**
- v1 (Mar 2026) — DOI [10.5281/zenodo.18944243](https://doi.org/10.5281/zenodo.18944243)
- v2 (May 2026) — DOI [10.5281/zenodo.20183807](https://doi.org/10.5281/zenodo.20183807)
- v3 candidate — see [`research/paper-updates.md`](./research/paper-updates.md)

**Open problems** ([`research/open-problems.md`](./research/open-problems.md)):
1. Global Lyapunov proof — multi-pillar regime (priority: MEDIUM after non-expansive Π_S lemma)
2. Nonlinear Pareto frontier — full characterization under λ > 0
3. Complete z-update rule — `dp_attack/dt` coupling to `law_events`

**Falsifiable predictions:** P1–P9 untested at scale; P10–P12 proposed
in v3 candidate.

**Grants:** Schmidt Sciences submitted · LTFF in progress.

---

## License

© 2026 Emmanuel King — Aureonics Framework. MIT License.
