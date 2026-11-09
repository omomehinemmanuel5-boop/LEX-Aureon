# Aureonics Adaptive Basin Alignment — Research Specification v1

**Status:** Reference-model specification; not a production controller change  
**Implementation branch:** `fix/adaptive-basin-alignment`  
**Scope:** Three task-conditioned operating regions, neutral-region partition, target geometry, fixed-target potential, and discrete descent verification.

## 1. Research interpretation

Aureonics' triadic hypothesis treats Continuity (C), Reciprocity (R), and Sovereignty (S) as three necessary expressions of one deeper property of viable/adaptive systems. The analytical, collaborative, and exploratory basins are therefore not three independent substances or three separate system identities. They are directional operating regimes in a shared constitutional state space.

The three directional regions are:

- **Analytical:** C-dominant operating regime.
- **Collaborative:** R-dominant operating regime.
- **Exploratory:** S-dominant operating regime.
- **Neutral central region:** approximately balanced state around `(1/3, 1/3, 1/3)`; this is not a fourth directional basin.

The word *basin of attraction* has a strict dynamical-systems meaning. A region is a proven attractor basin only after a vector field, admissible domain, equilibrium/target, and convergence result are specified. Until that proof exists, code, paper, and product copy should use **operating region**, **task-conditioned mode**, or **basin-like region** rather than implying a demonstrated basin of attraction.

## 2. State, task preference, and memory are distinct

Use separate symbols and contracts:

| Symbol | Meaning | Must not be conflated with |
|---|---|---|
| `x=(C,R,S)` | Measured constitutional state, `x ∈ Δ²_{τ_f}` | Task preference or memory |
| `w(T)` | Task-conditioned preference weights over C/R/S | Measured state |
| `q(T)` | Interior target derived from task preference | Adaptive memory |
| `z(t)` | Session-adaptive constitutional-memory weights used by `V_z` | Task preference |

The production hard floor remains `τ_f = 0.05`. The recovery threshold remains `0.15`. This work does not change either value.

A task may prefer the analytical mode while session memory assigns stronger protective weight to Sovereignty because of prior attack history. That is not a contradiction: `w(T)` selects the task-conditioned operating target; `z(t)` encodes constitutional memory and protection. They serve different roles.

## 3. Interior task-conditioned target

Let `w(T) ∈ Δ²`, with non-negative entries summing to one. Define:

```text
q_i(T) = τ_B + (1 - 3τ_B) w_i(T)
```

where `τ_f < τ_B < 1/3`. The basin target margin `τ_B` is deliberately separate from the hard floor `τ_f`. No production default for `τ_B` is introduced by this specification.

Properties:

1. `Σ_i q_i = 1`.
2. `q_i ≥ τ_B > τ_f`; the target is strictly inside the hard-floor simplex.
3. For one-hot preferences, the three target profiles are permutations of `(1 - 2τ_B, τ_B, τ_B)`.
4. Uniform preference produces the centroid `(1/3,1/3,1/3)`.

This resolves the earlier boundary ambiguity: a target with minimum coordinate exactly equal to the hard floor is not described as strictly interior.

## 4. Disjoint operating-region classification

Let `c=(1/3,1/3,1/3)` and choose an explicit neutral radius `r_N`. Classify a valid state in this order:

1. If `||x-c||₂ ≤ r_N`, label it **neutral**.
2. Otherwise, select the largest coordinate: C → analytical, R → collaborative, S → exploratory.
3. Exact ties use the deterministic priority C, then R, then S.

The neutral-first rule makes the partition disjoint. The radius is a model parameter and must be declared in each evaluation; it is not silently tuned after observing results. The partition is a labeling convention, not evidence that trajectories converge to these regions.

## 5. Task-conditioned potential and continuous-time result

For a fixed, strictly interior target `q`, define:

```text
V_T(x;q) = -Σ_i q_i log(x_i)
∇V_T(x;q)_i = -q_i / x_i
Π(v) = v - mean(v)·1
ẋ_T = -η Π(∇V_T),  η > 0
```

The direction is tangent to the simplex because `Σ_i ẋ_{T,i}=0`. For fixed q:

```text
dV_T/dt = ∇V_T · ẋ_T
        = -η ||Π(∇V_T)||²
        ≤ 0
```

This establishes non-increasing task potential along the ideal projected-gradient flow. On the positive simplex, `V_T` is strictly convex for strictly positive q; its constrained minimizer is `x=q`. This is a result about the isolated fixed-q flow, not the full Lex controller.

## 6. Discrete-time and moving-target limits

A continuous-time derivative does not prove that an arbitrary finite Euler step decreases the potential. The research reference therefore projects candidate steps onto the floor-constrained simplex and backtracks until the same fixed-q potential is non-increasing. If no step is accepted, it returns the original state unchanged.

When the task target changes, the derivative gains a target-drift term:

```text
dV_T(x;q(t))/dt = -Σ_i q_i(t)·ẋ_i/x_i - Σ_i q̇_i(t) log(x_i)
```

The fixed-q descent result cannot be carried over unmodified to arbitrary moving targets. For a certified transition/evaluation window, freeze q; otherwise explicitly bound and account for the q-drift term. Do not claim unconditional Lyapunov descent for a moving target.

## 7. Relationship to the existing z-weighted certificate

The published/deployed constitutional certificate is:

```text
V_z(x) = -Σ_i z_i log(x_i) + (μ/2)Σ_i max(0, τ_f - x_i)²
```

For fixed positive z and the stated domain, its gradient and projected-flow argument belong to the constitutional-memory controller. They are not the same object as `V_T(x;q)`.

The moving-z derivative contains the additional term:

```text
-Σ_i ż_i log(x_i)
```

Therefore, a fixed-z proof does not automatically prove descent when z changes. The existing z-update's boundedness/convergence claims must be scoped to their own assumptions. This branch does not alter z-update code, storage, or recovery semantics.

## 8. Safe integration order (future work only)

If the reference model is ever proposed for shadow or production integration, use this order:

1. Measure and validate `x` against the constitutional simplex.
2. Resolve task preference `w(T)` and derive strictly interior `q(T)`.
3. Freeze q for the declared transition/evaluation window.
4. Compute task-conditioned direction.
5. Combine with constitutional-memory correction under a separately specified rule.
6. Apply the task-independent CBF/hard-floor safety filter as the final invariant authority.
7. Verify simplex, hard floor, and the appropriate descent certificate.
8. Emit an auditable receipt containing x, w, q, z, target version, step size, guard outcome, and safety-filter outcome.

Task preference must never weaken or bypass the task-independent CBF, human authority, approval, quarantine, or capability controls. The reference module in this branch implements none of those integration steps.

## 9. Verification requirements

The isolated reference tests cover:

- finite values, simplex mass, and floor invariants;
- valid preference simplex and strictly interior target;
- all three one-hot target profiles and the uniform centroid target;
- neutral-first disjoint classification and deterministic tie-breaking;
- zero-sum tangent direction;
- non-positive fixed-q directional derivative;
- discrete projected-step non-increase through backtracking;
- fail-closed behavior when no acceptable step is found.

These tests are algebraic/software checks. They do not establish attraction basins, empirical usefulness, robustness under changing tasks, or production safety.

## 10. Claim/evidence ledger

| Claim | Evidence class | Current status |
|---|---|---|
| `q(T)` is a simplex target strictly above the hard floor when `τ_B>τ_f` | Algebraic identity | Established by construction |
| Fixed-q projected flow has `V̇_T≤0` | Mathematical result | Established for the isolated flow |
| Backtracked projected discrete step does not increase fixed-q `V_T` | Algorithmic invariant | Tested in reference module |
| Three named regions are true attractor basins | Dynamical-systems theorem | **Not established** |
| Moving-task controller is stable | Conditional theorem / empirical claim | **Not established** |
| Task-conditioned modes improve agent performance | Empirical hypothesis | Requires preregistered evaluation |
| Task modes preserve Lex constitutional safety | System-level claim | Not tested; no production integration in this branch |

## 11. Required empirical programme before stronger claims

1. Pre-register task taxonomy and the mapping from task classes to `w(T)`.
2. Pre-register `τ_B`, neutral radius, target-freeze interval, step-size policy, and evaluation metrics.
3. Compare task-conditioned reference, neutral-only reference, and baseline governor under matched prompts and seeds.
4. Measure task quality, constitutional margin, intervention rate, oscillation, target-switch cost, and recovery behavior.
5. Include adversarial task-label manipulation and ambiguous-task cases.
6. Report confidence intervals, failures, abstentions, and out-of-distribution cases.
7. Only call a region an attractor basin after specifying and proving the corresponding closed-loop vector field's invariance and convergence properties.

## 12. Manuscript and metadata reconciliation

The repository contains multiple manuscript generations and DOI references. Before the next paper release:

- identify which text is the authoritative v3 publication and which is the later v4 research manuscript;
- cite the v3 DOI `10.5281/zenodo.20183807` for the published triadic framework;
- verify whether the earlier DOI `10.5281/zenodo.18944243` is a separate version, a superseded record, or a metadata error;
- reconcile any live research-page DOI `10.5281/zenodo.18944242` before publication;
- ensure the basin definitions and any stability claims are version-tagged and do not retroactively imply that v3 proved the later v4 task-conditioned controller.

## 13. Non-goals and protected boundaries

This branch must not:

- modify `lib/production_transition.ts`, `lib/sovereign_kernel.ts`, `lib/praxis.ts`, `lib/kv.ts`, or production routes;
- change `TAU=0.05`, the `0.15` recovery threshold, z-update semantics, approval binding, quarantine, or operator/client authority;
- call databases, external APIs, LLM providers, or network services from the reference module;
- claim that a unit-test pass is a theorem or that a benchmark win proves stability.

The acceptance gate is: source isolation + typecheck + targeted tests + repository CI review. Passing these gates does not authorize production integration.
