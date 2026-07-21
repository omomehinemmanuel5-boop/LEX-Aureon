# Aureonics Open Mathematical Problems

## Open Problem 1 — Global Lyapunov Proof
Status: Partial (single-pillar regime proven; CBF-safe Π_S
non-expansive lemma added in v3 candidate)
Remains: Multi-pillar simultaneous violation
Approach: Comparison system or LaSalle invariance, leveraging
non-expansivity of the Duchi simplex projection
Priority: MEDIUM
(Downgraded from HIGH after the non-expansive Π_S lemma —
see research/paper-updates.md §2.)
Numerical note (2026-07-20): the CBF simulator's FPL-1 classification
reads NOT PROVEN at dt=1.0 purely as a discretization artifact — it
passes on all seeds for dt ≤ 0.5 (invariance_violations = 0, excursion
< 0.25, stability_ratio > 0.6). This is numerical evidence for the
governed continuous flow, NOT a proof of the multi-pillar analytical
result above. See research/empirical-results.md "Run 002" and
scripts/cbf/fpl1-dt-sweep.ts.

Progress (2026-07-21, see empirical-results.md "Run 003" +
scripts/cbf/op1-lyapunov-check.ts) — two analytical results advance
this, WITHOUT closing it:
  (a) Idealized flow, multi-pillar CLOSED: V_z is convex on the
      floor-simplex, so ẋ=−Π∇V_z gives V̇_z=−‖Π∇V_z‖²≤0 to the unique
      global minimizer — all pillars, via convexity alone (no
      comparison-system/LaSalle needed).
  (b) Deployed governor descent term proven ≤0 multi-pillar via
      Chebyshev's sum inequality: ⟨∇V_z,G⟩≤0 for all states (uniform z),
      including two-pillars-stressed — so multi-pillar is NOT a new
      structural/sign problem.
  Residual (still open): the quantitative governor-vs-drift margin
  |⟨∇V_z,G⟩| ≥ ⟨∇V_z,F⟩ in the multi-pillar region — same type as the
  single-pillar k0/εₖ>3B/2 condition, not yet discharged in closed form.
  Status remains PARTIAL, now with the gap sharply localized.

## Open Problem 2 — Nonlinear Pareto Frontier
Status: Open
Remains: Full characterization under lambda > 0, including the
coupling to adaptive τ_eff(z, ℓ)
Approach: Lagrangian methods + numerical continuation
Priority: MEDIUM

## Open Problem 3 — Complete z-Update Rule
Status: Partial (velocity, n_stable, drift_dir, sigma_viol,
attack_pressure specified; state-space side closed in v3 candidate)
Remains: Characterize dp_attack/dt coupling to law_events
Approach: Hybrid dynamical system formulation with three regions
(M > τ_LYP, τ_floor < M ≤ τ_LYP, M ≤ τ_floor)
Priority: HIGH
(Rephrased from "Full coupling to law_events and z_env" after
attack_pressure was added as the tenth z-state variable —
see research/paper-updates.md §3 and §4.)

## Falsifiable Predictions Status
P1: Untested  P2: Untested  P3: Untested
P4: Untested  P5: Untested  P6: Untested
P7: Untested  P8: Untested  P9: Untested

### Proposed (v3 candidate — see research/paper-updates.md)

P10 — Per-session adversarial collapse: repeated adversarial turns
within a single session collapse M(x) faster than the same prompts
across independent sessions, because attack_pressure raises τ_eff
over time. Test on SSS50 with paired session/fresh-session arms.

P11 — Faster slow-drip detection under τ_LYP rule: time-to-detection
of slow-drip attacks is shorter when sigma_viol accumulates at τ_LYP
(0.08) than at τ_floor (0.05). Replay SSS50 with both definitions.

P12 — Taxonomy partition completeness: the empirical distribution of
law_fired on production traffic matches the attack taxonomy partition
assumed in §3, with no "other" residual class needed.
