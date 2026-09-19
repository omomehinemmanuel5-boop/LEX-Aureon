# Aureonics Research Boundaries and Resolved Problems

This file tracks research boundaries and resolved problems. The unrestricted arbitrary-drift theorem and the unexecuted falsifiable predictions are retired from the current deployment contract; they remain optional research topics rather than open deployment blockers. Resolved problems stay listed in the ledger below so README, landing-page, and paper copy do not accidentally keep stale "open" claims alive.

The cross-cutting closure plan for empirical predictions, agent-action evidence, and optional product extensions is documented in [`research/closure-program.md`](closure-program.md). It defines the evidence required to mark each remaining item measured, implemented, or retired.

## Resolved Boundary — Analytical multi-pillar Lyapunov claim

Status: **CLOSED AS SCOPED — guarded discrete invariant proven; unrestricted unguarded margin is not a valid claim**

Closed sub-results:

- Single-pillar regime is proven under the scoped condition already stated in the project notes.
- Idealized multi-pillar projected flow is Lyapunov-stable by convexity of `V_z` on the floor-simplex: `ẋ = −Π∇V_z` gives `V̇_z = −‖Π∇V_z‖² ≤ 0` toward the unique minimizer.
- The deployed governor now uses the active z-weighted negative projected gradient, so `⟨∇V_z, G_z⟩ ≤ 0` for arbitrary positive session weights. The previous z-independent governor remains available only as a legacy/reference function.
- The guarded discrete production transition is closed as an engineering guarantee: for finite inputs and valid positive session weights, its post-guard commits a floor-constrained state with `ΔV_z ≤ 0`; replay and receipt verification use the same active weights.
- The FPL-1 simulator now numerically certifies `LYAPUNOV STABLE + FORWARD INVARIANT` for the governed counterfactual at the continuous-flow limit. This is numerical evidence, not the analytical proof.

Why the unrestricted claim is closed rather than left open:

- The current transition input contract permits finite drift components without a declared bound tying them to the governor gain. Therefore no global unguarded inequality can be claimed over that contract. At a symmetric state the projected governor correction can be zero, while an unrestricted tangent drift can still be nonzero; the proposed global margin is consequently false without an additional envelope.

The valid deployed result is the guarded discrete invariant:

```text
ΔV_z(x, T_guarded(x, u, z)) ≤ 0
```

This is enforced by the final convex-segment descent guard for valid floor-constrained states, finite inputs, and positive finite session weights. Replay, certificates, and receipts use the same active weights.

The remaining continuous-time comparison now has a scoped sufficient result in [`research/drift-envelope.md`](drift-envelope.md): if tangent drift satisfies `||F||₂ ≤ K||Π∇V_z||₂`, the z-aware governor guarantees a non-positive directional derivative. The unrestricted claim remains intentionally unproven because no such drift envelope is part of the general input contract.

Priority: **CLOSED AS OUT OF SCOPE FOR THE CURRENT DEPLOYMENT CONTRACT**

Optional future research, not a deployment gap:

1. Declare an explicit bounded drift envelope `F(x,z,T)`.
2. Bound `⟨∇V_z,F⟩` over the floor-simplex under that envelope.
3. Compare that conditional bound against the z-aware governor term.
4. Treat the result as a new theorem with a new scope, not as a missing proof of the deployed guarded invariant.

### Historical derivation notes

The notes below record the earlier investigation and are retained for provenance. Their claims about a z-independent deployed governor and a two-regime floor-only correction were superseded by the verified live call path and the z-aware governor implementation in `968bf8b`.

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

**2. Historical note — superseded by the z-aware implementation.**
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

Not yet done: the actual symbolic bound in the z-aware multi-pillar regime for the `multi_attack`
direction, checked against `attack_vector_disclosure`, reduced to a
closed-form parameter condition in `k0, ε_k, μ, τ` matching the shape of
the closed single-pillar result (`k0/ε_k > 3B/2`).

### Correction to the note above (2026-09-06, same day)

**Point 2 above misidentified the deployed governor function.** Verified
by tracing the actual call graph (`app/api/lex/govern/route.ts` →
`lib/governance_service.ts` → `kernel.runCycle()` →
`SovereignKernel.governorUpdate()`) rather than trusting `AGENTS.md`'s
pipeline summary: the live governor is `calculateGovernorG` in
`lib/aureonics_core.ts` — **not** `applyGovernorCorrection` in
`lib/praxis.ts`, which does not appear to be called from the live
request path at all. `AGENTS.md`'s "6. applyGovernorCorrection" pipeline
step description does not match the actual runtime call graph and should
be corrected there too (done, see CHANGELOG).

The real formula, confirmed from source (`lib/aureonics_core.ts`,
constants at lines 23–45):

```text
φ_lin(x_i) = max(0, τ_GOV - x_i)                    τ_GOV = TAU_GOV = 0.22
φ_log(x_i) = min(1, MU_BARRIER / (x_i - TAU))        TAU = 0.05, MU_BARRIER = 0.02
φ_i        = φ_lin(x_i) + φ_log(x_i)
G_i        = K · (φ_i - φ̄)                          K = 4.0
```

This changes the structure of the problem in two ways:

1. **`τ = TAU_GOV = 0.22` is the operative threshold, not `TAU_FLOOR =
   0.05`.** The three-pillar impossibility result from the note above
   still holds and is *more* comfortable under the correct threshold:
   `3 × 0.22 = 0.66 < 1`, still well short of what the simplex
   constraint would require to breach all three at once.
2. **There is no clean "G≡0 regime."** Unlike the linear-only `φ` this
   note originally analyzed, `φ_log(x_i) > 0` for every `x_i` on the
   simplex (it only approaches 0 as `x_i → ∞`, which the simplex
   forbids). So the earlier "Regime A / Regime B" split doesn't apply to
   the real function — `G` is generically nonzero everywhere, vanishing
   only where `φ` happens to be exactly equal across all three pillars.
   Useful simplification: since `G_i` depends only on deviation from the
   mean, `φ_log`'s contribution to `G` is exactly zero whenever
   `φ_log` is equal across pillars (e.g., at the symmetric point) —
   it only matters to the extent `x_i` values differ from each other.
   The 2026-08-14 numerical check in `aureonics_core.ts` — confirming
   `calculateGovernorG` doesn't go blind under symmetric multi-pillar
   stress — **does apply directly here after all**, since this is
   confirmed to be the real deployed function; the concern raised
   earlier in this note about it covering the wrong function no longer
   applies.

Not yet done, and now the actual next step: redo the Regime-B-style bound
above using the real two-term `φ_lin + φ_log`, for both enumerated
multi-pillar attack vectors, with the confirmed constants
`(K=4.0, TAU=0.05, TAU_GOV=0.22, MU_BARRIER=0.02, EPS_BARRIER=1e-4)`.
The derivation must state the allowed range of `z` and the governor gain schedule.
The unrestricted dynamic-weight sign problem and the guarded discrete
engineering guarantee are now closed. The remaining mathematical question is
only the unguarded continuous-time magnitude comparison against a complete
drift envelope; it is not required for the deployed guarded invariant.
Given this is the second correction cycle on a "which function is
actually deployed" question within the same investigation, this is a
reasonable point to get a second pass on the confirmed facts above
before extending the derivation further — either from the same author
in a dedicated follow-up, or an outside control-theory reviewer, since
the remaining gap is now precisely specified rather than open-ended.

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

Status: **RETIRED FROM THE CURRENT DEPLOYMENT CONTRACT**

P1–P9 are not required to establish the deployed guarded invariant. P10–P12
have reproducible audit infrastructure but no qualifying evidence artifact in
this revision. They are therefore not claimed as supported or falsified; all
prediction claims are retired from the deployment promise and remain optional
research follow-up. The audit runner must continue to report `INCONCLUSIVE`
when its pre-registered evidence is absent.

P1: Retired  P2: Retired  P3: Retired
P4: Retired  P5: Retired  P6: Retired
P7: Retired  P8: Retired  P9: Retired

### Proposed v3 predictions

P10 — Optional research: per-session adversarial collapse. Repeated adversarial turns within a single session may collapse `M(x)` faster than the same prompts across independent sessions, because attack pressure raises effective recovery demand over time.

P11 — Optional research: faster slow-drip detection under the recovery-margin rule. Time-to-detection may be shorter when `sigma_viol` accumulates at the recovery margin than at the hard floor.

P12 — Optional research: taxonomy partition completeness. The empirical distribution of `law_fired` on production traffic may match the attack taxonomy partition assumed in the paper, with no unexplained residual class needed.
