# Aureonics Open Mathematical Problems

This file tracks only unresolved mathematical problems. Resolved problems stay listed in the resolved ledger below so README, landing-page, and paper copy do not accidentally keep stale "open" claims alive.

## Open Problem 1 — Analytical multi-pillar Lyapunov proof

Status: **PARTIAL — residual margin not yet discharged in closed form**

Closed sub-results:

- Single-pillar regime is proven under the scoped condition already stated in the project notes.
- Idealized multi-pillar projected flow is Lyapunov-stable by convexity of `V_z` on the floor-simplex: `ẋ = −Π∇V_z` gives `V̇_z = −‖Π∇V_z‖² ≤ 0` toward the unique minimizer.
- The deployed governor descent term has no multi-pillar sign obstruction in the checked formulation: `⟨∇V_z, G⟩ ≤ 0`, including two-pillar stressed states.
- The FPL-1 simulator now numerically certifies `LYAPUNOV STABLE + FORWARD INVARIANT` for the governed counterfactual at the continuous-flow limit. This is numerical evidence, not the analytical proof.

Remaining gap:

- Prove the quantitative governor-vs-drift margin in the multi-pillar region:

```text
|⟨∇V_z, G⟩| ≥ ⟨∇V_z, F⟩
```

This is the same kind of margin condition already discharged in the single-pillar regime (`k0/ε_k > 3B/2`), but it has not yet been expressed and proven in closed form for simultaneous multi-pillar stress.

Priority: **HIGH**

Suggested next proof route:

1. Formalize the admissible drift envelope `F(x,z,T)` for simultaneous pillar stress.
2. Bound `⟨∇V_z,F⟩` over the floor-simplex under that envelope.
3. Compare the bound against the already sign-correct governor term.
4. State the resulting parameter condition without weakening `TAU_FLOOR`, `TAU_RECOVERY`, or the simplex invariant.

### Progress note (2026-09-06)

Two simplifications, found while working the proof route above:

**1. Step 1 above is mostly already done — `F` is not a continuum.** The
actual attack model in this codebase is a finite, 6-row table
(`lib/kv.ts` `LAW_ATTACK_SIGNAL`), each a fixed `(severity, direction)`
pair used by the proven z-update rule (Resolved Problem 3). Only two of
the six rows stress more than one pillar simultaneously — the regime
this open problem is actually about:

- `attack_vector_disclosure`: `dir=[-0.5, 0, -0.5]`, `sev=0.9` (two-pillar)
- `multi_attack` / `slow_drip`: `dir=[-1/3,-1/3,-1/3]`, `sev∈{1.0, 0.3}` (three-pillar, symmetric)

The remaining three rows (`bypass_attempt`, `identity_reframe`,
`sycophancy`) each push exactly one coordinate negative — the regime the
single-pillar result already closes. So "bound `⟨∇V_z,F⟩` over the
admissible envelope" reduces to checking these two specific vectors, not
an open-ended adversarial search. `multi_attack`'s symmetric direction is
the natural candidate for the binding case.

**2. The margin condition is not one inequality — it's two, by regime.**
The deployed governor (`lib/praxis.ts` `applyGovernorCorrection`, the
function `AGENTS.md`'s PRAXIS pipeline confirms actually runs in
production) uses `φ_i = max(0, τ-x_i)` with `τ = TAU_FLOOR = 0.05`
(effectively `0.10` when Pre-Eval classifies a turn `HIGH`). Since
`φ_i ≡ 0` for any pillar at or above `τ`, the governor's correction `G`
is **identically zero whenever no pillar has actually breached the
floor** — which includes almost all of "nudge" mode
(`TAU_FLOOR < M ≤ TAU_RECOVERY`) unless the effective τ is raised. This
means:

- **Regime A — no pillar below τ:** `G ≡ 0`. Stability in this region
  rests entirely on `V_z`'s own log-barrier gradient term `-z_i/x_i`,
  with no governor contribution at all.
- **Regime B — at least one pillar below τ:** `G ≠ 0`, the CBF penalty
  term is active, and this is the regime the margin inequality
  `|⟨∇V_z,G⟩| ≥ ⟨∇V_z,F⟩` needs to hold in, checked against the two
  attack vectors above.

Note: `lib/aureonics_core.ts` records a 2026-08-14 numerical check that
`calculateGovernorG` doesn't go blind under symmetric multi-pillar
stress — but that function uses `TAU_GOV = 0.22`, a materially different
threshold from the deployed `applyGovernorCorrection`'s `TAU_FLOOR =
0.05`. That earlier check does not obviously carry over to the function
actually running in production and should not be treated as covering
Regime B above until re-verified against the real deployed threshold.

Exact closed-form gradient available for the next step (`lib/aureonics_core.ts`
`gradVz()`, not yet wired into production but mathematically exact):

```text
∂V_z/∂x_i = -z_i/x_i - μ·φ_i     (φ_i = max(0, τ-x_i)),  μ = MU = 2.0
```

Not yet done: the actual symbolic bound in Regime B for the `multi_attack`
direction, checked against `attack_vector_disclosure`, reduced to a
closed-form parameter condition in `k0, ε_k, μ, τ` matching the shape of
the closed single-pillar result (`k0/ε_k > 3B/2`).

---

## Resolved mathematical problems

### Resolved Problem 2 — Nonlinear Pareto frontier

Status: **CLOSED**

The nonlinear Pareto frontier with `λ > 0` has been characterized; the phase transition `λ*` was derived and brittleness `B` formalized. Keep this out of active "open problems" sections in README and landing-page copy.

### Resolved Problem 3 — Dynamic z-update rule

Status: **CLOSED**

The dynamic z-update rule is closed via the Banach fixed-point construction:

```text
A(t) = γ · Σ_law∈events_t sev(law) · dir(law)
z_{t+1} = normalize(clamp(ρ·z_t + (1−ρ)·x_t − A(t), τ/2, 1−τ))
ρ = 0.85, γ = 0.10
```

Implemented in `lib/kv.ts` through `updateZTraj()` / `computeZWeights()`, loaded by `lib/kernel_bridge.ts`, passed into `runCycle(sessionZ)`, and stamped into receipts as `z_weights` with `lyapunov_V`.

### Resolved numerical item — FPL-1 simulator classification

Status: **RESOLVED NUMERICALLY; not an analytical proof**

The prior `NOT PROVEN` simulator classification was traced to two implementation issues: naive projection in the governed arm and a coarse `dt=1.0` discretization artifact. The governed counterfactual now uses the production floor-respecting Duchi projection and certifies at `dt=0.1`, yielding `LYAPUNOV STABLE + FORWARD INVARIANT` in the numerical panel.

---

## Falsifiable predictions status

P1: Untested  P2: Untested  P3: Untested
P4: Untested  P5: Untested  P6: Untested
P7: Untested  P8: Untested  P9: Untested

### Proposed v3 predictions

P10 — Per-session adversarial collapse: repeated adversarial turns within a single session collapse `M(x)` faster than the same prompts across independent sessions, because attack pressure raises effective recovery demand over time.

P11 — Faster slow-drip detection under the recovery-margin rule: time-to-detection of slow-drip attacks is shorter when `sigma_viol` accumulates at the recovery margin than at the hard floor.

P12 — Taxonomy partition completeness: the empirical distribution of `law_fired` on production traffic matches the attack taxonomy partition assumed in the paper, with no unexplained residual class needed.
