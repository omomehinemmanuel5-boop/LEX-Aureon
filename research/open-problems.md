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
